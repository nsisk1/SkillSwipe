import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createClerkClient } from "@clerk/express";
import { MongoClient } from "mongodb";
import { MongoFlashcardDeckStore } from "../../src/lib/flashcard-decks";
import { AccountTestStore, startAccountFixture } from "./fixture-server";
import { getMongoTestConfig } from "../helpers/mongodb-test-config";

// Deliberately use real Clerk sessions and the running app/API, not a test
// identity header or mocked auth middleware. CI uses disposable local MongoDB;
// an injected generator avoids paid, nondeterministic AI requests.
test("saved decks follow a learner, never an installation or previous account", async ({ browser }) => {
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Account tests require development Clerk keys; refusing to use production.");
  }
  const useMongo = process.env.ACCOUNTS_TEST_STORAGE === "mongodb";
  if (!process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("Account tests require a development Clerk publishable key.");
  }
  if (!process.env.ACCOUNTS_TEST_APP_URL && !process.env.REPLIT_DEV_DOMAIN) {
    throw new Error("Set ACCOUNTS_TEST_APP_URL or start the development app.");
  }
  // Exercise Expo web with the same session JWT transport used by Expo Go.
  const appUrl = process.env.ACCOUNTS_TEST_APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const apiUrl = `${appUrl}/api`;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const users: string[] = [];
  const contexts: BrowserContext[] = [];
  const mongoConfig = useMongo ? getMongoTestConfig(process.env, true)! : undefined;
  const store = mongoConfig ? new MongoFlashcardDeckStore(mongoConfig) : new AccountTestStore();
  const fixture = await startAccountFixture(store);
  const mongo = mongoConfig ? new MongoClient(mongoConfig.uri) : null;
  const run = randomUUID();
  const topic = `Account isolation ${run}`;
  let deckId: string | undefined;
  let fixtureListRequests = 0;

  async function signIn(page: Page, userId: string) {
    await page.waitForFunction(() => Boolean((window as any).Clerk?.loaded));
    const { token } = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
    await page.evaluate(async ticket => {
      const clerk = (window as any).Clerk;
      const result = await clerk.client.signIn.create({ strategy: "ticket", ticket });
      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Clerk sign-in did not complete.");
      }
      await clerk.setActive({ session: result.createdSessionId });
    }, token);
    await expect(page.getByTestId("open-saved-decks")).toBeVisible();
  }

  async function api(page: Page, path: string, method = "GET", body?: unknown) {
    return page.evaluate(async ({ apiUrl, path, method, body }) => {
      const token = await (window as any).Clerk.session?.getToken();
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cache: response.headers.get("cache-control"),
        authReason: response.headers.get("x-clerk-auth-reason"),
      };
    }, { apiUrl, path, method, body });
  }

  async function openDeck(page: Page) {
    await page.getByTestId("open-saved-decks").click();
    await page.getByTestId(`saved-deck-${deckId}`).click();
    await expect(page.getByTestId("study-topic")).toHaveValue(topic);
  }

  try {
    for (const label of ["owner", "other"]) {
      const user = await clerk.users.createUser({
        emailAddress: [`skillswipe-${label}-${run}+clerk_test@example.com`],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
      });
      users.push(user.id);
    }
    // Independent browser contexts are independent app installations: no shared
    // cookies, storage, Clerk client, or React Query cache.
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        viewport: { width: 402, height: 874 },
        ignoreHTTPSErrors: Boolean(process.env.CI),
      });
      contexts.push(context);
      if (process.env.ACCOUNTS_TEST_TRACE_DIR) {
        await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
      }
      if (fixture) {
        await context.route(`${apiUrl}/**`, async route => {
          // Transport only: forward the real browser cookies/JWT unchanged to
          // the same createApp + Clerk middleware used by the running server.
          const request = route.request();
          if (request.method() === "GET" && new URL(request.url()).pathname === "/api/flashcards/decks") {
            fixtureListRequests++;
          }
          const response = await route.fetch({
            url: `${fixture.url}${new URL(request.url()).pathname}`,
            headers: { ...await request.allHeaders(), host: new URL(apiUrl).host },
          });
          await route.fulfill({ response });
        });
      }
    }
    const first = await contexts[0].newPage();
    const second = await contexts[1].newPage();
    await Promise.all([first.goto(appUrl), second.goto(appUrl)]);
    await signIn(first, users[0]);
    await signIn(second, users[0]);
    // Exercise the real authenticated generation route with deterministic output.
    const generated = await api(first, "/flashcards/generate", "POST",
      { topic, difficulty: "intermediate", cardCount: 3 });
    expect(generated.status).toBe(200);
    deckId = generated.body.id;
    expect(deckId).toBeTruthy();
    const sessionIds = await Promise.all([first, second].map(page =>
      page.evaluate(() => (window as any).Clerk.session.id)));
    expect(sessionIds[0]).not.toBe(sessionIds[1]);
    // Fail at the auth boundary, not minutes later waiting for a missing row.
    const preflight = await api(first, "/flashcards/decks");
    expect(preflight.status, `Real session JWT auth must succeed (${preflight.authReason ?? "no reason header"})`).toBe(200);
    await openDeck(first);
    const progress = await api(first, `/flashcards/decks/${deckId}/progress`, "PATCH",
      { cardId: "one", status: "known", activeIndex: 1 });
    expect(progress.status).toBe(200);
    await openDeck(second);
    await expect(second.getByText("Private question two", { exact: true })).toBeVisible();
    const opened = await api(second, `/flashcards/decks/${deckId}`);
    expect(opened.status).toBe(200);
    expect(opened.body.activeIndex).toBe(1);
    expect(opened.body.cards[0].status).toBe("known");
    expect(opened.cache).toBe("no-store");

    // Sign out through the shipped button, then switch to another real user
    // without reloading the app (the sensitive cache transition).
    await first.getByTestId("sign-out").click();
    await expect(first.getByText("Welcome back", { exact: true })).toBeVisible();
    await expect(first.getByText("Private question two", { exact: true })).toHaveCount(0);
    await expect(first.getByTestId(`saved-deck-${deckId}`)).toHaveCount(0);
    expect((await api(first, `/flashcards/decks/${deckId}`)).status).toBe(401);
    // Hold the second learner's list request. No cached owner rows may appear
    // while the new account is loading, even if the response is delayed.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const listRequestsBeforeSwitch = fixtureListRequests;
    let heldListRequests = 0;
    await first.route("**/api/flashcards/decks", async route => {
      heldListRequests++;
      await held;
      // Preserve transport through the real middleware and isolated store.
      await route.fallback();
    });
    try {
      await signIn(first, users[1]);
      await first.getByTestId("open-saved-decks").click();
      await expect.poll(() => heldListRequests).toBeGreaterThan(0);
      await expect(first.getByTestId(`saved-deck-${deckId}`)).toHaveCount(0);
      await expect(first.getByTestId("study-topic")).toHaveValue("Biology basics");
      await expect(first.getByText("Private question two", { exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(first.getByText("Your generated decks will appear here.", { exact: true })).toBeVisible();
    if (fixture) {
      expect(fixtureListRequests, "The delayed list must use isolated storage, not the running API").toBeGreaterThan(listRequestsBeforeSwitch);
    }
    await first.getByLabel("Close saved decks").click();
    await first.unroute("**/api/flashcards/decks");

    const listed = await api(first, "/flashcards/decks");
    expect(listed.status).toBe(200);
    expect(listed.body.decks).toEqual([]);
    for (const [path, method, body] of [
      [`/flashcards/decks/${deckId}`, "GET", undefined],
      [`/flashcards/decks/${deckId}/progress`, "PATCH", { cardId: "one", status: "again", activeIndex: 2 }],
      [`/flashcards/decks/${deckId}/restart`, "POST", undefined],
    ] as const) {
      const denied = await api(first, path, method, body);
      expect(denied.status).toBe(404);
      expect(denied.cache).toBe("no-store");
      expect(JSON.stringify(denied.body)).not.toContain(topic);
    }
    const unchanged = await api(second, `/flashcards/decks/${deckId}`);
    expect(unchanged.body.activeIndex).toBe(1);
    expect(unchanged.body.cards[0].status).toBe("known");
    await first.getByTestId("sign-out").click();
    await expect(first.getByText("Welcome back", { exact: true })).toBeVisible();
    await first.waitForFunction(() =>
      Boolean((window as any).Clerk?.loaded) && !(window as any).Clerk.session);
    await signIn(first, users[0]);
    await openDeck(first);
    await expect(first.getByText("Private question two", { exact: true })).toBeVisible();
    await first.reload();
    await expect(first.getByTestId("open-saved-decks")).toBeVisible();
    await openDeck(first);
    await expect(first.getByText("Private question two", { exact: true })).toBeVisible();
  } finally {
    // Only remove fixtures created by this run, including after assertions fail.
    const cleanupErrors: unknown[] = [];
    if (process.env.ACCOUNTS_TEST_TRACE_DIR) {
      // These raw files contain credentials. Only the allowlisted, sanitized
      // copies produced by sanitize-traces.py may become CI artifacts.
      try {
        await mkdir(process.env.ACCOUNTS_TEST_TRACE_DIR, { recursive: true, mode: 0o700 });
        for (const [index, context] of contexts.entries()) {
          await context.tracing.stop({
            path: join(process.env.ACCOUNTS_TEST_TRACE_DIR, `installation-${index + 1}.zip`),
          });
        }
      } catch (error) { cleanupErrors.push(error); }
    }
    const contextCleanup = await Promise.allSettled(contexts.map(context => context.close()));
    cleanupErrors.push(...contextCleanup.filter(result => result.status === "rejected"));
    try { await fixture.close(); } catch (error) { cleanupErrors.push(error); }
    if (store instanceof MongoFlashcardDeckStore) {
      try { await store.close(); } catch (error) { cleanupErrors.push(error); }
    }
    try {
      if (deckId && mongo) {
        await mongo.connect();
        const db = mongo.db(mongoConfig!.databaseName);
        await db.collection("skillswipe_decks").deleteOne({ id: deckId, ownerId: users[0] });
      }
    } catch (error) { cleanupErrors.push(error); }
    finally { await mongo?.close(); }
    for (const userId of users) {
      try { await clerk.users.deleteUser(userId); }
      catch (error) { cleanupErrors.push(error); }
    }
    expect(cleanupErrors, "Temporary account/deck cleanup must succeed").toHaveLength(0);
  }
});
