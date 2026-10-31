import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { Collection } from "mongodb";
import type { RecoveryAuditEvent } from "../src/lib/recovery-audit";
import { authenticateRecoveryOperator } from "../src/lib/recovery-operator";
import { parseRecoveryHistoryArgs, readRecoveryHistory, runRecoveryHistoryCommand } from "../src/lib/recovery-history";

const deckId = "a85652fa-4f0d-40ed-bca7-a1fe691e8850";
const grantId = "79f7ec63-2d41-445e-83bf-f0de9e11cac9";
const event: RecoveryAuditEvent = {
  id: "b9606336-7232-48ed-8e53-a10eed134f38",
  deckId, grantId, operatorId: "user_operator",
  receivingAccountId: "user_recipient", actorId: "user_operator",
  event: "approval", timestamp: new Date("2026-10-30T00:00:00Z"),
  expiresAt: new Date("2027-10-30T00:00:00Z"),
};
const backend = () => ({
  verify: async (_token: string) => ({ sub: "user_operator", sid: "sess_verified" }),
  session: async (_id: string) => ({ status: "active", userId: "user_operator" }),
  user: async (_id: string) => ({ privateMetadata: { legacyRecoveryOperator: true } }),
});

function harness(rows: unknown[] = [event]) {
  const output: string[] = [];
  const errors: string[] = [];
  const queries: unknown[][] = [];
  let opened = 0;
  let closed = 0;
  const collection = {
    find(...args: unknown[]) {
      queries.push(args);
      return { toArray: async () => rows };
    },
  } as unknown as Collection<RecoveryAuditEvent>;
  const io = {
    readToken: () => "synthetic-private-token",
    out: (text: string) => { output.push(text); },
    error: (text: string) => { errors.push(text); },
  };
  const deps = {
    authenticate: (token: string) => authenticateRecoveryOperator(token, backend()),
    open: async () => {
      opened++;
      return { collection, close: async () => { closed++; } };
    },
  };
  return { io, deps, output, errors, queries, collection, opened: () => opened, closed: () => closed };
}

test("requires exactly one UUID filter and an integer limit of 1-100", () => {
  assert.deepEqual(parseRecoveryHistoryArgs(["--deck-id", deckId]), { field: "deckId", id: deckId, limit: 20 });
  assert.deepEqual(parseRecoveryHistoryArgs(["--grant-id", grantId, "--limit", "100"]), { field: "grantId", id: grantId, limit: 100 });
  for (const args of [
    [], ["--deck-id"], ["--deck-id", ""], ["--deck-id", ".*"],
    ["--grant-id", "pre-audit"], ["--deck-id", '{"$ne":null}'],
    ["--deck-id", deckId, "--grant-id", grantId],
    ["--event", "approval"], ["--deck-id", deckId, "extra"],
    ...["0", "-1", "101", "1.5", "01", "1e2", "Infinity", "NaN", " 2", "2 "]
      .map(limit => ["--deck-id", deckId, "--limit", limit]),
  ]) {
    assert.throws(() => parseRecoveryHistoryArgs(args));
  }
});

test("invalid command input never reads credentials or connects", async () => {
  const h = harness();
  h.io.readToken = () => { throw new Error("must not read"); };
  assert.equal(await runRecoveryHistoryCommand(["--deck-id", "private-code"], h.io, h.deps), 1);
  assert.equal(h.opened(), 0);
  assert.deepEqual(h.output, []);
  assert.ok(!h.errors.join("").includes("private-code"));
});

test("rejects missing, invalid, expired, revoked and non-operator sessions before any database access", async () => {
  const denied = [
    { ...backend(), verify: async () => { throw new Error("private-auth-error"); } },
    { ...backend(), verify: async () => ({ sub: "user_operator" }) },
    ...["revoked", "expired", "ended"].map(status => ({
      ...backend(), session: async () => ({ status, userId: "user_operator" }),
    })),
    { ...backend(), session: async () => ({ status: "active", userId: "user_other" }) },
    ...[{}, { legacyRecoveryOperator: false }, { legacyRecoveryOperator: "true" }].map(privateMetadata => ({
      ...backend(), user: async () => ({ privateMetadata }),
    })),
    { ...backend(), user: async () => { throw new Error("private-role-error"); } },
  ];
  for (const auth of denied) {
    const h = harness();
    h.deps.authenticate = token => authenticateRecoveryOperator(token, auth);
    assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], h.io, h.deps), 1);
    assert.equal(h.opened(), 0);
    assert.deepEqual(h.output, []);
    assert.ok(!h.errors.join("").includes("private-"));
  }
  for (const token of ["", "x".repeat(16385)]) {
    const h = harness();
    h.io.readToken = () => token;
    assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], h.io, h.deps), 1);
    assert.equal(h.opened(), 0);
  }
});

test("both filters use bounded newest-first read-only queries, TTL filtering and an explicit output allowlist", async () => {
  for (const [flag, id, field] of [["--deck-id", deckId, "deckId"], ["--grant-id", grantId, "grantId"]]) {
    const h = harness([{
      ...event, _id: "private-internal-id", secretHash: "never-print-hash",
      code: "never-print-code", evidence: "never-print-evidence",
      credentials: "never-print-credentials", topic: "never-print-topic",
    }]);
    assert.equal(await runRecoveryHistoryCommand([flag!, id!, "--limit", "1"], h.io, h.deps), 0);
    const [filter, options] = h.queries[0]! as [any, any];
    assert.deepEqual(Object.keys(filter).sort(), [field, "expiresAt"].sort());
    assert.equal(filter[field!], id);
    assert.ok(filter.expiresAt.$gt instanceof Date);
    assert.equal(options.limit, 1);
    assert.equal(options.maxTimeMS, 5000);
    assert.deepEqual(options.sort, { timestamp: -1, id: -1 });
    assert.deepEqual(options.projection, {
      _id: 0, id: 1, grantId: 1, deckId: 1, operatorId: 1,
      receivingAccountId: 1, actorId: 1, event: 1, timestamp: 1, expiresAt: 1,
    });
    assert.deepEqual(JSON.parse(h.output.join("")), { events: [JSON.parse(JSON.stringify(event))], limit: 1 });
    assert.ok(!h.output.join("").includes("never-print"));
    assert.equal(h.closed(), 1);
    assert.deepEqual(h.errors, []);
  }
  const h = harness([{ ...event, grantId: "pre-audit" }]);
  assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], h.io, h.deps), 0);
  assert.equal(JSON.parse(h.output[0]!).events[0].grantId, "pre-audit");
});

test("empty history succeeds explicitly, while open/read/close failures fail without leaking details or partial results", async () => {
  const empty = harness([]);
  assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], empty.io, empty.deps), 0);
  assert.deepEqual(JSON.parse(empty.output[0]!), { events: [], limit: 20 });
  assert.equal(empty.closed(), 1);

  for (const stage of ["open", "read", "close"]) {
    const h = harness();
    h.deps.open = async () => {
      if (stage === "open") throw new Error("mongodb://private-credentials");
      return {
        collection: {
          find() { return { toArray: async () => { throw new Error("private-evidence"); } }; },
        } as unknown as Collection<RecoveryAuditEvent>,
        close: async () => { throw new Error("private-code"); },
        ...(stage === "close" ? { collection: h.collection } : {}),
      };
    };
    assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], h.io, h.deps), 1);
    assert.deepEqual(h.output, []);
    assert.ok(!h.errors.join("").includes("private-"));
  }
});

test("malformed records never print a partial history or unvalidated free text", async () => {
  for (const patch of [
    { event: "private-code" }, { actorId: "raw private evidence" },
    { timestamp: "private-string" }, { timestamp: new Date(NaN) },
    { grantId: ["private-code"] }, { operatorId: ["user_operator"] },
  ]) {
    const h = harness([event, { ...event, ...patch }]);
    assert.equal(await runRecoveryHistoryCommand(["--deck-id", deckId], h.io, h.deps), 1);
    assert.deepEqual(h.output, []);
    assert.equal(h.closed(), 1);
  }
});

test("library callers cannot bypass filter and limit validation", async () => {
  const h = harness();
  for (const input of [
    { field: "$where", id: deckId, limit: 20 },
    { field: "deckId", id: deckId, limit: 0 },
    { field: "deckId", id: deckId, limit: 101 },
    { field: "deckId", id: { $ne: null }, limit: 20 },
  ]) {
    await assert.rejects(readRecoveryHistory(h.collection, input as any));
  }
  assert.deepEqual(h.queries, []);
});

test("terminal entrypoint exits nonzero and never echoes invalid arguments, missing or oversized stdin", () => {
  for (const [args, input] of [
    [["--deck-id", "private-invalid-filter"], ""],
    [["--deck-id", deckId], ""],
    [["--deck-id", deckId], "private-token".repeat(2000)],
  ] as const) {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/scripts/legacy-recovery-history.ts", ...args,
    ], { input, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.length > 0);
    assert.ok(!result.stderr.includes("private-"));
    assert.ok(!result.stderr.includes("Error:"));
  }
});
