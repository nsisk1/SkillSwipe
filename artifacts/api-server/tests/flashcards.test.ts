import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { FlashcardGenerationResult } from "@workspace/api-zod";
import { ListFlashcardDecksResponse } from "@workspace/api-zod";
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
  async reviewLegacyDeck(): Promise<FlashcardDeck | null> { return null; }
  async transferLegacyDeck(): Promise<FlashcardDeck | null> { return null; }
  private readonly decks = new Map<string, FlashcardDeck>();
  private nextId = 1;

  async createDeck(
    ownerId: string,
    topic: string,
    difficulty: FlashcardDeck["difficulty"],
    cards: Omit<StoredFlashcard, "status">[],
  ): Promise<FlashcardDeck> {
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: `deck-${this.nextId++}`,
      ownerId,
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

  async listDecks(ownerId: string): Promise<FlashcardDeck[]> {
    return [...this.decks.values()]
      .filter(deck => deck.ownerId === ownerId)
      .map(deck => structuredClone(deck));
  }

  async getDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    return deck?.ownerId === ownerId ? structuredClone(deck) : null;
  }

  async updateProgress(
    ownerId: string,
    deckId: string,
    progress: ProgressUpdate,
  ): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    if (
      !deck ||
      deck.ownerId !== ownerId ||
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

  async restartDeck(ownerId: string, deckId: string): Promise<FlashcardDeck | null> {
    const deck = this.decks.get(deckId);
    if (!deck || deck.ownerId !== ownerId) return null;
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
  app.use(
    createFlashcardsRouter(
      generator,
      store,
      req => req.get("x-test-learner-id") ?? null,
    ),
  );
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
  learnerId: string | null = "learner-one",
): Promise<{ status: number; body: any; cacheControl: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (learnerId) headers["x-test-learner-id"] = learnerId;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
  };
}

test("AI generation prompts preserve level guidance and the requested count and level", async t => {
  const levels = ["beginner", "intermediate", "advanced", "easy", "medium", "hard"] as const;

  for (const difficulty of levels) {
    for (const cardCount of [3, 7, 10]) {
      await t.test(`${difficulty} learner requesting ${cardCount} cards`, async t => {
        const completion = t.mock.method(openai.chat.completions, "create", async () => ({
          choices: [{
            message: {
              content: JSON.stringify({ cards: fakeCards("Cell biology", cardCount) }),
            },
          }],
        }));

        // Use the real default generator, mocking only the external AI call.
        await withServer(async baseUrl => {
          const generated = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
            topic: "Cell biology",
            cardCount,
            difficulty,
          });
          assert.equal(generated.status, 200);
          assert.equal(generated.body.cards.length, cardCount);
          assert.equal(generated.body.difficulty, difficulty);
        });

        assert.equal(completion.mock.callCount(), 1);
        const request = completion.mock.calls[0].arguments[0];
        const systemPrompt = request.messages.find(message => message.role === "system")?.content;
        const userPrompt = request.messages.find(message => message.role === "user")?.content;
        assert.equal(typeof systemPrompt, "string");
        assert.equal(typeof userPrompt, "string");

        // Match each level's own guidance, not just keywords anywhere in the prompt.
        assert.match(
          systemPrompt,
          /Beginner\/easy:\s*[^.]*foundational ideas[^.]*plain language[^.]*minimal assumed knowledge/i,
        );
        assert.match(
          systemPrompt,
          /Intermediate\/medium:\s*[^.]*basic familiarity[^.]*mechanisms and relationships/i,
        );
        assert.match(
          systemPrompt,
          /Advanced\/hard:\s*[^.]*precise terminology[^.]*nuance[^.]*exceptions[^.]*deeper connections/i,
        );
        assert.match(userPrompt, new RegExp(`Create exactly ${cardCount} flashcards\\b`));
        assert.match(userPrompt, /about "Cell biology"/);
        assert.match(userPrompt, new RegExp(`for a ${difficulty} learner\\b`));
      });
    }
  }
});

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
    assert.equal(listed.body.decks[0].difficulty, "advanced");

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

test("saved summaries retain every supported learner level", async () => {
  const store = new MemoryDeckStore();
  const levels = ["beginner", "intermediate", "advanced", "easy", "medium", "hard"] as const;
  for (const level of levels) {
    await store.createDeck("learner-one", `Biology ${level}`, level, fakeCards("Biology", 3));
  }
  await withServer(async baseUrl => {
    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(listed.status, 200);
    const result = ListFlashcardDecksResponse.parse(listed.body);
    assert.deepEqual(result.decks.map(deck => deck.difficulty), levels);
  }, undefined, store);
});

test("saved decks without learner metadata can still be listed and opened", async () => {
  const store = new MemoryDeckStore();
  const legacy = await store.createDeck(
    "learner-one", "Older biology deck", undefined, fakeCards("Biology", 3),
  );
  await withServer(async baseUrl => {
    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(listed.status, 200);
    const result = ListFlashcardDecksResponse.parse(listed.body);
    assert.equal(result.decks[0]?.id, legacy.id);
    assert.equal(Object.hasOwn(listed.body.decks[0], "difficulty"), false);
    assert.equal(result.decks[0]?.cardCount, 3);

    const opened = await sendRequest(baseUrl, "GET", `/flashcards/decks/${legacy.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.cards.length, 3);
    assert.equal(Object.hasOwn(opened.body, "difficulty"), false);
  }, undefined, store);
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

test("saved decks are scoped to the authenticated learner across devices", async () => {
  const generator: FlashcardGenerator = async input =>
    fakeCards(input.topic, input.cardCount);

  await withServer(async baseUrl => {
    const created = await sendRequest(
      baseUrl,
      "POST",
      "/flashcards/generate",
      { topic: "Biology", cardCount: 3, difficulty: "medium" },
      "learner-one",
    );
    const listed = await sendRequest(
      baseUrl,
      "GET",
      "/flashcards/decks",
      undefined,
      "learner-two",
    );
    assert.deepEqual(listed.body.decks, []);

    const otherLearnerGet = await sendRequest(
      baseUrl,
      "GET",
      `/flashcards/decks/${created.body.id}`,
      undefined,
      "learner-two",
    );
    assert.equal(otherLearnerGet.status, 404);

    const otherLearnerUpdate = await sendRequest(
      baseUrl,
      "PATCH",
      `/flashcards/decks/${created.body.id}/progress`,
      { cardId: "card-1", status: "known", activeIndex: 1 },
      "learner-two",
    );
    assert.equal(otherLearnerUpdate.status, 404);

    const otherLearnerRestart = await sendRequest(
      baseUrl,
      "POST",
      `/flashcards/decks/${created.body.id}/restart`,
      undefined,
      "learner-two",
    );
    assert.equal(otherLearnerRestart.status, 404);

    const anotherDeviceList = await sendRequest(
      baseUrl,
      "GET",
      "/flashcards/decks",
      undefined,
      "learner-one",
    );
    assert.equal(anotherDeviceList.body.decks.length, 1);
    const reopened = await sendRequest(
      baseUrl,
      "GET",
      `/flashcards/decks/${created.body.id}`,
      undefined,
      "learner-one",
    );
    assert.equal(reopened.status, 200);
  }, generator);
});

test("saved deck routes require an authenticated learner", async () => {
  const generator: FlashcardGenerator = async input =>
    fakeCards(input.topic, input.cardCount);

  await withServer(async baseUrl => {
    for (const [method, path, body] of [
      ["POST", "/flashcards/generate", { topic: "Biology", cardCount: 3 }],
      ["GET", "/flashcards/decks", undefined],
      ["GET", "/flashcards/decks/deck-1", undefined],
      [
        "PATCH",
        "/flashcards/decks/deck-1/progress",
        { cardId: "card-1", status: "known", activeIndex: 1 },
      ],
      ["POST", "/flashcards/decks/deck-1/restart", undefined],
    ] as const) {
      const response = await sendRequest(baseUrl, method, path, body, null);
      assert.equal(response.status, 401, `${method} ${path} should require sign-in`);
      assert.equal(response.cacheControl, "no-store");
    }
  }, generator);
});

test("successful and forbidden deck responses cannot be retained in an HTTP cache", async () => {
  await withServer(async baseUrl => {
    const created = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
      topic: "Biology", cardCount: 3,
    });
    assert.equal(created.status, 200);
    assert.equal(created.cacheControl, "no-store");
    for (const learner of ["learner-one", "learner-two"]) {
      for (const [method, path, body] of [
        ["GET", "/flashcards/decks", undefined],
        ["GET", `/flashcards/decks/${created.body.id}`, undefined],
        ["PATCH", `/flashcards/decks/${created.body.id}/progress`,
          { cardId: "card-1", status: "known", activeIndex: 1 }],
        ["POST", `/flashcards/decks/${created.body.id}/restart`, undefined],
      ] as const) {
        const response = await sendRequest(baseUrl, method, path, body, learner);
        assert.equal(response.status, learner === "learner-one" || path === "/flashcards/decks" ? 200 : 404);
        assert.equal(response.cacheControl, "no-store");
      }
    }
  }, async input => fakeCards(input.topic, input.cardCount));
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

test("a failed deck save returns a retryable error, not a generated deck", async t => {
  const store = new MemoryDeckStore();
  const createDeck = store.createDeck.bind(store);
  const failure = t.mock.method(store, "createDeck", async () => {
    throw new Error("Simulated database outage: internal connection details");
  });
  let generationCount = 0;
  const generator: FlashcardGenerator = async input => {
    generationCount += 1;
    return fakeCards(input.topic, input.cardCount);
  };

  await withServer(async baseUrl => {
    const request = { topic: "Genetics", cardCount: 3, difficulty: "medium" };
    const failed = await sendRequest(baseUrl, "POST", "/flashcards/generate", request);
    assert.equal(generationCount, 1, "generation succeeded before persistence failed");
    assert.equal(failure.mock.callCount(), 1);
    assert.deepEqual(failure.mock.calls[0].arguments, [
      "learner-one", "Genetics", "medium", fakeCards("Genetics", 3),
    ]);
    assert.equal(failed.status, 503);
    assert.equal(failed.cacheControl, "no-store");
    assert.deepEqual(failed.body, {
      error: "We couldn’t save this deck. Check the database connection and try again.",
    });
    const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.deepEqual(listed.body.decks, [], "no deck was saved during the outage");

    failure.mock.mockImplementation(createDeck);
    const retried = await sendRequest(baseUrl, "POST", "/flashcards/generate", request);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.cards.length, 3);
    const reopened = await sendRequest(baseUrl, "GET", `/flashcards/decks/${retried.body.id}`);
    assert.deepEqual(reopened.body, retried.body);
    const afterRetry = await sendRequest(baseUrl, "GET", "/flashcards/decks");
    assert.equal(afterRetry.body.decks.length, 1);
  }, generator, store);
});

test("progress failures remain retryable without advancing the saved card", async t => {
  // Cover both the validation read and the write: either can fail during an outage.
  for (const operation of ["getDeck", "updateProgress"] as const) {
    await t.test(`${operation} rejects`, async t => {
      const store = new MemoryDeckStore();
      const deck = await store.createDeck(
        "learner-one", "Genetics", "medium", fakeCards("Genetics", 3),
      );
      const failure = operation === "getDeck"
        ? t.mock.method(store, "getDeck", async () => { throw new Error("Database unavailable"); })
        : t.mock.method(store, "updateProgress", async () => { throw new Error("Database unavailable"); });
      const progress = { cardId: "card-1", status: "known", activeIndex: 1 };

      await withServer(async baseUrl => {
        const path = `/flashcards/decks/${deck.id}/progress`;
        const failed = await sendRequest(baseUrl, "PATCH", path, progress);
        assert.equal(failure.mock.callCount(), 1);
        assert.deepEqual(failure.mock.calls[0].arguments, operation === "getDeck"
          ? ["learner-one", deck.id]
          : ["learner-one", deck.id, progress]);
        assert.equal(failed.status, 503);
        assert.equal(failed.cacheControl, "no-store");
        assert.deepEqual(failed.body, {
          error: "Study progress could not be saved right now.",
        });

        failure.mock.restore();
        assert.deepEqual(await store.getDeck("learner-one", deck.id), deck);
        const retried = await sendRequest(baseUrl, "PATCH", path, progress);
        assert.equal(retried.status, 200);
        assert.equal(retried.body.activeIndex, 1);
        assert.equal(retried.body.cards[0].status, "known");
        const reopened = await sendRequest(baseUrl, "GET", `/flashcards/decks/${deck.id}`);
        assert.deepEqual(reopened.body, retried.body);
      }, undefined, store);
    });
  }
});

test("a failed restart preserves saved progress and can be retried", async t => {
  const store = new MemoryDeckStore();
  const deck = await store.createDeck(
    "learner-one", "Genetics", "medium", fakeCards("Genetics", 3),
  );
  await store.updateProgress("learner-one", deck.id, {
    cardId: "card-1", status: "known", activeIndex: 1,
  });
  await store.updateProgress("learner-one", deck.id, {
    cardId: "card-2", status: "again", activeIndex: 2,
  });
  const beforeRestart = await store.getDeck("learner-one", deck.id);
  const failure = t.mock.method(store, "restartDeck", async () => {
    throw new Error("Database unavailable");
  });

  await withServer(async baseUrl => {
    const path = `/flashcards/decks/${deck.id}/restart`;
    const failed = await sendRequest(baseUrl, "POST", path);
    assert.equal(failure.mock.callCount(), 1);
    assert.deepEqual(failure.mock.calls[0].arguments, ["learner-one", deck.id]);
    assert.equal(failed.status, 503);
    assert.equal(failed.cacheControl, "no-store");
    assert.deepEqual(failed.body, {
      error: "Study progress could not be reset right now.",
    });
    assert.deepEqual(await store.getDeck("learner-one", deck.id), beforeRestart);

    failure.mock.restore();
    const retried = await sendRequest(baseUrl, "POST", path);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.activeIndex, 0);
    assert.ok(retried.body.cards.every((card: StoredFlashcard) => card.status === "new"));
    const reopened = await sendRequest(baseUrl, "GET", `/flashcards/decks/${deck.id}`);
    assert.deepEqual(reopened.body, retried.body);
  }, undefined, store);
});
