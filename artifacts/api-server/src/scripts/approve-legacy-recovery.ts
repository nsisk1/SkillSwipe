import { MongoFlashcardDeckStore } from "../lib/flashcard-decks";

// Usage documented in docs/legacy-deck-recovery.md. No public issuance endpoint.
const [deckId, legacyOwnerId, targetUserId, confirmation] = process.argv.slice(2);
if (!deckId || !legacyOwnerId || !targetUserId || confirmation !== "--ownership-verified") {
  process.stderr.write(
    "Usage: tsx src/scripts/approve-legacy-recovery.ts DECK_ID LEGACY_OWNER CLERK_USER_ID --ownership-verified\n" +
    "Only run after independently verifying ownership. A device ID or a signed-in account alone is not evidence.\n",
  );
  process.exitCode = 1;
} else {
  const store = new MongoFlashcardDeckStore();
  try {
    const code = await store.approveLegacyRecovery({ deckId, legacyOwnerId, targetUserId });
    // Deliberate one-time operator output, not an application log.
    process.stdout.write(`Recovery code (expires in 24 hours; deliver privately to the verified learner):\n${code}\n`);
  } catch {
    process.stderr.write("Recovery approval failed. Check the identifiers and database connection. No code issued.\n");
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}
