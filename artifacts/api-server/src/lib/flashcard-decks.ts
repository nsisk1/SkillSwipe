import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";

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

  // Operator-only. Never expose grant issuance through a learner-facing API.
  async approveLegacyRecovery(input: {
    deckId: string;
    legacyOwnerId: string;
    targetUserId: string;
  }): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.deckId) ||
      !/^sw-[a-z0-9]+-[a-z0-9]+$/.test(input.legacyOwnerId) ||
      !/^user_[a-zA-Z0-9]+$/.test(input.targetUserId)
    ) {
      throw new Error("Recovery requires a legacy installation owner and a verified Clerk user ID.");
    }
    const secret = randomBytes(32).toString("hex");
    const collection = await this.getCollection();
    const updated = await collection.updateOne(
      { id: input.deckId, ownerId: input.legacyOwnerId },
      {
        $set: {
          recovery: {
            secretHash: hashRecoverySecret(secret),
            targetUserId: input.targetUserId,
            legacyOwnerId: input.legacyOwnerId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      },
    );
    if (!updated.matchedCount) {
      throw new Error("No matching legacy deck. Account-owned decks cannot be recovered.");
    }
    return `${input.deckId}.${secret}`;
  }

  async reviewLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    return collection.findOne(recoveryFilter(learnerId, code));
  }

  async transferLegacyDeck(learnerId: string, code: string): Promise<FlashcardDeck | null> {
    const collection = await this.getCollection();
    const now = new Date().toISOString();
    // Ownership and grant are checked in the same atomic write. Repeated accepts
    // by the recipient are safe; old installation and other accounts lose access.
    const transferred = await collection.findOneAndUpdate(
      { ...recoveryFilter(learnerId, code), "recovery.transferredAt": { $exists: false } },
      { $set: { ownerId: learnerId, updatedAt: now, "recovery.transferredAt": now } },
      { returnDocument: "after" },
    );
    if (transferred) return transferred;
    return collection.findOne({
      ...recoveryFilter(learnerId, code),
      ownerId: learnerId,
      "recovery.transferredAt": { $exists: true },
    });
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
