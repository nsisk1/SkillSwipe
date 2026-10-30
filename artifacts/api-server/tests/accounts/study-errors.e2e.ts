import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/express";
import { test as base, expect, type Page } from "@playwright/test";
import { AccountTestStore, startAccountFixture } from "./fixture-server";

type StudyFixture = {
  page: Page;
  store: AccountTestStore;
  ownerId: string;
  deckId: string;
};

// Real shipped screen and session transport, isolated in-memory persistence.
// Keep these checks independent of account switching and revoked sessions.
const test = base.extend<{ study: StudyFixture }>({
  study: async ({ browser }, use) => {
    if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
        !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
      throw new Error("Study UI tests require development Clerk keys.");
    }
    const appUrl = process.env.ACCOUNTS_TEST_APP_URL ??
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined);
    if (!appUrl) throw new Error("Set ACCOUNTS_TEST_APP_URL or start the development app.");

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const store = new AccountTestStore();
    const fixture = await startAccountFixture(store);
    let ownerId: string | undefined;
    const context = await browser.newContext({
      viewport: { width: 402, height: 874 },
      ignoreHTTPSErrors: Boolean(process.env.CI),
    });
    try {
      const user = await clerk.users.createUser({
        emailAddress: [`skillswipe-study-${randomUUID()}+clerk_test@example.com`],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
      });
      ownerId = user.id;
      const deck = await store.createDeck(user.id, "Study error fixture", "beginner",
        ["one", "two", "three"].map(id => ({
          id, topic: "Study error fixture",
          question: `Study question ${id}`, answer: `Study answer ${id}`,
        })));
      // Begin mid-deck so a failed reset cannot pass by staying at index zero.
      await store.updateProgress(user.id, deck.id,
        { cardId: "one", status: "known", activeIndex: 1 });
      // Expo web may serve from a different origin than EXPO_PUBLIC_DOMAIN.
      // Intercept both origins so no deck request can reach the app database.
      await context.route("**/api/**", async route => {
        const request = route.request();
        const response = await route.fetch({
          url: `${fixture.url}${new URL(request.url()).pathname}`,
          headers: { ...await request.allHeaders(), host: new URL(request.url()).host },
        });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      await page.goto(appUrl);
      await page.waitForFunction(() => Boolean((window as any).Clerk?.loaded));
      const { token } = await clerk.signInTokens.createSignInToken({
        userId: user.id, expiresInSeconds: 60,
      });
      await page.evaluate(async ticket => {
        const clerk = (window as any).Clerk;
        const result = await clerk.client.signIn.create({ strategy: "ticket", ticket });
        if (result.status !== "complete" || !result.createdSessionId) {
          throw new Error("Clerk sign-in did not complete.");
        }
        await clerk.setActive({ session: result.createdSessionId });
      }, token);
      await page.getByTestId("open-saved-decks").click();
      await page.getByTestId(`saved-deck-${deck.id}`).click();
      await expect(page.getByTestId("study-topic")).toHaveValue(deck.topic);
      await expect(page.getByText("Study question two", { exact: true })).toBeVisible();
      await expect(page.getByText("1 of 3 done", { exact: true })).toBeVisible();
      await expect(page.getByTestId("known-card-count")).toHaveText("Known: 1");
      await use({ page, store, ownerId: user.id, deckId: deck.id });
    } finally {
      // Attempt every cleanup even when an assertion or remote deletion fails.
      const results = await Promise.allSettled([
        context.close(),
        fixture.close(),
        ...(ownerId ? [clerk.users.deleteUser(ownerId)] : []),
      ]);
      expect(results.filter(result => result.status === "rejected"),
        "Temporary study test resources must be removed").toHaveLength(0);
    }
  },
});

test.use({ actionTimeout: 20_000 });

test("a rejected progress save keeps the card and a successful retry advances once", async ({ study }) => {
  const { page, store, ownerId, deckId } = study;
  const before = await store.getDeck(ownerId, deckId);
  const attempts: unknown[] = [];
  await page.route(`**/api/flashcards/decks/${deckId}/progress`, async route => {
    expect(route.request().method()).toBe("PATCH");
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      await route.fulfill({
        status: 503, json: { error: "Controlled progress outage" },
      });
    } else {
      await route.fallback();
    }
  });

  await page.getByTestId("mark-known").click();
  const error = page.getByTestId("progress-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveText("Couldn’t save progress. Your card is ready to try again.");
  await expect(page.getByText("Study question two", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 3 done", { exact: true })).toBeVisible();
  await expect(page.getByTestId("known-card-count")).toHaveText("Known: 1");
  await expect(page.getByTestId("revisit-card-count")).toHaveText("Revisit: 0");
  expect(attempts).toEqual([{ cardId: "two", status: "known", activeIndex: 2 }]);
  expect(await store.getDeck(ownerId, deckId)).toEqual(before);

  await page.getByTestId("mark-known").click();
  await expect(page.getByText("Study question three", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 done", { exact: true })).toBeVisible();
  await expect(page.getByTestId("known-card-count")).toHaveText("Known: 2");
  await expect(error).toHaveCount(0);
  expect(attempts).toEqual([
    { cardId: "two", status: "known", activeIndex: 2 },
    { cardId: "two", status: "known", activeIndex: 2 },
  ]);
  const saved = await store.getDeck(ownerId, deckId);
  expect(saved?.activeIndex).toBe(2);
  expect(saved?.cards.map(card => card.status)).toEqual(["known", "known", "new"]);
});

test("a rejected restart preserves the study position and displays the reset error", async ({ study }) => {
  const { page, store, ownerId, deckId } = study;
  const before = await store.getDeck(ownerId, deckId);
  let attempts = 0;
  await page.route(`**/api/flashcards/decks/${deckId}/restart`, async route => {
    expect(route.request().method()).toBe("POST");
    attempts++;
    await route.fulfill({ status: 503, json: { error: "Controlled restart outage" } });
  });

  await page.getByTestId("restart-deck").click();
  const error = page.getByTestId("progress-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveText("Couldn’t reset progress. Please try again.");
  await expect(page.getByText("Study question two", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 3 done", { exact: true })).toBeVisible();
  await expect(page.getByTestId("known-card-count")).toHaveText("Known: 1");
  await expect(page.getByTestId("revisit-card-count")).toHaveText("Revisit: 0");
  await expect(page.getByTestId("restart-deck")).toBeEnabled();
  expect(attempts).toBe(1);
  expect(await store.getDeck(ownerId, deckId)).toEqual(before);
});
