import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoFlashcardDeckStore } from "../src/lib/flashcard-decks";

const mongoUri = process.env.SKILLSWIPE_TEST_MONGODB_URI?.trim();
const databaseName = process.env.SKILLSWIPE_TEST_MONGODB_DATABASE?.trim();

test(
  "MongoDB saved decks persist through create, reopen, progress, and restart",
  { skip: !mongoUri && !databaseName },
  async () => {
    assert.ok(
      mongoUri,
      "Set SKILLSWIPE_TEST_MONGODB_URI to a disposable MongoDB instance.",
    );
    assert.equal(
      databaseName,
      "skillswipe_test",
      "SKILLSWIPE_TEST_MONGODB_DATABASE must be exactly skillswipe_test.",
    );

    const uriDatabase = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
    assert.ok(
      !uriDatabase || uriDatabase === databaseName,
      "The test MongoDB URI must not target a different database.",
    );

    const ownerId = `mongo-integration-${randomUUID()}`;
    const config = { uri: mongoUri, databaseName };
    const initialStore = new MongoFlashcardDeckStore(config);
    let reopenedStore: MongoFlashcardDeckStore | undefined;
    const cleanupClient = new MongoClient(mongoUri);

    try {
      const created = await initialStore.createDeck(
        ownerId,
        "MongoDB persistence test",
        "intermediate",
        [
          {
            id: randomUUID(),
            topic: "MongoDB persistence test",
            question: "What does a MongoDB collection contain?",
            answer: "Documents.",
          },
          {
            id: randomUUID(),
            topic: "MongoDB persistence test",
            question: "What groups collections?",
            answer: "A database.",
          },
        ],
      );
      assert.equal(created.ownerId, ownerId);
      assert.equal(created.cards.length, 2);
      assert.ok(created.cards.every(card => card.status === "new"));

      const initialList = await initialStore.listDecks(ownerId);
      assert.deepEqual(
        initialList.map(deck => deck.id),
        [created.id],
      );

      await initialStore.close();

      // A fresh store and MongoDB client model the app reconnecting after restart.
      reopenedStore = new MongoFlashcardDeckStore(config);
      const listAfterReconnect = await reopenedStore.listDecks(ownerId);
      assert.deepEqual(
        listAfterReconnect.map(deck => deck.id),
        [created.id],
      );

      const reopened = await reopenedStore.getDeck(ownerId, created.id);
      assert.ok(reopened);
      assert.equal(reopened.cards[0]?.question, created.cards[0]?.question);
      assert.equal(reopened.activeIndex, 0);

      const updated = await reopenedStore.updateProgress(ownerId, created.id, {
        cardId: created.cards[0]!.id,
        status: "known",
        activeIndex: 1,
      });
      assert.ok(updated);
      assert.equal(updated.cards[0]?.status, "known");
      assert.equal(updated.activeIndex, 1);

      const persistedUpdate = await reopenedStore.getDeck(ownerId, created.id);
      assert.ok(persistedUpdate);
      assert.equal(persistedUpdate.cards[0]?.status, "known");
      assert.equal(persistedUpdate.activeIndex, 1);

      const restarted = await reopenedStore.restartDeck(ownerId, created.id);
      assert.ok(restarted);
      assert.equal(restarted.activeIndex, 0);
      assert.ok(restarted.cards.every(card => card.status === "new"));
    } finally {
      await Promise.allSettled([
        initialStore.close(),
        ...(reopenedStore ? [reopenedStore.close()] : []),
      ]);

      await cleanupClient.connect();
      try {
        await cleanupClient
          .db(databaseName)
          .collection("skillswipe_decks")
          .deleteMany({ ownerId });
      } finally {
        await cleanupClient.close();
      }
    }
  },
);
