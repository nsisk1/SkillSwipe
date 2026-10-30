import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { FlashcardGenerationResult } from "@workspace/api-zod";
import {
  createFlashcardsRouter,
  type FlashcardGenerator,
} from "../src/routes/flashcards";
import type {
  FlashcardDeck,
  FlashcardDeckStore,
  ProgressUpdate,
  StoredFlashcard,
} from "../src/lib/flashcard-decks";

class MemoryDeckStore implements FlashcardDeckStore {
  private readonly decks = new Map<string, FlashcardDeck>();
  private nextId = 1;

  async createDeck(
    deviceId: string,
    topic: string,
    difficulty: FlashcardDeck["difficulty"],
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck> {
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: `deck-${this.nextId++}`,
      deviceId,
      topic,
      difficulty,
      cards: cards.map(card => ({ ...card, status: "new" })),
      activeIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.decks.set(deck.id, deck);
    return structuredClone(deck);
  }

  async listDecks(deviceId: string): Promise<FlashcardDeck[]> {
    return [...this.decks.values()]
      .filter(deck => deck.deviceId === deviceId)
      .map(deck => structuredClone(deck));
  }

  async getDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    return deck?.deviceId === deviceId ? structuredClone(deck) : null;
  }

  async updateProgress(
    deviceId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    if (
      !deck ||
      deck.deviceId !== deviceId ||
      !deck.cards.some(card => card.id === progress.cardId)
    ) {
      return null;
    }
    const updatedDeck: FlashcardDeck = {
      ...deck,
      activeIndex: progress.activeIndex,
      updatedAt: new Date().toISOString(),
      cards: deck.cards.map(card =>
        card.id === progress.cardId ? { ...card, status: progress.status } : card,
      ),
    };
    this.decks.set(deckId, updatedDeck);
    return structuredClone(updatedDeck);
  }

  async restartDeck(deviceId: string, deckId: string): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    if (!deck || deck.deviceId !== deviceId) return null;
    const restartedDeck: FlashcardDeck = {
      ...deck,
      activeIndex: 0,
      updatedAt: new Date().toISOString(),
      cards: deck.cards.map(card => ({ ...card, status: "new" })),
    };
    this.decks.set(deckId, restartedDeck);
    return structuredClone(restartedDeck);
  }
}

function fakeCards(topic: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${index + 1}`,
    topic,
    question: `Question ${index + 1}`,
    answer: `Answer ${index + 1}`,
  }));
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  generator?: FlashcardGenerator,
  store = new MemoryDeckStore(),
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(createFlashcardsRouter(generator, store));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not read the test server address.");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

async function sendRequest(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  deviceId = "test-device",
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-skillswipe-device-id": deviceId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("generation applies the chosen count and difficulty to the saved deck", async () => {
  let generatorInput: Parameters<FlashcardGenerator>[0] | undefined;
  const generator: FlashcardGenerator = async input => {
    generatorInput = input;
    return fakeCards(input.topic, input.cardCount);
  };

  await withServer(async baseUrl => {
    const generated = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Cell biology",
      cardCount: 8,
      difficulty: "advanced",
    });
    assert.equal(generated.status, 200);
    const deck = generated.body as FlashcardGenerationResult;
    assert.equal(deck.topic, "Cell biology");
    assert.equal(deck.difficulty, "advanced");
    assert.equal(deck.cards.length, 8);
    assert.equal(deck.cards[0]?.status, "new");
    assert.deepEqual(generatorInput, {
      topic: "Cell biology",
      cardCount: 8,
      difficulty: "advanced",
    });

    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.decks.length, 1);
    assert.equal(listed.body.decks[0].id, deck.id);

    const saved = await sendRequest(
      baseUrl,
      "GET",
      `/flashcards/decks/${deck.id}`,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.activeIndex, 0);
    assert.equal(saved.body.difficulty, "advanced");
    assert.equal(saved.body.cards[0].status, "new");
  }, generator);
});

test("generation defaults an omitted difficulty to intermediate", async () => {
  let generatedDifficulty: string | undefined;
  const generator: FlashcardGenerator = async input => {
    generatedDifficulty = input.difficulty;
    return fakeCards(input.topic, input.cardCount);
  };

  await withServer(async baseUrl => {
    const generated = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Cell biology",
      cardCount: 3,
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.difficulty, "intermediate");
    assert.equal(generatedDifficulty, "intermediate");
  }, generator);
});
test("generation saves a resumable deck in the owner's collection", async () => {
  let receivedDifficulty: string | undefined;
  const generator: FlashcardGenerator = async input => {
    receivedDifficulty = input.difficulty;
    return fakeCards(input.topic, input.cardCount);
  };

  await withServer(async baseUrl => {
    const generated = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Cell biology",
      cardCount: 3,
      difficulty: "hard",
    });
    assert.equal(generated.status, 200);
    const deck = generated.body as FlashcardGenerationResult;
    assert.equal(deck.topic, "Cell biology");
    assert.equal(deck.difficulty, "hard");
    assert.equal(deck.cards.length, 3);
    assert.equal(deck.cards[0]?.status, "new");
    assert.equal(receivedDifficulty, "hard");

    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.decks.length, 1);
    assert.equal(listed.body.decks[0].id, deck.id);

    const saved = await sendRequest(
      baseUrl,
      "GET",
      `/flashcards/decks/${deck.id}`,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.activeIndex, 0);
    assert.equal(saved.body.cards[0].status, "new");
  }, generator);
});

test("study status and active position persist and can be reset", async () => {
  const generator: FlashcardGenerator = async input =>
    fakeCards(input.topic, input.cardCount);

  await withServer(async baseUrl => {
    const generated = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Genetics",
      cardCount: 3,
      difficulty: "medium",
    });
    const deckId = generated.body.id as string;

    const savedProgress = await sendRequest(
      baseUrl,
      "PATCH",
      `/flashcards/decks/${deckId}/progress`,
      { cardId: "card-1", status: "known", activeIndex: 1 },
    );
    assert.equal(savedProgress.status, 200);
    assert.equal(savedProgress.body.cards[0].status, "known");
    assert.equal(savedProgress.body.activeIndex, 1);

    const markedForReview = await sendRequest(
      baseUrl,
      "PATCH",
      `/flashcards/decks/${deckId}/progress`,
      { cardId: "card-2", status: "again", activeIndex: 2 },
    );
    assert.equal(markedForReview.body.cards[1].status, "again");
    assert.equal(markedForReview.body.activeIndex, 2);

    const reopened = await sendRequest(
      baseUrl,
      "GET",
      `/flashcards/decks/${deckId}`,
    );
    assert.equal(reopened.body.cards[0].status, "known");
    assert.equal(reopened.body.cards[1].status, "again");
    assert.equal(reopened.body.activeIndex, 2);

    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(listed.body.decks[0].knownCount, 1);

    const restarted = await sendRequest(
      baseUrl,
      "POST",
      `/flashcards/decks/${deckId}/restart`,
    );
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.activeIndex, 0);
    assert.ok(restarted.body.cards.every((card: StoredFlashcard) => card.status === "new"));
  }, generator);
});

test("saved decks are scoped to the installation identifier", async () => {
  const generator: FlashcardGenerator = async input =>
    fakeCards(input.topic, input.cardCount);

  await withServer(async baseUrl => {
    await sendRequest(
      baseUrl,
      "POST",
      "/flashcards/generate",
      { topic: "Biology", cardCount: 3, difficulty: "medium" },
      "device-one",
    );
    const listed = await sendRequest(
      baseUrl,
      "GET",
      "/flashcards/decks",
      undefined,
      "device-two",
    );
    assert.deepEqual(listed.body.decks, []);
  }, generator);
});

test("generation rejects invalid input without calling the generator", async () => {
  let callCount = 0;
  const resultGenerator: FlashcardGenerator = async () => {
    callCount += 1;
    return fakeCards("Biology", 3);
  };

  await withServer(async baseUrl => {
    const result = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Biology",
      cardCount: 11,
    });
    assert.equal(result.status, 400);
    assert.equal(callCount, 0);
    assert.deepEqual(result.body, {
      error: "Provide a topic and choose between 3 and 10 flashcards.",
    });
  }, resultGenerator);
});

test("generation reports an AI error as a gateway error", async () => {
  const generator: FlashcardGenerator = async () => {
    throw new Error("Simulated AI failure");
  };
  await withServer(async baseUrl => {
    const result = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Genetics",
      cardCount: 3,
    });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, {
      error: "We couldn’t generate this deck. Please try again.",
    });
  }, generator);
});
