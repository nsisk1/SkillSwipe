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
        operatorId: "user_testoperator",
      });
      await cleanupClient.connect();
      const db = cleanupClient.db(databaseName);
      const audit = db.collection("skillswipe_recovery_audit");
      const approvalEvents = await audit.find({ deckId: legacy.id }).toArray();
      assert.equal(approvalEvents.length, 1);
      assert.equal(approvalEvents[0]!.event, "approval");
      assert.equal(approvalEvents[0]!.operatorId, "user_testoperator");
      assert.equal(approvalEvents[0]!.receivingAccountId, recoveryRecipient);
      assert.ok(approvalEvents[0]!.timestamp instanceof Date);
      assert.ok((await audit.indexes()).some(index =>
        index.key.expiresAt === 1 && index.expireAfterSeconds === 0));

      // Reject this test recipient's audit inserts at the database boundary.
      // Every associated mutation must roll back, including grant replacement.
      await db.command({
        collMod: "skillswipe_recovery_audit",
        validator: { receivingAccountId: { $ne: recoveryRecipient } },
        validationLevel: "strict",
        validationAction: "error",
      });
      const rejectedDeck = await reopenedStore.createDeck(
        legacyOwnerId, "Audit rollback test", "beginner", created.cards,
      );
      await assert.rejects(reopenedStore.approveLegacyRecovery({
        deckId: rejectedDeck.id, legacyOwnerId, targetUserId: recoveryRecipient,
        operatorId: "user_testoperator",
      }), /validation/i);
      assert.equal((await reopenedStore.getDeck(legacyOwnerId, rejectedDeck.id))?.recovery, undefined);
      await assert.rejects(reopenedStore.approveLegacyRecovery({
        deckId: legacy.id, legacyOwnerId, targetUserId: recoveryRecipient,
        operatorId: "user_testoperator",
      }), /validation/i);
      await assert.rejects(reopenedStore.revokeLegacyRecovery(legacy.id, "user_testoperator"), /validation/i);
      await assert.rejects(reopenedStore.transferLegacyDeck(recoveryRecipient, code), /validation/i);
      assert.ok(await reopenedStore.reviewLegacyDeck(recoveryRecipient, code));
      assert.ok(await reopenedStore.getDeck(legacyOwnerId, legacy.id));
      assert.equal(await audit.countDocuments({ deckId: legacy.id }), 1);
      await db.command({ collMod: "skillswipe_recovery_audit", validator: {} });
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
      const events = await audit.find({ deckId: legacy.id }).sort({ timestamp: 1 }).toArray();
      assert.deepEqual(events.map(event => event.event), ["approval", "transfer"]);
      assert.equal(events[1]!.actorId, recoveryRecipient);
      assert.equal(events[1]!.operatorId, "user_testoperator");
      assert.equal(events[0]!.grantId, events[1]!.grantId);
      assert.ok(!JSON.stringify(events).includes(code.split(".")[1]!));
      await db.collection("skillswipe_decks").deleteOne({ id: legacy.id, ownerId: recoveryRecipient });
      assert.equal(await audit.countDocuments({ deckId: legacy.id }), 2, "audit survives deck deletion");
    } finally {
      await Promise.allSettled([
        initialStore.close(),
        ...(reopenedStore ? [reopenedStore.close()] : []),
      ]);

      await cleanupClient.connect();
      try {
        // Even failed assertions must not leave the disposable database validator enabled.
        if (await cleanupClient.db(databaseName).listCollections({ name: "skillswipe_recovery_audit" }).hasNext()) {
          await cleanupClient.db(databaseName).command({
            collMod: "skillswipe_recovery_audit", validator: {},
          });
        }
        await cleanupClient
          .db(databaseName)
          .collection("skillswipe_decks")
          .deleteMany({ ownerId: { $in: [ownerId, legacyOwnerId, recoveryRecipient] } });
        await cleanupClient.db(databaseName).collection("skillswipe_recovery_audit")
          .deleteMany({ receivingAccountId: recoveryRecipient });
      } finally {
        await cleanupClient.close();
      }
    }
  },
);
