import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app";
import { createFlashcardsRouter } from "../../src/routes/flashcards";
import type { LegacyRecoveryRequestInbox } from "../../src/lib/legacy-recovery-requests";
import type {
  FlashcardDeck, FlashcardDeckStore, FlashcardDifficulty,
  StoredFlashcard, ProgressUpdate,
} from "../../src/lib/flashcard-decks";

/** Only persistence is in memory; Clerk middleware and owner resolution are real. */
export class AccountTestStore implements FlashcardDeckStore {
  private decks = new Map<string, FlashcardDeck>();

  async createDeck(ownerId: string, topic: string, difficulty: FlashcardDifficulty,
    cards: Omit<StoredFlashcard, "status">[]): Promise<FlashcardDeck> {
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: randomUUID(), ownerId, topic, difficulty,
      cards: cards.map(card => ({ ...card, status: "new" })),
      activeIndex: 0, createdAt: now, updatedAt: now,
    };
    this.decks.set(deck.id, deck);
    return structuredClone(deck);
  }

  async listDecks(ownerId: string) {
    return structuredClone([...this.decks.values()].filter(deck => deck.ownerId === ownerId));
  }

  async getDeck(ownerId: string, deckId: string) {
    const deck = this.decks.get(deckId);
    return deck?.ownerId === ownerId ? structuredClone(deck) : null;
  }

  async updateProgress(ownerId: string, deckId: string, progress: ProgressUpdate) {
    const deck = await this.getDeck(ownerId, deckId);
    if (!deck || !deck.cards.some(card => card.id === progress.cardId)) return null;
    deck.cards = deck.cards.map(card => card.id === progress.cardId ? { ...card, status: progress.status } : card);
    deck.activeIndex = progress.activeIndex;
    deck.updatedAt = new Date().toISOString();
    this.decks.set(deck.id, deck);
    return structuredClone(deck);
  }

  async restartDeck(ownerId: string, deckId: string) {
    const deck = await this.getDeck(ownerId, deckId);
    if (!deck) return null;
    deck.cards = deck.cards.map(card => ({ ...card, status: "new" }));
    deck.activeIndex = 0;
    deck.updatedAt = new Date().toISOString();
    this.decks.set(deck.id, deck);
    return structuredClone(deck);
  }

  async reviewLegacyDeck(): Promise<FlashcardDeck | null> {
    throw new Error("Legacy recovery is outside the account-isolation fixture.");
  }
  async transferLegacyDeck(): Promise<FlashcardDeck | null> {
    throw new Error("Legacy recovery is outside the account-isolation fixture.");
  }
}

export async function startAccountFixture(
  store: FlashcardDeckStore,
  recoveryInbox?: LegacyRecoveryRequestInbox,
) {
  // Never call a paid model, even if a test unexpectedly submits generation.
  const app = createApp(createFlashcardsRouter(async input =>
    Array.from({ length: input.cardCount }, (_, index) => ({
      id: ["one", "two", "three"][index] ?? `card-${index}`,
      topic: input.topic,
      question: `Private question ${["one", "two", "three"][index] ?? index}`,
      answer: `Private answer ${index + 1}`,
    })), store, undefined, recoveryInbox));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
