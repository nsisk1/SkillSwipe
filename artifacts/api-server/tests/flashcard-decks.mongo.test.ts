import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoFlashcardDeckStore } from "../src/lib/flashcard-decks";
import { getMongoTestConfig } from "./helpers/mongodb-test-config";

const config = getMongoTestConfig(
  process.env,
  process.env.SKILLSWIPE_REQUIRE_TEST_MONGODB === "1",
);

test(
  "MongoDB saved decks persist through create, reopen, progress, and restart",
  { skip: !config, timeout: 60_000 },
  async () => {
    assert.ok(config);
    const { uri: mongoUri, databaseName } = config;

    const ownerId = `mongo-integration-${randomUUID()}`;
    const legacyOwnerId = `sw-test-${randomUUID().replaceAll("-", "")}`;
    const recoveryRecipient = `user_test${randomUUID().replaceAll("-", "")}`;
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

      const legacy = await reopenedStore.createDeck(
        legacyOwnerId, "Legacy recovery integration", "intermediate", created.cards,
      );
      await reopenedStore.updateProgress(legacyOwnerId, legacy.id, {
        cardId: legacy.cards[0]!.id, status: "known", activeIndex: 1,
      });
      const code = await reopenedStore.approveLegacyRecovery({
        deckId: legacy.id, legacyOwnerId, targetUserId: recoveryRecipient,
      });
      assert.equal(await reopenedStore.reviewLegacyDeck("user_wrong", code), null);
      const review = await reopenedStore.reviewLegacyDeck(recoveryRecipient, code);
      assert.ok(review);
      assert.ok(await reopenedStore.getDeck(legacyOwnerId, legacy.id));
      const [accepted, retried] = await Promise.all([
        reopenedStore.transferLegacyDeck(recoveryRecipient, code),
        reopenedStore.transferLegacyDeck(recoveryRecipient, code),
      ]);
      assert.ok(accepted && retried);
      assert.deepEqual(accepted.cards, review.cards);
      assert.equal(accepted.activeIndex, 1);
      assert.equal(accepted.createdAt, legacy.createdAt);
      assert.equal(await reopenedStore.getDeck(legacyOwnerId, legacy.id), null);
      assert.equal(await reopenedStore.getDeck("user_wrong", legacy.id), null);
      assert.ok(await reopenedStore.getDeck(recoveryRecipient, legacy.id));
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
          .deleteMany({ ownerId: { $in: [ownerId, legacyOwnerId, recoveryRecipient] } });
      } finally {
        await cleanupClient.close();
      }
    }
  },
);
