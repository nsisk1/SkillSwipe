import { randomUUID } from "node:crypto";
import type { ClientSession, Collection, Db } from "mongodb";
import { reportRecoveryFailure } from "./logger";

export const RECOVERY_AUDIT_RETENTION_SECONDS = 365 * 24 * 60 * 60;
export const RECOVERY_AUDIT_COLLECTION = "skillswipe_recovery_audit";

// Explicit allowlist: no codes, secret hashes, deck contents, or evidence.
export type RecoveryAuditEvent = {
  id: string;
  grantId: string;
  deckId: string;
  operatorId: string;
  receivingAccountId: string;
  actorId: string;
  event: "approval" | "revocation" | "transfer";
  timestamp: Date;
  expiresAt: Date;
};

export async function recoveryAuditCollection(db: Db): Promise<Collection<RecoveryAuditEvent>> {
  const collection = db.collection<RecoveryAuditEvent>(RECOVERY_AUDIT_COLLECTION);
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ deckId: 1, timestamp: 1 });
  return collection;
}

export async function writeRecoveryAudit(
  collection: Collection<RecoveryAuditEvent>,
  session: ClientSession,
  input: Pick<RecoveryAuditEvent, "grantId" | "deckId" | "operatorId" | "receivingAccountId" | "actorId" | "event">,
): Promise<void> {
  const timestamp = new Date();
  try {
    await collection.insertOne({
      id: randomUUID(),
      grantId: input.grantId,
      deckId: input.deckId,
      operatorId: input.operatorId,
      receivingAccountId: input.receivingAccountId,
      actorId: input.actorId,
      event: input.event,
      timestamp,
      expiresAt: new Date(timestamp.getTime() + RECOVERY_AUDIT_RETENTION_SECONDS * 1000),
    }, { session });
  } catch (error) {
    reportRecoveryFailure("insert", input.event);
    // Preserve MongoDB error labels so the driver retains its retry behavior.
    throw error;
  }
}
