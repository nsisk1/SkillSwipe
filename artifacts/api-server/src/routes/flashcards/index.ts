import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { GenerateFlashcardsBody, GenerateFlashcardsResponse } from "@workspace/api-zod";
import type { FlashcardGenerationInput } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  MongoFlashcardDeckStore,
  type FlashcardDeck,
  type FlashcardDeckStore,
} from "../../lib/flashcard-decks";
import type { Request } from "express";
import { UpdateFlashcardProgressBody } from "@workspace/api-zod";

type GeneratedFlashcard = {
  id: string;
  topic: string;
  question: string;
  answer: string;
};

type FlashcardGenerator = (
  input: FlashcardGenerationInput,
) => Promise<GeneratedFlashcard[]>;

function requiredText(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`AI response is missing a valid ${fieldName}.`);
  }

  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new Error(`AI response contains an invalid ${fieldName}.`);
  }

  return text;
}

export function parseFlashcardCompletion(
  content: string,
  topic: string,
  cardCount: number,
): GeneratedFlashcard[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(content);
  } catch {
    throw new Error("AI response was not valid JSON.");
  }

  if (!decoded || typeof decoded !== "object" || !("cards" in decoded)) {
    throw new Error("AI response did not include a cards array.");
  }

  const rawCards = decoded.cards;
  if (!Array.isArray(rawCards) || rawCards.length !== cardCount) {
    throw new Error(`AI response must contain exactly ${cardCount} cards.`);
  }

  return rawCards.map((rawCard, index) => {
    if (!rawCard || typeof rawCard !== "object") {
      throw new Error(`AI response card ${index + 1} was invalid.`);
    }

    const fields = rawCard as Record<string, unknown>;
    return {
      id: randomUUID(),
      topic,
      question: requiredText(fields.question, "question", 240),
      answer: requiredText(fields.answer, "answer", 1200),
    };
  });
}

async function generateWithOpenAI(
  input: FlashcardGenerationInput,
): Promise<GeneratedFlashcard[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Create concise, accurate study flashcards. Return only a JSON object with one property, cards: an array of objects containing question and answer strings. Do not include markdown or any other fields.",
      },
      {
        role: "user",
        content: `Create exactly ${input.cardCount} flashcards about "${input.topic}". Questions should test distinct, useful concepts. Keep answers clear and brief.`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned an empty response.");
  }

  return parseFlashcardCompletion(content, input.topic, input.cardCount);
}

export function createFlashcardsRouter(
  generateCards: FlashcardGenerator = generateWithOpenAI,
  deckStore: FlashcardDeckStore = new MongoFlashcardDeckStore(),
): IRouter {
  const router: IRouter = Router();

  router.post("/flashcards/generate", async (req, res): Promise<void> => {
    const parsed = GenerateFlashcardsBody.safeParse(req.body);
    if (!parsed.success) {
      req.log?.warn({ errors: parsed.error.issues }, "Invalid flashcard request");
      res.status(400).json({
        error: "Provide a topic and choose between 3 and 10 flashcards.",
      });
      return;
    }

    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "A valid SkillSwipe device ID is required." });
      return;
    }

    const topic = parsed.data.topic.trim();
    if (topic.length < 2) {
      res.status(400).json({ error: "Enter a topic with at least 2 characters." });
      return;
    }

    let cards: GeneratedFlashcard[];
    try {
      cards = await generateCards({ ...parsed.data, topic });
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard generation failed");
      res.status(502).json({
        error: "We couldn’t generate this deck. Please try again.",
      });
      return;
    }

    try {
      const deck = await deckStore.createDeck(deviceId, topic, cards);
      res.status(200).json(GenerateFlashcardsResponse.parse(toClientDeck(deck)));
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard deck persistence failed");
      res.status(503).json({
        error: "We couldn’t save this deck. Check the database connection and try again.",
      });
    }
  });

  router.get("/flashcards/decks", async (req, res): Promise<void> => {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "A valid SkillSwipe device ID is required." });
      return;
    }

    try {
      const decks = await deckStore.listDecks(deviceId);
      res.status(200).json({
        decks: decks.map(deck => ({
          id: deck.id,
          topic: deck.topic,
          cardCount: deck.cards.length,
          knownCount: deck.cards.filter(card => card.status === "known").length,
          activeIndex: deck.activeIndex,
          updatedAt: deck.updatedAt,
        })),
      });
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard deck listing failed");
      res.status(503).json({ error: "Saved decks are unavailable right now." });
    }
  });

  router.get("/flashcards/decks/:deckId", async (req, res): Promise<void> => {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "A valid SkillSwipe device ID is required." });
      return;
    }

    try {
      const deck = await deckStore.getDeck(deviceId, req.params.deckId);
      if (!deck) {
        res.status(404).json({ error: "That deck could not be found." });
        return;
      }
      res.status(200).json(toClientDeck(deck));
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard deck retrieval failed");
      res.status(503).json({ error: "That deck is unavailable right now." });
    }
  });

  router.patch("/flashcards/decks/:deckId/progress", async (req, res): Promise<void> => {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "A valid SkillSwipe device ID is required." });
      return;
    }

    const parsed = UpdateFlashcardProgressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide a valid card status and deck position." });
      return;
    }

    try {
      const deck = await deckStore.getDeck(deviceId, req.params.deckId);
      if (
        !deck ||
        parsed.data.activeIndex > deck.cards.length ||
        !deck.cards.some(card => card.id === parsed.data.cardId)
      ) {
        res.status(404).json({ error: "That deck or card could not be found." });
        return;
      }

      const updatedDeck = await deckStore.updateProgress(
        deviceId,
        req.params.deckId,
        parsed.data,
      );
      if (!updatedDeck) {
        res.status(404).json({ error: "That deck or card could not be found." });
        return;
      }
      res.status(200).json(toClientDeck(updatedDeck));
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard progress save failed");
      res.status(503).json({ error: "Study progress could not be saved right now." });
    }
  });

  router.post("/flashcards/decks/:deckId/restart", async (req, res): Promise<void> => {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ error: "A valid SkillSwipe device ID is required." });
      return;
    }

    try {
      const deck = await deckStore.restartDeck(deviceId, req.params.deckId);
      if (!deck) {
        res.status(404).json({ error: "That deck could not be found." });
        return;
      }
      res.status(200).json(toClientDeck(deck));
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard deck restart failed");
      res.status(503).json({ error: "Study progress could not be reset right now." });
    }
  });

  return router;
}

function getDeviceId(req: Request): string | null {
  const deviceId = req.get("x-skillswipe-device-id")?.trim();
  return deviceId && deviceId.length <= 128 ? deviceId : null;
}

function toClientDeck(deck: FlashcardDeck) {
  return {
    id: deck.id,
    topic: deck.topic,
    cards: deck.cards,
    activeIndex: deck.activeIndex,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  };
}

export default createFlashcardsRouter();
