import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import pino from "pino";
import { logger, reportRecoveryFailure } from "../src/lib/logger";
import { writeRecoveryAudit } from "../src/lib/recovery-audit";
import { MongoFlashcardDeckStore } from "../src/lib/flashcard-decks";
import { createFlashcardsRouter } from "../src/routes/flashcards";

const privateError = new Error("mongodb://credentials recovery-code secret-hash evidence");
const auditInput = {
  grantId: "private-grant", deckId: "private-deck", operatorId: "user_private",
  receivingAccountId: "user_recipient", actorId: "user_private", event: "transfer" as const,
};

function capture(t: any, broken = false) {
  const records: unknown[][] = [];
  t.mock.method(logger, "error", (...args: unknown[]) => {
    records.push(args);
    if (broken) throw new Error("Logging unavailable");
  });
  return records;
}

// Exercise the actual transaction wrapper, not a replacement for it. The
// existing recovery tests exercise account filters and mutation rollback.
function transactionHarness(t: any, options: {
  setup?: "connect" | "first-index" | "second-index" | "session";
  commit?: boolean;
  retry?: boolean;
  start?: boolean;
} = {}) {
  const store = new MongoFlashcardDeckStore();
  let indexes = 0;
  let ended = 0;
  let started = 0;
  const audit = {
    createIndex: async () => {
      indexes++;
      if (options.setup === (indexes === 1 ? "first-index" : "second-index")) throw privateError;
    },
  };
  const session = {
    withTransaction: async (work: () => Promise<unknown>) => {
      started++;
      if (options.start) throw privateError;
      const result = await work();
      if (options.retry) await work();
      if (options.commit) throw privateError;
      return result;
    },
    endSession: async () => { ended++; },
  };
  (store as any).clientPromise = Promise.resolve({
    db: () => ({ collection: () => audit }),
    startSession: () => {
      if (options.setup === "session") throw privateError;
      return session;
    },
  });
  t.mock.method(store as any, "getCollection", async () => {
    if (options.setup === "connect") throw privateError;
    return { dbName: "test" };
  });
  return {
    run: (work: () => Promise<unknown>, operation = "transfer") =>
      (store as any).withRecoveryTransaction(work, operation),
    ended: () => ended,
    started: () => started,
  };
}

test("operational log output contains only fixed allowlisted fields, even with hostile runtime values", async () => {
  const lines: string[] = [];
  const sink = pino({ base: null, timestamp: false }, { write: (line: string) => { lines.push(line); } });
  reportRecoveryFailure("insert", "transfer", sink);
  reportRecoveryFailure("recovery-code" as any, "secret-hash evidence" as any, sink);
  assert.deepEqual(lines.map(line => JSON.parse(line)), [
    { level: 50, event: "recovery_operation_failed", stage: "insert", operation: "transfer", msg: "Recovery operation unavailable" },
    { level: 50, event: "recovery_operation_failed", stage: "unknown", operation: "unknown", msg: "Recovery operation unavailable" },
  ]);
  reportRecoveryFailure("setup", "approval", { error: () => { throw privateError; } });
  reportRecoveryFailure("setup", "approval", { error: async () => { throw privateError; } });
  await new Promise(resolve => setImmediate(resolve));
});

test("connection, either audit index, and session setup failures block work and report without error details", async t => {
  for (const setup of ["connect", "first-index", "second-index", "session"] as const) {
    await t.test(setup, async t => {
      const logs = capture(t, true);
      const h = transactionHarness(t, { setup });
      let calls = 0;
      await assert.rejects(h.run(async () => { calls++; }), error => error === privateError);
      assert.equal(calls, 0);
      assert.equal(h.started(), 0);
      assert.deepEqual(logs, [[{
        event: "recovery_operation_failed", stage: "setup", operation: "transfer",
      }, "Recovery operation unavailable"]]);
    });
  }
});

test("audit insertion reports safely for every mutation and rethrows the original labeled error", async t => {
  const logs = capture(t, true);
  for (const event of ["approval", "revocation", "transfer"] as const) {
    await assert.rejects(writeRecoveryAudit({
      insertOne: async () => { throw privateError; },
    } as any, {} as any, { ...auditInput, event }), error => error === privateError);
  }
  assert.deepEqual(logs.map(args => args[0]), ["approval", "revocation", "transfer"].map(operation => ({
    event: "recovery_operation_failed", stage: "insert", operation,
  })));
  assert.ok(!JSON.stringify(logs).includes("private"));
});

test("successful audit writes still explicitly allowlist persisted fields", async () => {
  let stored: any;
  await writeRecoveryAudit({ insertOne: async (value: unknown) => { stored = value; } } as any,
    {} as any, { ...auditInput, code: "recovery-code", evidence: "evidence", secretHash: "hash" } as any);
  assert.deepEqual(Object.keys(stored).sort(), [
    ...Object.keys(auditInput), "id", "timestamp", "expiresAt",
  ].sort());
  assert.equal(stored.expiresAt.getTime() - stored.timestamp.getTime(), 365 * 86400 * 1000);
});

test("final commit and transaction-start failures report once without changing errors or cleanup", async t => {
  for (const operation of ["approval", "revocation", "transfer"]) {
    await t.test(operation, async t => {
      const logs = capture(t, true);
      const h = transactionHarness(t, { commit: true });
      await assert.rejects(h.run(async () => "private-result", operation), error => error === privateError);
      assert.equal(h.ended(), 1);
      assert.deepEqual(logs.map(args => args[0]), [{
        event: "recovery_operation_failed", stage: "commit", operation,
      }]);
    });
  }
  await t.test("transaction start", async t => {
    const logs = capture(t);
    const h = transactionHarness(t, { start: true });
    await assert.rejects(h.run(async () => "unused"), error => error === privateError);
    assert.equal((logs[0]![0] as any).stage, "transaction");
    assert.equal(h.ended(), 1);
  });
});

test("driver retries, callback rejection, invalid-code nulls and successful results are not false commit alerts", async t => {
  const logs = capture(t, true);
  const h = transactionHarness(t, { retry: true });
  let calls = 0;
  await assert.rejects(h.run(async () => {
    if (++calls === 2) throw privateError;
    return "first attempt";
  }), error => error === privateError);
  const success = transactionHarness(t);
  assert.equal(await success.run(async () => null), null);
  assert.equal(await success.run(async () => "confirmed"), "confirmed");
  assert.deepEqual(logs, []);
});

test("recovery HTTP failures stay generic 503s even when reporting throws; invalid codes remain 404/400", async t => {
  const logs = capture(t, true);
  const store = {
    reviewLegacyDeck: async (_user: string, code: string) => {
      if (code.endsWith("0".repeat(64))) return null;
      throw privateError;
    },
    transferLegacyDeck: async () => { throw privateError; },
  };
  const app = express();
  app.use(express.json());
  app.use(createFlashcardsRouter(undefined, store as any, () => "user_recipient"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const send = (action: string, code: string) => fetch(`http://127.0.0.1:${address.port}/flashcards/recovery/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  });
  const prefix = "12345678-1234-1234-1234-123456789012.";
  for (const action of ["review", "transfer"]) {
    const response = await send(action, prefix + "a".repeat(64));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Recovery is unavailable right now. Please try again." });
  }
  assert.equal((await send("review", prefix + "0".repeat(64))).status, 404);
  assert.equal((await send("transfer", "bad")).status, 400);
  assert.deepEqual(logs.map(args => args[0]), ["review", "transfer"].map(operation => ({
    event: "recovery_operation_failed", stage: "request", operation,
  })));
});
