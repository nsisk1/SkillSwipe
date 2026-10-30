import { randomUUID } from "node:crypto";
import { MongoClient, type Collection } from "mongodb";

export type FlashcardStudyStatus = "new" | "known" | "again";

export type StoredFlashcard = {
  id: string;
  topic: string;
  question: string;
  answer: string;
  status: FlashcardStudyStatus;
};

export type FlashcardDeck = {
  id: string;
  deviceId: string;
  topic: string;
  difficulty?: "easy" | "medium" | "hard";
  cards: StoredFlashcard[];
  activeIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type ProgressUpdate = {
  cardId: string;
  status: Exclude<FlashcardStudyStatus, "new">;
  activeIndex: number;
};

export interface FlashcardDeckStore {
  createDeck(
    deviceId: string,
    topic: string,
    difficulty: "easy" | "medium" | "hard",
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck>;
  listDecks(deviceId: string): Promise<FlashcardDeck[]>;
  getDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null>;
  updateProgress(
    deviceId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null>;
  restartDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null>;
}

let mongoClientPromise: Promise<MongoClient> | undefined;

async function getCollection(): Promise<Collection<FlashcardDeck>> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error(
      "MONGODB_URI is required to persist SkillSwipe decks. Configure it as a Replit Secret.",
    );
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(uri);
    mongoClientPromise = client.connect().then(
      () => client,
      error => {
        mongoClientPromise = undefined;
        throw error;
      },
    );
  }

  const client = await mongoClientPromise;
  const database = process.env.MONGODB_DATABASE
    ? client.db(process.env.MONGODB_DATABASE)
    : client.db();
  return database.collection<FlashcardDeck>("skillswipe_decks");
}

export class MongoFlashcardDeckStore implements FlashcardDeckStore {
  async createDeck(
    deviceId: string,
    topic: string,
    difficulty: "easy" | "medium" | "hard",
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck> {
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: randomUUID(),
      deviceId,
      topic,
      difficulty,
      cards: cards.map(card => ({ ...card, status: "new" })),
      activeIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    const collection = await getCollection();
    await collection.insertOne(deck);
    return deck;
  }

  async listDecks(deviceId: string): Promise<FlashcardDeck[]> {
    const collection = await getCollection();
    return collection
      .find({ deviceId })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  async getDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null> {
    const collection = await getCollection();
    return collection.findOne({ deviceId, id: deckId });
  }

  async updateProgress(
    deviceId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null> {
    const collection = await getCollection();
    const update = await collection.updateOne(
      { deviceId, id: deckId, "cards.id": progress.cardId },
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
    return collection.findOne({ deviceId, id: deckId });
  }

  async restartDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null> {
    const collection = await getCollection();
    const update = await collection.updateOne(
      { deviceId, id: deckId },
      {
        $set: {
          activeIndex: 0,
          updatedAt: new Date().toISOString(),
          "cards.$[].status": "new",
        },
      },
    );
    if (update.matchedCount === 0) return null;
    return collection.findOne({ deviceId, id: deckId });
  }
}
