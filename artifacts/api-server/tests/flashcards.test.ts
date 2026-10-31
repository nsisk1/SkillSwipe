import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { FlashcardGenerationResult } from "@workspace/api-zod";
import { ListFlashcardDecksResponse } from "@workspace/api-zod";
import {
  createFlashcardsRouter,
  parseFlashcardCompletion,
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

// Reuse the same invalid payloads at the parser and HTTP boundaries so every
// rejection is also checked for its public error and lack of persistence.
function invalidCompletions(): { name: string; content: string; error: string }[] {
  const cases = [
    {
      name: "malformed JSON",
      content: '{"cards": [',
      error: "AI response was not valid JSON.",
    },
    {
      name: "empty content",
      content: "",
      error: "AI response was not valid JSON.",
    },
    {
      name: "whitespace-only content",
      content: " \n\t ",
      error: "AI response was not valid JSON.",
    },
  ];
  for (const decoded of [null, false, 42, "cards", [], {}]) {
    cases.push({
      name: `missing cards in ${JSON.stringify(decoded)}`,
      content: JSON.stringify(decoded),
      error: "AI response did not include a cards array.",
    });
  }
  for (const cards of [null, {}, "cards", 3, false]) {
    cases.push({
      name: `non-array cards: ${JSON.stringify(cards)}`,
      content: JSON.stringify({ cards }),
      error: "AI response must contain exactly 3 cards.",
    });
  }
  for (const count of [0, 2, 4]) {
    cases.push({
      name: `wrong card count: ${count}`,
      content: JSON.stringify({ cards: fakeCards("Biology", count) }),
      error: "AI response must contain exactly 3 cards.",
    });
  }
  for (const card of [null, false, 42, "card"]) {
    cases.push({
      name: `invalid card: ${JSON.stringify(card)}`,
      content: JSON.stringify({ cards: [fakeCards("Biology", 1)[0], card, {}] }),
      error: "AI response card 2 was invalid.",
    });
  }
  for (const [field, limit] of [["question", 240], ["answer", 1200]] as const) {
    for (const value of [undefined, null, false, 42, {}, [], "", " \n\t ", "x".repeat(limit + 1)]) {
      const cards = fakeCards("Biology", 3);
      // Put the bad field last to catch accidental saves of partially parsed decks.
      const invalidCard = { ...cards[2], [field]: value };
      cases.push({
        name: `${field}: ${value === undefined ? "missing" : JSON.stringify(value)}`,
        content: JSON.stringify({ cards: [...cards.slice(0, 2), invalidCard] }),
        error: typeof value === "string"
          ? `AI response contains an invalid ${field}.`
          : `AI response is missing a valid ${field}.`,
      });
    }
  }
  return cases;
}

test("parseFlashcardCompletion rejects malformed AI decks", async t => {
  for (const { name, content, error } of invalidCompletions()) {
    // Avoid printing oversized field contents in the test runner.
    await t.test(name.length > 100 ? `${name.slice(0, 60)}… (oversized)` : name, () => {
      assert.throws(() => parseFlashcardCompletion(content, "Biology", 3), {
        name: "Error",
        message: error,
      });
    });
  }
});

test("parseFlashcardCompletion accepts exact length boundaries and trims text", () => {
  const content = JSON.stringify({
    cards: [
      { question: " \nWhat is a cell?\t ", answer: " \tThe basic unit of life.\n " },
      { question: "x".repeat(240), answer: "y".repeat(1200) },
      { question: " q ", answer: " a " },
    ],
  });
  const cards = parseFlashcardCompletion(content, "Biology", 3);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(({ question, answer, topic }) => ({ question, answer, topic })), [
    { question: "What is a cell?", answer: "The basic unit of life.", topic: "Biology" },
    { question: "x".repeat(240), answer: "y".repeat(1200), topic: "Biology" },
    { question: "q", answer: "a", topic: "Biology" },
  ]);
  assert.equal(new Set(cards.map(card => card.id)).size, 3);
  for (const card of cards) {
    assert.match(card.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
});

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

test("generation rejects invalid input without generating or saving a deck", async t => {
  const schemaError = "Provide a topic and choose between 3 and 10 flashcards.";
  const validInput = { topic: "Biology", cardCount: 3, difficulty: "intermediate" };
  const cases = [
    { name: "count above maximum", body: { ...validInput, cardCount: 11 }, error: schemaError },
    { name: "count below minimum", body: { ...validInput, cardCount: 2 }, error: schemaError },
    { name: "non-integer count", body: { ...validInput, cardCount: 3.5 }, error: schemaError },
    { name: "unsupported learner level", body: { ...validInput, difficulty: "expert" }, error: schemaError },
    { name: "missing topic", body: { cardCount: 3, difficulty: "intermediate" }, error: schemaError },
    {
      name: "whitespace-only topic",
      body: { ...validInput, topic: " \n\t " },
      error: "Enter a topic with at least 2 characters.",
    },
  ];

  for (const { name, body, error } of cases) {
    await t.test(name, async t => {
      const store = new MemoryDeckStore();
      const save = t.mock.method(store, "createDeck");
      const generator = t.mock.fn<FlashcardGenerator>(
        async input => fakeCards(input.topic, input.cardCount),
      );

      await withServer(async baseUrl => {
        const result = await sendRequest(baseUrl, "POST", "/flashcards/generate", body);
        assert.equal(result.status, 400);
        assert.deepEqual(result.body, { error });
        assert.equal(generator.mock.callCount(), 0);
        assert.equal(save.mock.callCount(), 0);
        assert.deepEqual(await store.listDecks("learner-one"), []);
      }, generator, store);
    });
  }
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

test("invalid AI completions return 502 without saving a deck", async t => {
  const cases: { name: string; completion: unknown }[] = [
    ...invalidCompletions().map(({ name, content }) => ({
      name: name.length > 100 ? `${name.slice(0, 60)}… (oversized)` : name,
      completion: { choices: [{ message: { content } }] },
    })),
    { name: "no choices", completion: { choices: [] } },
    { name: "missing message", completion: { choices: [{}] } },
    { name: "missing content", completion: { choices: [{ message: {} }] } },
    { name: "null content", completion: { choices: [{ message: { content: null } }] } },
  ];
  for (const { name, completion } of cases) {
    await t.test(name, async t => {
      const ai = t.mock.method(openai.chat.completions, "create", async () => completion);
      const store = new MemoryDeckStore();
      const save = t.mock.method(store, "createDeck");

      // Exercise the real generator and parser; only the external service is stubbed.
      await withServer(async baseUrl => {
        const result = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
          topic: "Biology",
          cardCount: 3,
        });
        assert.equal(ai.mock.callCount(), 1);
        assert.equal(result.status, 502);
        assert.deepEqual(result.body, {
          error: "We couldn’t generate this deck. Please try again.",
        });
        assert.equal(save.mock.callCount(), 0);

        const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body, { decks: [] });
      }, undefined, store);
    });
  }
});

test("stalled AI generation times out after 30 seconds without retrying or saving", async parent => {
  // Share one clock across the HTTP cases: undici may retain timer handles
  // between requests, so replacing the timer context between them is unsafe.
  parent.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stall of ["before headers", "during response body"] as const) {
    await parent.test(stall, async t => {
      const store = new MemoryDeckStore();
      const save = t.mock.method(store, "createDeck");
      // Keep the real SDK request/timeout machinery, replacing only its transport.
      let aborted = false;
      let readingBody = false;
      let clockError: unknown;
      function advanceDeadline() {
        try {
          parent.mock.timers.tick(29_999);
          assert.equal(aborted, false, "the request may use the full generation budget");
          parent.mock.timers.tick(1);
          assert.equal(aborted, true, "the stalled request is cancelled at the deadline");
        } catch (error) {
          clockError = error;
          throw error;
        }
      }
      const service = t.mock.method(openai, "fetch", async (_url, init) => {
        const signal = init?.signal;
        assert.ok(signal);
        if (stall === "during response body") {
          // Headers arrive immediately, but the JSON body never completes.
          // Only pull once the SDK begins consuming it, after its fetch timeout.
          return new Response(new ReadableStream({
            start(stream) {
              signal.addEventListener("abort", () => {
                aborted = true;
                stream.error(new DOMException("The operation was aborted.", "AbortError"));
              }, { once: true });
            },
            pull(stream) {
              readingBody = true;
              stream.enqueue(new TextEncoder().encode('{"choices":['));
              advanceDeadline();
            },
          }, { highWaterMark: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
          advanceDeadline();
        });
      });
      const completion = t.mock.method(openai.chat.completions, "create");
      const sharedTimeout = openai.timeout;
      const sharedRetries = openai.maxRetries;

      await withServer(async baseUrl => {
        const result = await sendRequest(baseUrl, "POST", "/flashcards/generate", {
          topic: "Biology",
          cardCount: 3,
        });
        assert.ifError(clockError);
        assert.equal(readingBody, stall === "during response body");
        assert.equal(result.status, 502);
        assert.equal(result.cacheControl, "no-store");
        assert.deepEqual(result.body, {
          error: "We couldn’t generate this deck. Please try again.",
        });
        assert.equal(completion.mock.callCount(), 1);
        const options = completion.mock.calls[0].arguments[1];
        assert.equal(options?.timeout, 30_000);
        assert.equal(options?.maxRetries, 0);
        assert.equal(options?.signal?.aborted, true);
        assert.equal(service.mock.callCount(), 1, "the SDK must not retry a timed-out request");
        assert.equal(aborted, true);
        assert.equal(save.mock.callCount(), 0);
        assert.equal(openai.timeout, sharedTimeout, "other callers keep the shared timeout");
        assert.equal(openai.maxRetries, sharedRetries, "other callers keep the shared retry policy");

        const listed = await sendRequest(baseUrl, "GET", "/flashcards/decks");
        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body, { decks: [] });
      }, undefined, store);
    });
  }
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

test("a failed saved-deck listing returns an unavailable error and can be retried", async t => {
  const store = new MemoryDeckStore();
  const deck = await store.createDeck(
    "learner-one", "Genetics", "medium", fakeCards("Genetics", 3),
  );
  const failure = t.mock.method(store, "listDecks", async () => {
    throw new Error("Simulated database outage: internal connection details");
  });

  await withServer(async baseUrl => {
    const path = "/flashcards/decks";
    const failed = await sendRequest(baseUrl, "GET", path);
    assert.equal(failure.mock.callCount(), 1);
    assert.deepEqual(failure.mock.calls[0].arguments, ["learner-one"]);
    assert.equal(failed.status, 503);
    assert.equal(failed.cacheControl, "no-store");
    assert.deepEqual(failed.body, {
      error: "Saved decks are unavailable right now.",
    });

    failure.mock.restore();
    const retried = await sendRequest(baseUrl, "GET", path);
    assert.equal(retried.status, 200);
    assert.equal(retried.cacheControl, "no-store");
    assert.deepEqual(retried.body, {
      decks: [{
        id: deck.id,
        topic: deck.topic,
        difficulty: deck.difficulty,
        cardCount: deck.cards.length,
        knownCount: 0,
        activeIndex: deck.activeIndex,
        updatedAt: deck.updatedAt,
      }],
    });
  }, undefined, store);
});

test("a failed saved-deck read returns an unavailable error and can be retried", async t => {
  const store = new MemoryDeckStore();
  const deck = await store.createDeck(
    "learner-one", "Genetics", "medium", fakeCards("Genetics", 3),
  );
  const failure = t.mock.method(store, "getDeck", async () => {
    throw new Error("Simulated database outage: internal connection details");
  });

  await withServer(async baseUrl => {
    const path = `/flashcards/decks/${deck.id}`;
    const failed = await sendRequest(baseUrl, "GET", path);
    assert.equal(failure.mock.callCount(), 1);
    assert.deepEqual(failure.mock.calls[0].arguments, ["learner-one", deck.id]);
    assert.equal(failed.status, 503);
    assert.equal(failed.cacheControl, "no-store");
    assert.deepEqual(failed.body, {
      error: "That deck is unavailable right now.",
    });

    failure.mock.restore();
    const retried = await sendRequest(baseUrl, "GET", path);
    assert.equal(retried.status, 200);
    assert.equal(retried.cacheControl, "no-store");
    const { ownerId, ...expectedDeck } = deck;
    assert.deepEqual(retried.body, expectedDeck);
  }, undefined, store);
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
