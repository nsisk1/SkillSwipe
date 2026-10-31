import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClerkClient } from "@clerk/express";
import { test as base, expect, type Page } from "@playwright/test";
import type {
  LegacyRecoveryRequest, LegacyRecoveryRequestInbox,
} from "../../src/lib/legacy-recovery-requests";
import { AccountTestStore, startAccountFixture } from "./fixture-server";

// The route, auth middleware, client and shipped modal are real. Only private
// persistence is replaced; never use MONGODB_URI or discover legacy decks here.
class RecoveryTestInbox implements LegacyRecoveryRequestInbox {
  readonly requests = new Map<string, LegacyRecoveryRequest>();
  readonly attempts: { learnerId: string; replyEmail: string }[] = [];
  unavailable = false;

  async submit(learnerId: string, replyEmail: string) {
    this.attempts.push({ learnerId, replyEmail });
    if (this.unavailable) throw new Error("Controlled private inbox outage");
    const existing = this.requests.get(learnerId);
    if (existing) return structuredClone(existing);
    const request: LegacyRecoveryRequest = {
      requestId: randomUUID(), learnerId, replyEmail,
      createdAt: new Date().toISOString(), status: "pending",
    };
    this.requests.set(learnerId, request);
    return structuredClone(request);
  }
}

type RecoveryFixture = {
  page: Page;
  inbox: RecoveryTestInbox;
  ownerId: string;
  submissions: unknown[];
};

const test = base.extend<{ recovery: RecoveryFixture }>({
  recovery: async ({ browser }, use, testInfo) => {
    if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
        !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
      throw new Error("Recovery UI tests require development Clerk keys.");
    }
    const appUrl = process.env.ACCOUNTS_TEST_APP_URL ??
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined);
    if (!appUrl) throw new Error("Set ACCOUNTS_TEST_APP_URL or start the development app.");

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const inbox = new RecoveryTestInbox();
    const fixture = await startAccountFixture(new AccountTestStore(), inbox);
    let ownerId: string | undefined;
    const context = await browser.newContext({
      viewport: { width: 402, height: 874 },
      ignoreHTTPSErrors: Boolean(process.env.CI),
      serviceWorkers: "block",
    });
    const submissions: unknown[] = [];
    const forbidden: string[] = [];
    const traceDir = process.env.ACCOUNTS_TEST_TRACE_DIR;
    try {
      if (traceDir) {
        await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
      }
      const user = await clerk.users.createUser({
        emailAddress: [`sw-recovery-${randomUUID()}+clerk_test@example.com`],
        skipPasswordRequirement: true,
        skipLegalChecks: true,
      });
      ownerId = user.id;
      // Intercept every API origin, not just the Expo host. Fail closed for any
      // discovery, code review, transfer or generation, even on a broken UI.
      await context.route("**/api/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const isSubmission = path === "/api/flashcards/recovery/requests" &&
          request.method() === "POST";
        const isList = path === "/api/flashcards/decks" && request.method() === "GET";
        if (!isSubmission && !isList) {
          forbidden.push(`${request.method()} ${path}`);
          await route.fulfill({ status: 500, json: { error: "Outside recovery form fixture" } });
          return;
        }
        if (isSubmission) submissions.push(request.postDataJSON());
        const response = await route.fetch({
          url: `${fixture.url}${path}`,
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
      await page.getByTestId("open-recovery").click();
      await expect(page.getByText(`Receiving account: ${user.id}`, { exact: true })).toBeVisible();
      await page.getByTestId("open-recovery-request").click();
      await expect(page.getByText("Private verification request", { exact: true })).toBeVisible();
      await use({ page, inbox, ownerId: user.id, submissions });
    } finally {
      const cleanupErrors: unknown[] = [];
      if (traceDir) {
        try {
          // Raw traces may contain tickets. Only the existing allowlist
          // sanitizer's output may be uploaded by CI.
          const failed = testInfo.status !== testInfo.expectedStatus;
          if (failed) await mkdir(traceDir, { recursive: true, mode: 0o700 });
          await context.tracing.stop(failed ? {
            path: join(traceDir, `recovery-${randomUUID()}.zip`),
          } : undefined);
        } catch (error) { cleanupErrors.push(error); }
      }
      const results = await Promise.allSettled([
        context.close(),
        fixture.close(),
        ...(ownerId ? [clerk.users.deleteUser(ownerId)] : []),
      ]);
      cleanupErrors.push(...results.filter(result => result.status === "rejected"));
      // These maps contain only this test's fixtures, never shared app data.
      inbox.requests.clear();
      expect(cleanupErrors, "Temporary recovery test resources must be removed").toHaveLength(0);
      expect(forbidden, "Recovery requests must not discover or transfer decks").toEqual([]);
    }
  },
});

test.use({ actionTimeout: 20_000 });

test("invalid email stays local, cancellation discards it, and approved-code entry still works", async ({ recovery }) => {
  const { page, inbox, submissions } = recovery;
  const email = page.getByTestId("recovery-request-email");
  const submit = page.getByTestId("submit-recovery-request");
  await expect(submit).toBeDisabled();
  await email.fill("not-an-email");
  await submit.click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Enter a valid email where the operator can reply.");
  await expect(page.getByTestId("recovery-request-success")).toHaveCount(0);
  expect(submissions).toEqual([]);
  expect(inbox.attempts).toEqual([]);

  await email.fill("cancelled@example.com");
  await page.getByTestId("cancel-recovery").click();
  await expect(page.getByTestId("recovery-request-email")).toHaveCount(0);
  await page.getByTestId("open-saved-decks").click();
  await page.getByTestId("open-recovery").click();
  await expect(page.getByTestId("recovery-code")).toHaveValue("");
  await page.getByTestId("open-recovery-request").click();
  await expect(email).toHaveValue("");
  await expect(page.getByTestId("recovery-error")).toHaveCount(0);
  await page.getByTestId("open-recovery-request").click();
  await expect(email).toHaveCount(0);
  await expect(page.getByText("Account-approved recovery code", { exact: true })).toBeVisible();
  await page.getByTestId("recovery-code").fill("incomplete-code");
  await page.getByTestId("review-recovery").click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Enter the complete recovery code supplied after ownership verification.");
  expect(submissions).toEqual([]);
  expect(inbox.requests.size).toBe(0);
});

test("a private receipt and a duplicate keep the original reference and contact", async ({ recovery }) => {
  const { page, inbox, ownerId, submissions } = recovery;
  await expect(page.getByText(/No decks are searched or transferred/)).toBeVisible();
  await page.getByTestId("recovery-request-email").fill("  original@example.com  ");
  await page.getByTestId("submit-recovery-request").click();
  const receipt = page.getByTestId("recovery-request-success");
  await expect(receipt).toBeVisible();
  const saved = structuredClone(inbox.requests.get(ownerId)!);
  expect(saved).toMatchObject({ learnerId: ownerId, replyEmail: "original@example.com", status: "pending" });
  expect(saved.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(receipt).toContainText(`Request saved. Reference: ${saved.requestId}`);
  await expect(receipt).toContainText("The operator can reply to original@example.com.");
  await expect(receipt).toContainText("This is not a recovery approval.");
  await expect(page.getByTestId("recovery-request-email")).toHaveCount(0);
  await expect(page.getByTestId("submit-recovery-request")).toHaveCount(0);
  expect(submissions).toEqual([{ replyEmail: "original@example.com" }]);

  // Reopen the same signed-in form, not another account/session. A second POST
  // with a different contact must show the first receipt, not the submitted one.
  await page.getByTestId("cancel-recovery").click();
  await expect(receipt).toHaveCount(0);
  await page.getByTestId("open-saved-decks").click();
  await page.getByTestId("open-recovery").click();
  await page.getByTestId("open-recovery-request").click();
  await page.getByTestId("recovery-request-email").fill("replacement@example.com");
  await page.getByTestId("submit-recovery-request").click();
  await expect(receipt).toContainText(`Request saved. Reference: ${saved.requestId}`);
  await expect(receipt).toContainText("The operator can reply to original@example.com.");
  await expect(receipt).not.toContainText("replacement@example.com");
  expect(submissions).toEqual([
    { replyEmail: "original@example.com" }, { replyEmail: "replacement@example.com" },
  ]);
  expect(inbox.attempts).toEqual([
    { learnerId: ownerId, replyEmail: "original@example.com" },
    { learnerId: ownerId, replyEmail: "replacement@example.com" },
  ]);
  expect([...inbox.requests.values()]).toEqual([saved]);
});

test("an unavailable inbox is unconfirmed and an explicit retry succeeds", async ({ recovery }) => {
  const { page, inbox, ownerId, submissions } = recovery;
  inbox.unavailable = true;
  await page.getByTestId("recovery-request-email").fill("retry@example.com");
  const response = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/flashcards/recovery/requests");
  await page.getByTestId("submit-recovery-request").click();
  expect((await response).status()).toBe(503);
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Your request could not be confirmed. Check your connection and try again. Retrying will not create another open request.");
  await expect(page.getByTestId("recovery-request-success")).toHaveCount(0);
  await expect(page.getByTestId("recovery-request-email")).toHaveValue("retry@example.com");
  await expect(page.getByTestId("submit-recovery-request")).toBeEnabled();
  await expect(page.getByTestId("cancel-recovery")).toBeEnabled();
  expect(inbox.requests.size).toBe(0);
  expect(inbox.attempts).toHaveLength(1); // No hidden automatic mutation retry.
  expect(submissions).toEqual([{ replyEmail: "retry@example.com" }]);

  inbox.unavailable = false;
  await page.getByTestId("submit-recovery-request").click();
  await expect(page.getByTestId("recovery-request-success")).toBeVisible();
  await expect(page.getByTestId("recovery-error")).toHaveCount(0);
  const saved = inbox.requests.get(ownerId)!;
  await expect(page.getByTestId("recovery-request-success")).toContainText(
    `Request saved. Reference: ${saved.requestId}`);
  await expect(page.getByTestId("recovery-request-success")).toContainText(
    "The operator can reply to retry@example.com.");
  expect(inbox.requests.size).toBe(1);
  expect(inbox.attempts).toEqual(Array(2).fill({ learnerId: ownerId, replyEmail: "retry@example.com" }));
  expect(submissions).toEqual(Array(2).fill({ replyEmail: "retry@example.com" }));
});
