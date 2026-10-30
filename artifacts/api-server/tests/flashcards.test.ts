import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { FlashcardGenerationResult } from "@workspace/api-zod";
import { createFlashcardsRouter } from "../src/routes/flashcards";

type Generator = NonNullable<Parameters<typeof createFlashcardsRouter>[0]>;

async function postGenerate(
  body: unknown,
  generator: Generator,
): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  app.use(createFlashcardsRouter(generator));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not read the test server address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/flashcards/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
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

test("POST /flashcards/generate returns cards from the mocked generator", async () => {
  let callCount = 0;
  const result = await postGenerate(
    { topic: "Cell biology", cardCount: 3 },
    async input => {
      callCount += 1;
      assert.equal(input.topic, "Cell biology");
      assert.equal(input.cardCount, 3);
      return fakeCards(input.topic, input.cardCount);
    },
  );

  assert.equal(result.status, 200);
  assert.equal(callCount, 1);
  const payload = result.body as FlashcardGenerationResult;
  assert.equal(payload.topic, "Cell biology");
  assert.equal(payload.cards.length, 3);
  assert.equal(payload.cards[0]?.question, "Question 1");
});

test("POST /flashcards/generate rejects invalid input without calling the generator", async () => {
  let callCount = 0;
  const result = await postGenerate(
    { topic: "Biology", cardCount: 11 },
    async () => {
      callCount += 1;
      return fakeCards("Biology", 6);
    },
  );

  assert.equal(result.status, 400);
  assert.equal(callCount, 0);
  assert.deepEqual(result.body, {
    error: "Provide a topic and choose between 3 and 10 flashcards.",
  });
});

test("POST /flashcards/generate reports a failed generator as a gateway error", async () => {
  const result = await postGenerate(
    { topic: "Genetics", cardCount: 3 },
    async () => {
      throw new Error("Simulated AI failure");
    },
  );

  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    error: "We couldn’t generate this deck. Please try again.",
  });
});
