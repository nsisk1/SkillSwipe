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
import {
  UpdateFlashcardProgressBody,
  ReviewLegacyDeckBody,
  ReviewLegacyDeckResponse,
  TransferLegacyDeckBody,
  TransferLegacyDeckResponse,
  RequestLegacyRecoveryBody,
  RequestLegacyRecoveryResponse,
} from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import {
  MongoLegacyRecoveryRequestInbox,
  type LegacyRecoveryRequestInbox,
} from "../../lib/legacy-recovery-requests";

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
          "Create concise, accurate study flashcards at the requested learner level. Beginner/easy: explain foundational ideas in plain language with minimal assumed knowledge. Intermediate/medium: assume basic familiarity and cover useful mechanisms and relationships. Advanced/hard: use precise terminology and include nuance, exceptions, and deeper connections when relevant. Return only a JSON object with one property, cards: an array of objects containing question and answer strings. Do not include markdown or any other fields.",
      },
      {
        role: "user",
        content: `Create exactly ${input.cardCount} flashcards about "${input.topic}" for a ${input.difficulty} learner. Questions should test distinct, useful concepts at that level. Keep answers clear and appropriately detailed for that level.`,
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
  resolveLearnerId: (req: Request) => string | null = req =>
    getAuth(req).userId ?? null,
  recoveryInbox: LegacyRecoveryRequestInbox = new MongoLegacyRecoveryRequestInbox(),
): IRouter {
  const router: IRouter = Router();

  router.use((req, res, next): void => {
    // Deck responses must never survive sign-out in a browser/proxy HTTP cache.
    res.setHeader("Cache-Control", "no-store");
    const learnerId = resolveLearnerId(req);
    if (!learnerId) {
      res.status(401).json({ error: "Sign in to access saved decks." });
      return;
    }
    res.locals.learnerId = learnerId;
    next();
  });

  router.post("/flashcards/recovery/requests", async (req, res): Promise<void> => {
    // Reject extra identity/device/evidence fields, rather than accepting them as proof.
    const parsed = RequestLegacyRecoveryBody.strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide only a valid reply email (up to 254 characters)." });
      return;
    }
    try {
      const request = await recoveryInbox.submit(res.locals.learnerId as string, parsed.data.replyEmail);
      res.status(200).json(RequestLegacyRecoveryResponse.parse({
        requestId: request.requestId, replyEmail: request.replyEmail,
      }));
    } catch {
      // Do not log email addresses, request contents, or database error payloads.
      req.log?.error("Private recovery request could not be saved");
      res.status(503).json({ error: "Your request could not be confirmed. Please try again; retries will not create another open request." });
    }
  });

  for (const action of ["review", "transfer"] as const) {
    router.post(`/flashcards/recovery/${action}`, async (req, res): Promise<void> => {
      res.setHeader("Cache-Control", "no-store");
      const schema = action === "review" ? ReviewLegacyDeckBody : TransferLegacyDeckBody;
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Enter the complete recovery code." });
        return;
      }
      try {
        const learnerId = res.locals.learnerId as string;
        const deck = action === "review"
          ? await deckStore.reviewLegacyDeck(learnerId, parsed.data.code)
          : await deckStore.transferLegacyDeck(learnerId, parsed.data.code);
        if (!deck) {
          res.status(404).json({
            error: "This code is unavailable, expired, or not approved for your account.",
          });
          return;
        }
        const responseSchema = action === "review"
          ? ReviewLegacyDeckResponse : TransferLegacyDeckResponse;
        res.json(responseSchema.parse(toClientDeck(deck)));
      } catch (error) {
        req.log?.error({ err: error }, "Legacy deck recovery failed");
        res.status(503).json({ error: "Recovery is unavailable right now. Please try again." });
      }
    });
  }

  router.post("/flashcards/generate", async (req, res): Promise<void> => {
    const parsed = GenerateFlashcardsBody.safeParse(req.body);
    if (!parsed.success) {
      req.log?.warn({ errors: parsed.error.issues }, "Invalid flashcard request");
      res.status(400).json({
        error: "Provide a topic and choose between 3 and 10 flashcards.",
      });
      return;
    }

    const learnerId = res.locals.learnerId as string;

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
      const deck = await deckStore.createDeck(
        learnerId,
        topic,
        parsed.data.difficulty,
        cards,
      );
      res.status(200).json(GenerateFlashcardsResponse.parse(toClientDeck(deck)));
    } catch (error) {
      req.log?.error({ err: error }, "Flashcard deck persistence failed");
      res.status(503).json({
        error: "We couldn’t save this deck. Check the database connection and try again.",
      });
    }
  });

  router.get("/flashcards/decks", async (req, res): Promise<void> => {
    const learnerId = res.locals.learnerId as string;

    try {
      const decks = await deckStore.listDecks(learnerId);
      res.status(200).json({
        decks: decks.map(deck => ({
          id: deck.id,
          topic: deck.topic,
          ...(deck.difficulty ? { difficulty: deck.difficulty } : {}),
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
    const learnerId = res.locals.learnerId as string;

    try {
      const deck = await deckStore.getDeck(learnerId, req.params.deckId);
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
    const learnerId = res.locals.learnerId as string;

    const parsed = UpdateFlashcardProgressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide a valid card status and deck position." });
      return;
    }

    try {
      const deck = await deckStore.getDeck(learnerId, req.params.deckId);
      if (
        !deck ||
        parsed.data.activeIndex > deck.cards.length ||
        !deck.cards.some(card => card.id === parsed.data.cardId)
      ) {
        res.status(404).json({ error: "That deck or card could not be found." });
        return;
      }

      const updatedDeck = await deckStore.updateProgress(
        learnerId,
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
    const learnerId = res.locals.learnerId as string;

    try {
      const deck = await deckStore.restartDeck(learnerId, req.params.deckId);
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

function toClientDeck(deck: FlashcardDeck) {
  return {
    id: deck.id,
    topic: deck.topic,
    ...(deck.difficulty ? { difficulty: deck.difficulty } : {}),
    cards: deck.cards,
    activeIndex: deck.activeIndex,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  };
}

export default createFlashcardsRouter();
