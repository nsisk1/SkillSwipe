import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { MongoServerError } from "mongodb";
import {
  MongoLegacyRecoveryRequestInbox,
  type LegacyRecoveryRequest,
} from "../src/lib/legacy-recovery-requests";
import { createFlashcardsRouter } from "../src/routes/flashcards";
import type { FlashcardDeckStore } from "../src/lib/flashcard-decks";

test("private inbox atomically preserves the original contact across retries, isolates accounts and closes without approving decks", async t => {
  const inbox = new MongoLegacyRecoveryRequestInbox();
  const records: LegacyRecoveryRequest[] = [];
  let race = false;
  const collection = {
    async findOneAndUpdate(filter: { learnerId: string; status: string }, change: { $setOnInsert: LegacyRecoveryRequest }, options: unknown) {
      assert.deepEqual(options, { upsert: true, returnDocument: "after" });
      assert.equal(filter.status, "pending");
      if (race) throw new MongoServerError({ message: "Duplicate", code: 11000 });
      const existing = records.find(r => r.learnerId === filter.learnerId && r.status === filter.status);
      if (existing) return structuredClone(existing);
      records.push(structuredClone(change.$setOnInsert));
      return structuredClone(change.$setOnInsert);
    },
    async findOne(filter: { learnerId: string; status: string }) {
      return records.find(r => r.learnerId === filter.learnerId && r.status === filter.status) ?? null;
    },
    async updateOne(filter: { requestId: string; status: string }, change: { $set: Partial<LegacyRecoveryRequest> }) {
      const record = records.find(r => r.requestId === filter.requestId && r.status === filter.status);
      if (record) Object.assign(record, change.$set);
      return { matchedCount: record ? 1 : 0 };
    },
  };
  t.mock.method(inbox as any, "getCollection", async () => collection);
  const first = await inbox.submit("user_first", "first@example.com");
  const [retry, other] = await Promise.all([
    inbox.submit("user_first", "changed@example.com"),
    inbox.submit("user_second", "second@example.com"),
  ]);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.replyEmail, first.replyEmail);
  assert.notEqual(other.requestId, first.requestId);
  assert.equal(other.learnerId, "user_second");
  assert.deepEqual(Object.keys(first).sort(), ["createdAt", "learnerId", "replyEmail", "requestId", "status"]);
  race = true;
  assert.deepEqual(await inbox.submit("user_first", "changed@example.com"), first);
  race = false;
  assert.equal(await inbox.closeRequest(first.requestId), true);
  assert.equal(await inbox.closeRequest(first.requestId), false);
  assert.equal(records[0]?.status, "closed");
  assert.ok(records[0]?.closedAt);
  assert.notEqual((await inbox.submit("user_first", "new@example.com")).requestId, first.requestId);
});

test("submission requires a session, accepts only email, never accesses decks, and returns a private receipt or explicit failure", async t => {
  const submissions: { learnerId: string; replyEmail: string }[] = [];
  let unavailable = false;
  // Any deck lookup/write is a test failure, including device-based discovery.
  const decks = new Proxy({} as FlashcardDeckStore, {
    get: () => () => { throw new Error("Requests must not access decks"); },
  });
  const inbox = {
    async submit(learnerId: string, replyEmail: string): Promise<LegacyRecoveryRequest> {
      if (unavailable) throw new Error("Private database connection details");
      submissions.push({ learnerId, replyEmail });
      return {
        learnerId, replyEmail, requestId: randomUUID(),
        status: "pending", createdAt: new Date().toISOString(),
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createFlashcardsRouter(undefined, decks, req => req.get("x-test-user") ?? null, inbox));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const send = async (body: unknown, user: string | null = "user_first", method = "POST") => {
    const response = await fetch(`http://127.0.0.1:${address.port}/flashcards/recovery/requests`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-skillswipe-device-id": "sw-shared-device",
        ...(user ? { "x-test-user": user } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    return response;
  };
  const email = { replyEmail: "learner@example.com" };
  assert.equal((await send(email, null)).status, 401);
  for (const body of [
    {}, { replyEmail: "bad" }, { replyEmail: `${"a".repeat(250)}@example.com` },
    { replyEmail: { $ne: "" } }, { ...email, learnerId: "user_victim" },
    { ...email, deviceId: "sw-shared-device" }, { ...email, deckId: randomUUID() },
    { ...email, topic: "Guessing private topics" }, { ...email, ownershipVerified: true },
  ]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal(submissions.length, 0);
  for (const user of ["user_first", "user_second"]) {
    const response = await send(email, user);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const receipt = await response.json();
    assert.deepEqual(Object.keys(receipt).sort(), ["replyEmail", "requestId"]);
    assert.match(receipt.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(receipt.replyEmail, email.replyEmail);
    assert.equal(submissions.at(-1)?.learnerId, user);
  }
  assert.equal((await send(undefined, "user_first", "GET")).status, 404);
  unavailable = true;
  const failed = await send(email);
  assert.equal(failed.status, 503);
  const failure = await failed.json();
  assert.match(failure.error, /could not be confirmed/);
  assert.ok(!JSON.stringify(failure).includes("Private database"));
  assert.equal(submissions.length, 2);
});
