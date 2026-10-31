import { MongoClient, type Collection, type Filter } from "mongodb";
import { authenticateRecoveryOperator } from "./recovery-operator";
import { RECOVERY_AUDIT_COLLECTION, type RecoveryAuditEvent } from "./recovery-audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT = /^user_[A-Za-z0-9_-]{1,128}$/;
export const RECOVERY_HISTORY_USAGE =
  "Usage: tsx src/scripts/legacy-recovery-history.ts (--deck-id DECK_UUID | --grant-id GRANT_UUID) [--limit 1-100] (operator session on stdin)\n";

export type RecoveryHistoryFilter = {
  field: "deckId" | "grantId";
  id: string;
  limit: number;
};

export function parseRecoveryHistoryArgs(args: string[]): RecoveryHistoryFilter {
  if (
    (args.length !== 2 && args.length !== 4) ||
    (args[0] !== "--deck-id" && args[0] !== "--grant-id") ||
    !UUID.test(args[1] ?? "") ||
    (args.length === 4 && (args[2] !== "--limit" || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(args[3] ?? "")))
  ) throw new Error("Invalid history filter.");
  return {
    field: args[0] === "--deck-id" ? "deckId" : "grantId",
    id: args[1]!,
    limit: args.length === 4 ? Number(args[3]) : 20,
  };
}

// Reconstruct the allowlist even after Mongo projection. Never serialize a raw
// document or trust a TypeScript type to remove unexpected stored properties.
function safeEvent(row: RecoveryAuditEvent): RecoveryAuditEvent {
  if (
    !row || ![
      row.id, row.deckId, row.grantId, row.operatorId,
      row.receivingAccountId, row.actorId, row.event,
    ].every(value => typeof value === "string") ||
    !UUID.test(row.id) || !UUID.test(row.deckId) ||
    !(UUID.test(row.grantId) || row.grantId === "pre-audit") ||
    !ACCOUNT.test(row.operatorId) || !ACCOUNT.test(row.receivingAccountId) ||
    !ACCOUNT.test(row.actorId) ||
    !["approval", "revocation", "transfer"].includes(row.event) ||
    !(row.timestamp instanceof Date) || !Number.isFinite(row.timestamp.getTime()) ||
    !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
  ) throw new Error("Invalid audit record.");
  return {
    id: row.id, grantId: row.grantId, deckId: row.deckId,
    operatorId: row.operatorId, receivingAccountId: row.receivingAccountId,
    actorId: row.actorId, event: row.event,
    timestamp: row.timestamp, expiresAt: row.expiresAt,
  };
}

export async function readRecoveryHistory(
  collection: Collection<RecoveryAuditEvent>,
  input: RecoveryHistoryFilter,
  now = new Date(),
): Promise<RecoveryAuditEvent[]> {
  // Validate here as well so future callers cannot bypass the CLI boundary.
  if (input.field !== "deckId" && input.field !== "grantId") throw new Error("Invalid history filter.");
  parseRecoveryHistoryArgs([
    input.field === "deckId" ? "--deck-id" : "--grant-id", input.id,
    "--limit", String(input.limit),
  ]);
  const filter: Filter<RecoveryAuditEvent> = {
    [input.field]: input.id,
    // Do not disclose expired events while waiting for asynchronous TTL cleanup.
    expiresAt: { $gt: now },
  };
  const rows = await collection.find(filter, {
    projection: {
      _id: 0, id: 1, grantId: 1, deckId: 1, operatorId: 1,
      receivingAccountId: 1, actorId: 1, event: 1, timestamp: 1, expiresAt: 1,
    },
    sort: { timestamp: -1, id: -1 },
    limit: input.limit,
    maxTimeMS: 5000,
  }).toArray();
  return rows.map(safeEvent);
}

type HistoryConnection = {
  collection: Collection<RecoveryAuditEvent>;
  close: () => Promise<void>;
};

async function openHistory(): Promise<HistoryConnection> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("Database configuration required.");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = process.env.MONGODB_DATABASE ? client.db(process.env.MONGODB_DATABASE) : client.db();
    // Deliberately NOT recoveryAuditCollection(): reads must not create indexes.
    return { collection: db.collection<RecoveryAuditEvent>(RECOVERY_AUDIT_COLLECTION), close: () => client.close() };
  } catch {
    await client.close().catch(() => {});
    throw new Error("Audit database unavailable.");
  }
}

type HistoryIO = {
  readToken: () => string;
  out: (text: string) => void;
  error: (text: string) => void;
};

export async function runRecoveryHistoryCommand(
  args: string[],
  io: HistoryIO,
  dependencies = { authenticate: authenticateRecoveryOperator, open: openHistory },
): Promise<number> {
  let input: RecoveryHistoryFilter;
  try {
    input = parseRecoveryHistoryArgs(args);
  } catch {
    io.error(RECOVERY_HISTORY_USAGE);
    return 1;
  }
  let connection: HistoryConnection | undefined;
  try {
    await dependencies.authenticate(io.readToken());
    connection = await dependencies.open();
    const events = await readRecoveryHistory(connection.collection, input);
    // Buffer before output: a failed read or malformed record is never an empty
    // successful history, nor a partial disclosure.
    const output = JSON.stringify({ events, limit: input.limit });
    await connection.close();
    connection = undefined;
    io.out(`${output}\n`);
    return 0;
  } catch {
    io.error("History lookup unconfirmed. Check the active operator session, current recovery operator permission, and database read access. No history confirmed.\n");
    return 1;
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}
