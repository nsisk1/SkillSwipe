import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { MongoFlashcardDeckStore, type FlashcardDeck } from "../src/lib/flashcard-decks";
import { createFlashcardsRouter } from "../src/routes/flashcards";

// Small Mongo query double: exercises the production store filters/atomic writes
// without contacting a learner database. The opt-in Mongo test covers real Mongo.
function valueAt(doc: any, path: string): any {
  return path.split(".").reduce((value, part) => value?.[part], doc);
}
function matches(doc: any, query: any): boolean {
  return Object.entries(query).every(([key, value]: [string, any]) => {
    if (key === "$or") return value.some((part: any) => matches(doc, part));
    if (key === "$expr") return value.$eq.every((path: string) =>
      valueAt(doc, path.slice(1)) === valueAt(doc, value.$eq[0].slice(1)));
    const actual = valueAt(doc, key);
    if (value instanceof RegExp) return typeof actual === "string" && value.test(actual);
    if (value && typeof value === "object") {
      if ("$gt" in value) return actual > value.$gt;
      if ("$exists" in value) return (actual !== undefined) === value.$exists;
    }
    return actual === value;
  });
}
function fixture(t: any) {
  const store = new MongoFlashcardDeckStore();
  const deck: FlashcardDeck = {
    id: randomUUID(), ownerId: "sw-original-learner", topic: "Private study",
    cards: Array.from({ length: 3 }, (_, index) => ({
      id: `card-${index}`, topic: "Private study", question: `Question ${index}`,
      answer: `Answer ${index}`, status: index === 0 ? "known" as const : "again" as const,
    })),
    activeIndex: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  };
  let unavailable = false;
  const update = (query: any, change: any) => {
    if (unavailable) throw new Error("Database unavailable");
    if (!matches(deck, query)) return false;
    for (const [key, value] of Object.entries(change.$set)) {
      const parts = key.split(".");
      const target = parts.slice(0, -1).reduce((obj: any, part) => obj[part], deck);
      (target as any)[parts.at(-1)!] = structuredClone(value);
    }
    return true;
  };
  const collection = {
    updateOne: async (query: any, change: any) => ({ matchedCount: update(query, change) ? 1 : 0 }),
    findOneAndUpdate: async (query: any, change: any) => update(query, change) ? structuredClone(deck) : null,
    findOne: async (query: any) => {
      if (unavailable) throw new Error("Database unavailable");
      return matches(deck, query) ? structuredClone(deck) : null;
    },
  };
  t.mock.method(store as any, "getCollection", async () => collection);
  const approve = () => store.approveLegacyRecovery({
    deckId: deck.id, legacyOwnerId: "sw-original-learner", targetUserId: "user_recipient",
  });
  return { store, deck, approve, disconnect: () => { unavailable = true; } };
}

test("review is account-bound, non-mutating; transfer preserves history and is atomic/idempotent", async t => {
  const { store, deck, approve } = fixture(t);
  const original = structuredClone(deck);
  const code = await approve();
  assert.match(code, /^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(deck).includes(code.split(".")[1]!));
  assert.equal(await store.reviewLegacyDeck("user_other", code), null);
  assert.equal(await store.transferLegacyDeck("user_other", code), null);
  assert.ok(await store.reviewLegacyDeck("user_recipient", code));
  assert.equal(deck.ownerId, original.ownerId, "review/cancel cannot transfer");
  assert.equal(await store.reviewLegacyDeck("user_recipient", `${deck.id}.${"0".repeat(64)}`), null);

  const [first, retry] = await Promise.all([
    store.transferLegacyDeck("user_recipient", code),
    store.transferLegacyDeck("user_recipient", code),
  ]);
  assert.equal(first?.ownerId, "user_recipient");
  assert.equal(retry?.ownerId, "user_recipient");
  assert.deepEqual(deck.cards, original.cards);
  assert.equal(deck.activeIndex, original.activeIndex);
  assert.equal(deck.createdAt, original.createdAt);
  assert.equal(await store.getDeck(original.ownerId, deck.id), null);
  assert.equal(await store.getDeck("user_other", deck.id), null);
  assert.ok(await store.getDeck("user_recipient", deck.id));
  await assert.rejects(approve(), /No matching legacy deck/);
});

test("expired, revoked and replaced approvals never disclose or transfer a legacy deck", async t => {
  const { store, deck, approve } = fixture(t);
  const firstCode = await approve();
  const secondCode = await approve();
  assert.equal(await store.reviewLegacyDeck("user_recipient", firstCode), null);
  deck.recovery!.expiresAt = "2000-01-01T00:00:00.000Z";
  assert.equal(await store.reviewLegacyDeck("user_recipient", secondCode), null);
  assert.equal(await store.transferLegacyDeck("user_recipient", secondCode), null);
  const thirdCode = await approve();
  delete deck.recovery;
  assert.equal(await store.reviewLegacyDeck("user_recipient", thirdCode), null);
  assert.equal(await store.transferLegacyDeck("user_recipient", thirdCode), null);
  assert.equal(deck.ownerId, "sw-original-learner");
  await assert.rejects(store.approveLegacyRecovery({
    deckId: deck.id, legacyOwnerId: "user_someone", targetUserId: "user_recipient",
  }));
  await assert.rejects(store.approveLegacyRecovery({
    deckId: deck.id, legacyOwnerId: deck.ownerId, targetUserId: "sw-some-device",
  }));
});

test("recovery API requires sign-in and proof, strips private metadata, and fails explicitly on outages", async t => {
  const { store, deck, approve, disconnect } = fixture(t);
  const code = await approve();
  const app = express();
  app.use(express.json());
  app.use(createFlashcardsRouter(undefined, store, req => req.get("x-test-user") ?? null));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const send = async (path: string, body: unknown, user: string | null = "user_recipient") => {
    const response = await fetch(`http://127.0.0.1:${address.port}/flashcards/recovery/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-skillswipe-device-id": "sw-original-learner",
        ...(user ? { "x-test-user": user } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    for (const path of ["review", "transfer"]) {
      assert.equal((await send(path, { code }, null)).status, 401);
      assert.equal((await send(path, { code }, "user_other")).status, 404);
      assert.equal((await send(path, { deviceId: deck.ownerId })).status, 400);
      assert.equal((await send(path, { code: { $ne: "" } })).status, 400);
      assert.equal((await send(path, { code: "bad" })).status, 400);
    }
    const review = await send("review", { code });
    assert.equal(review.status, 200);
    assert.equal(review.headers.get("cache-control"), "no-store");
    assert.equal(review.body.id, deck.id);
    assert.equal(review.body.recovery, undefined);
    assert.equal(review.body.ownerId, undefined);
    assert.equal(deck.ownerId, "sw-original-learner");
    const transfer = await send("transfer", { code });
    assert.equal(transfer.status, 200);
    assert.deepEqual(transfer.body.cards, review.body.cards);
    assert.equal((await send("transfer", { code })).status, 200);
    assert.equal((await send("review", { code }, "user_other")).status, 404);
    disconnect();
    assert.equal((await send("review", { code })).status, 503);
    assert.equal((await send("transfer", { code })).status, 503);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
