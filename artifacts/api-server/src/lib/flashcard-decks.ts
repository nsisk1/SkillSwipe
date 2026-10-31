import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MongoClient, type Collection, type ClientSession } from "mongodb";
import { recoveryAuditCollection, writeRecoveryAudit, type RecoveryAuditEvent } from "./recovery-audit";
import { reportRecoveryFailure, type RecoveryOperation } from "./logger";

export type FlashcardStudyStatus = "new" | "known" | "again";
export type FlashcardDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "easy"
  | "medium"
  | "hard";

export type StoredFlashcard = {
  id: string;
  topic: string;
  question: string;
  answer: string;
  status: FlashcardStudyStatus;
};

export type FlashcardDeck = {
  id: string;
  ownerId: string;
  topic: string;
  difficulty?: FlashcardDifficulty;
  cards: StoredFlashcard[];
  activeIndex: number;
  createdAt: string;
  updatedAt: string;
  recovery?: {
    grantId?: string;
    operatorId?: string;
    secretHash: string;
    targetUserId: string;
    legacyOwnerId: string;
    expiresAt: string;
    transferredAt?: string;
  };
};

export type ProgressUpdate = {
  cardId: string;
  status: Exclude<FlashcardStudyStatus, "new">;
  activeIndex: number;
};

export interface FlashcardDeckStore {
  reviewLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null>;
  transferLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null>;
  createDeck(
    ownerId: string,
    topic: string,
    difficulty: FlashcardDifficulty,
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck>;
  listDecks(ownerId: string): Promise<FlashcardDeck[]>;
  getDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null>;
  updateProgress(
    ownerId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null>;
  restartDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null>;
}

export class MongoFlashcardDeckStore implements FlashcardDeckStore {
  private clientPromise: Promise<MongoClient> | undefined;

  constructor(
    private readonly config: { uri?: string; databaseName?: string } = {},
  ) {}

  private async getCollection(): Promise<Collection<FlashcardDeck>> {
    const uri = this.config.uri ?? process.env.MONGODB_URI?.trim();
    if (!uri) {
      throw new Error(
        "MONGODB_URI is required to persist SkillSwipe decks. Configure it as a Replit Secret.",
      );
    }

    if (!this.clientPromise) {
      const client = new MongoClient(uri);
      this.clientPromise = client.connect().then(
        () => client,
        error => {
          this.clientPromise = undefined;
          throw error;
        },
      );
    }

    const client = await this.clientPromise;
    const databaseName =
      this.config.databaseName ?? process.env.MONGODB_DATABASE;
    const database = databaseName ? client.db(databaseName) : client.db();
    return database.collection<FlashcardDeck>("skillswipe_decks");
  }

  async close(): Promise<void> {
    const clientPromise = this.clientPromise;
    this.clientPromise = undefined;
    if (clientPromise) {
      await (await clientPromise).close();
    }
  }

  private async withRecoveryTransaction<T>(
    work: (collection: Collection<FlashcardDeck>, audit: Collection<RecoveryAuditEvent>, session: ClientSession) => Promise<T>,
    operation: RecoveryOperation,
  ): Promise<T> {
    const { collection, audit, session } = await (async () => {
      try {
        const collection = await this.getCollection();
        const client = await this.clientPromise!;
        const db = client.db(collection.dbName);
        // Index creation is outside the transaction; any failure blocks the mutation.
        const audit = await recoveryAuditCollection(db);
        return { collection, audit, session: client.startSession() };
      } catch (error) {
        reportRecoveryFailure("setup", operation);
        throw error;
      }
    })();
    let failureStage: "transaction" | "commit" | null = "transaction";
    try {
      return await session.withTransaction(
        async () => {
          // The driver may rerun this callback. A failed callback is not a
          // commit failure, including after an earlier successful attempt.
          failureStage = null;
          const result = await work(collection, audit, session);
          failureStage = "commit";
          return result;
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (failureStage) reportRecoveryFailure(failureStage, operation);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // Operator-only. Never expose grant issuance through a learner-facing API.
  async approveLegacyRecovery(input: {
    deckId: string;
    legacyOwnerId: string;
    targetUserId: string;
    operatorId: string;
  }): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.deckId) ||
      !/^sw-[a-z0-9]+-[a-z0-9]+$/.test(input.legacyOwnerId) ||
      !/^user_[a-zA-Z0-9]+$/.test(input.targetUserId) ||
      !/^user_[a-zA-Z0-9]+$/.test(input.operatorId)
    ) {
      throw new Error("Recovery requires a legacy installation owner and a verified Clerk user ID.");
    }
    const secret = randomBytes(32).toString("hex");
    return this.withRecoveryTransaction(async (collection, audit, session) => {
      const previous = await collection.findOne(
        { id: input.deckId, ownerId: input.legacyOwnerId }, { session },
      );
      if (!previous) throw new Error("No matching legacy deck. Account-owned decks cannot be recovered.");
      const grantId = randomUUID();
      if (previous.recovery) {
        await writeRecoveryAudit(audit, session, {
          grantId: previous.recovery.grantId ?? "pre-audit",
          deckId: input.deckId, operatorId: input.operatorId,
          receivingAccountId: previous.recovery.targetUserId,
          actorId: input.operatorId, event: "revocation",
        });
      }
      const updated = await collection.updateOne(
        { id: input.deckId, ownerId: input.legacyOwnerId },
        {
          $set: {
            recovery: {
              grantId,
              operatorId: input.operatorId,
              secretHash: hashRecoverySecret(secret),
              targetUserId: input.targetUserId,
              legacyOwnerId: input.legacyOwnerId,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        },
        { session },
      );
      if (!updated.matchedCount) {
        throw new Error("No matching legacy deck. Account-owned decks cannot be recovered.");
      }
      await writeRecoveryAudit(audit, session, {
        grantId, deckId: input.deckId, operatorId: input.operatorId,
        receivingAccountId: input.targetUserId, actorId: input.operatorId, event: "approval",
      });
      return `${input.deckId}.${secret}`;
    }, "approval");
  }

  async revokeLegacyRecovery(deckId: string, operatorId: string): Promise<boolean> {
    if (!/^user_[a-zA-Z0-9]+$/.test(operatorId)) throw new Error("Operator required.");
    return this.withRecoveryTransaction(async (collection, audit, session) => {
      const filter = {
        id: deckId, ownerId: /^sw-[a-z0-9]+-[a-z0-9]+$/,
        "recovery.transferredAt": { $exists: false },
        "recovery.targetUserId": { $exists: true },
      };
      const deck = await collection.findOne(filter, { session });
      if (!deck?.recovery || deck.ownerId !== deck.recovery.legacyOwnerId) return false;
      const result = await collection.updateOne(filter, { $unset: { recovery: "" } }, { session });
      if (!result.matchedCount) return false;
      await writeRecoveryAudit(audit, session, {
        grantId: deck.recovery.grantId ?? "pre-audit", deckId,
        operatorId, receivingAccountId: deck.recovery.targetUserId,
        actorId: operatorId, event: "revocation",
      });
      return true;
    }, "revocation");
  }

  async reviewLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    return collection.findOne(recoveryFilter(learnerId, code));
  }

  async transferLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null> {
    return this.withRecoveryTransaction(async (collection, audit, session) => {
      const now = new Date().toISOString();
      // Ownership and grant are checked in the same atomic write. Repeated accepts
      // by the recipient are safe; old installation and other accounts lose access.
      const transferred = await collection.findOneAndUpdate(
        {
          ...recoveryFilter(learnerId, code),
          "recovery.transferredAt": { $exists: false },
          // Pre-audit grants must be independently reapproved, not assigned an invented operator.
          "recovery.operatorId": /^user_[a-zA-Z0-9]+$/,
          "recovery.grantId": { $exists: true },
        },
        { $set: { ownerId: learnerId, updatedAt: now, "recovery.transferredAt": now } },
        { returnDocument: "after", session },
      );
      if (transferred) {
        await writeRecoveryAudit(audit, session, {
          grantId: transferred.recovery!.grantId!, deckId: transferred.id,
          operatorId: transferred.recovery!.operatorId!,
          receivingAccountId: learnerId, actorId: learnerId, event: "transfer",
        });
        return transferred;
      }
      return collection.findOne({
        ...recoveryFilter(learnerId, code),
        ownerId: learnerId,
        "recovery.transferredAt": { $exists: true },
      }, { session });
    }, "transfer");
  }

  async createDeck(
    ownerId: string,
    topic: string,
    difficulty: FlashcardDifficulty,
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck> {
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: randomUUID(),
      ownerId,
      topic,
      difficulty,
      cards: cards.map(card => ({ ...card, status: "new" })),
      activeIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    const collection = await this.getCollection();
    await collection.insertOne(deck);
    return deck;
  }

  async listDecks(ownerId: string): Promise<FlashcardDeck[]> {
    const collection = await this.getCollection();
    return collection
      .find({ ownerId })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  async getDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    return collection.findOne({ ownerId, id: deckId });
  }

  async updateProgress(
    ownerId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    const update = await collection.updateOne(
      { ownerId, id: deckId, "cards.id": progress.cardId },
      {
        $set: {
          activeIndex: progress.activeIndex,
          updatedAt: new Date().toISOString(),
          "cards.$[card].status": progress.status,
        },
      },
      { arrayFilters: [{ "card.id": progress.cardId }] },
    );
    if (update.matchedCount === 0) return null;
    return collection.findOne({ ownerId, id: deckId });
  }

  async restartDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    const update = await collection.updateOne(
      { ownerId, id: deckId },
      {
        $set: {
          activeIndex: 0,
          updatedAt: new Date().toISOString(),
          "cards.$[].status": "new",
        },
      },
    );
    if (update.matchedCount === 0) return null;
    return collection.findOne({ ownerId, id: deckId });
  }
}

function hashRecoverySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function recoveryFilter(learnerId: string, code: string) {
  const [id, secret] = code.split(".");
  return {
    id,
    "recovery.secretHash": hashRecoverySecret(secret ?? ""),
    "recovery.targetUserId": learnerId,
    "recovery.expiresAt": { $gt: new Date().toISOString() },
    $or: [
      {
        ownerId: /^sw-[a-z0-9]+-[a-z0-9]+$/,
        $expr: { $eq: ["$ownerId", "$recovery.legacyOwnerId"] },
      },
      { ownerId: learnerId, "recovery.transferredAt": { $exists: true } },
    ],
  };
}
