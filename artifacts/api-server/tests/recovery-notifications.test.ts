import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliverRecoveryNotification,
  recoveryNotificationConfig,
  RecoveryNotificationWorker,
} from "../src/lib/recovery-notifications";
import { MongoLegacyRecoveryRequestInbox } from "../src/lib/legacy-recovery-requests";

const config = { url: "https://private.example.test/notify", token: "synthetic-test-token" };
const saved = {
  requestId: "721f3e41-2de7-4c94-a076-9e623736a033",
  createdAt: "2026-10-31T12:00:00.000Z",
};

test("private destination confirmation and complete HTTPS credentials are required; absent config disables alerts", () => {
  assert.equal(recoveryNotificationConfig({}), null);
  const env = {
    RECOVERY_NOTIFICATION_WEBHOOK_URL: config.url,
    RECOVERY_NOTIFICATION_WEBHOOK_TOKEN: config.token,
    RECOVERY_NOTIFICATION_PRIVATE_DESTINATION: "confirmed",
  };
  assert.deepEqual(recoveryNotificationConfig(env), config);
  for (const patch of [
    { RECOVERY_NOTIFICATION_WEBHOOK_URL: "" },
    { RECOVERY_NOTIFICATION_WEBHOOK_TOKEN: "" },
    { RECOVERY_NOTIFICATION_WEBHOOK_TOKEN: "token\r\ninjected" },
    { RECOVERY_NOTIFICATION_PRIVATE_DESTINATION: "" },
    { RECOVERY_NOTIFICATION_PRIVATE_DESTINATION: "public" },
    ...["http://private.example.test", "https://user:pass@example.test", "https://example.test/#fragment", "not a URL"]
      .map(url => ({ RECOVERY_NOTIFICATION_WEBHOOK_URL: url })),
  ]) assert.throws(() => recoveryNotificationConfig({ ...env, ...patch }));
});

test("webhook sends only a minimal receipt, uses stable deduplication and bounded non-redirecting delivery", async () => {
  const calls: RequestInit[] = [];
  const send: typeof fetch = async (url, init) => {
    assert.equal(url, config.url);
    calls.push(init!);
    return new Response(null, { status: 204 });
  };
  const privateRecord = {
    ...saved, learnerId: "user_private", replyEmail: "never-send@example.test",
    evidence: "private evidence", topic: "private topic", code: "private code",
  };
  await deliverRecoveryNotification(config, privateRecord, send);
  await deliverRecoveryNotification(config, privateRecord, send);
  const first = calls[0]!;
  assert.equal(first.method, "POST");
  assert.equal(first.redirect, "error");
  assert.ok(first.signal instanceof AbortSignal);
  assert.deepEqual(first.headers, {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
    "Idempotency-Key": `recovery-request-${saved.requestId}`,
  });
  assert.deepEqual(calls[1]?.headers, first.headers);
  const body = JSON.parse(first.body as string);
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "event", "message", "requestId"]);
  assert.equal(body.requestId, saved.requestId);
  assert.equal(body.createdAt, saved.createdAt);
  assert.equal(body.event, "recovery_request.pending");
  assert.match(body.message, /not recovery approval/);
  for (const status of [302, 401, 429, 500]) {
    await assert.rejects(deliverRecoveryNotification(config, saved, async () =>
      new Response("secret response content", { status })), /not acknowledged/);
  }
  for (const name of ["TimeoutError", "TypeError"]) {
    await assert.rejects(deliverRecoveryNotification(config, saved, async () => {
      throw new DOMException("sensitive transport details", name);
    }));
  }
});

test("worker delivery failure cannot remove requests, approves nothing, and later retry succeeds without logging private errors", async () => {
  const logs: unknown[] = [];
  const finishes: unknown[][] = [];
  let available = true;
  let fail = true;
  const now = new Date(saved.createdAt);
  const queue = {
    async claimNotification() {
      if (!available) return null;
      available = false;
      return { ...saved, leaseId: "lease" };
    },
    async finishNotification(...args: [string, string, boolean, Date]) { finishes.push(args); },
  };
  const worker = new RecoveryNotificationWorker(queue, async request => {
    assert.deepEqual(request, saved);
    if (fail) throw new Error("email, token and provider response must never be logged");
  }, { warn: (...args: unknown[]) => logs.push(args), info: (...args: unknown[]) => logs.push(args) } as any, () => now);
  await worker.drain();
  assert.deepEqual(finishes, [[saved.requestId, "lease", false, now]]);
  fail = false;
  available = true; // Simulate the persisted retry becoming eligible.
  await worker.drain();
  assert.deepEqual(finishes[1], [saved.requestId, "lease", true, now]);
  assert.ok(!JSON.stringify(logs).includes("provider response"));
  assert.ok(!JSON.stringify(logs).includes(saved.requestId));
});

test("worker bounds each tick, prevents overlapping ticks and safely handles queue or acknowledgement failures", async () => {
  let claims = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const worker = new RecoveryNotificationWorker({
    async claimNotification() { claims++; return { ...saved, leaseId: "lease" }; },
    async finishNotification() {},
  }, async () => blocked, { warn() {}, info() {} } as any);
  const first = worker.drain();
  await worker.drain();
  assert.equal(claims, 1);
  release();
  await first;
  assert.equal(claims, 20);
  for (const failAt of ["claim", "finish"]) {
    let warnings = 0;
    const broken = new RecoveryNotificationWorker({
      async claimNotification() {
        if (failAt === "claim") throw new Error("private database details");
        return { ...saved, leaseId: "lease" };
      },
      async finishNotification() { throw new Error("private acknowledgement details"); },
    }, async () => {}, { warn() { warnings++; }, info() {} } as any);
    await broken.drain();
    await broken.drain(); // A failed tick must release its local lock.
    assert.equal(warnings, 2);
  }
});

test("Mongo queue atomically leases only pending unsent requests; retry and acknowledgements match the current lease", async t => {
  const inbox = new MongoLegacyRecoveryRequestInbox();
  const claims: unknown[][] = [];
  const updates: unknown[][] = [];
  const now = new Date(saved.createdAt);
  let hasRequest = true;
  t.mock.method(inbox as any, "getCollection", async () => ({
    async findOneAndUpdate(...args: unknown[]) {
      claims.push(args);
      return hasRequest ? { ...saved, learnerId: "private", replyEmail: "private@example.test" } : null;
    },
    async updateOne(...args: unknown[]) { updates.push(args); },
  }));
  const claim = await inbox.claimNotification(now);
  assert.ok(claim);
  assert.deepEqual(Object.keys(claim).sort(), ["createdAt", "leaseId", "requestId"]);
  assert.deepEqual(claims[0], [{
    status: "pending",
    "notification.deliveredAt": { $exists: false },
    $or: [
      { "notification.nextAttemptAt": { $exists: false } },
      { "notification.nextAttemptAt": { $lte: now.toISOString() } },
    ],
  }, {
    $set: {
      "notification.leaseId": claim.leaseId,
      "notification.nextAttemptAt": "2026-10-31T12:01:00.000Z",
    },
    $inc: { "notification.attempts": 1 },
  }, { sort: { createdAt: 1 }, returnDocument: "after" }]);
  await inbox.finishNotification(claim.requestId, claim.leaseId, false, now);
  await inbox.finishNotification(claim.requestId, claim.leaseId, true, now);
  assert.deepEqual(updates, [
    [{ requestId: saved.requestId, "notification.leaseId": claim.leaseId }, {
      $set: { "notification.nextAttemptAt": "2026-10-31T12:05:00.000Z" },
      $unset: { "notification.leaseId": "" },
    }],
    [{ requestId: saved.requestId, "notification.leaseId": claim.leaseId }, {
      $set: { "notification.deliveredAt": saved.createdAt },
      $unset: { "notification.leaseId": "" },
    }],
  ]);
  hasRequest = false;
  assert.equal(await inbox.claimNotification(now), null);
});
