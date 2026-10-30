import { MongoFlashcardDeckStore } from "../lib/flashcard-decks";
import { readFileSync } from "node:fs";
import { authenticateRecoveryOperator } from "../lib/recovery-operator";

// Usage documented in docs/legacy-deck-recovery.md. No public issuance endpoint.
const [deckId, legacyOwnerId, targetUserId, confirmation] = process.argv.slice(2);
if (!deckId || !legacyOwnerId || !targetUserId || confirmation !== "--ownership-verified") {
  process.stderr.write(
    "Usage: tsx src/scripts/approve-legacy-recovery.ts DECK_ID LEGACY_OWNER CLERK_USER_ID --ownership-verified (operator session on stdin)\n" +
    "Only run after independently verifying ownership. A device ID or a signed-in account alone is not evidence.\n",
  );
  process.exitCode = 1;
} else {
  const store = new MongoFlashcardDeckStore();
  try {
    if (process.stdin.isTTY) throw new Error("Provide the private operator session on stdin.");
    const operatorId = await authenticateRecoveryOperator(readFileSync(0, "utf8").trim());
    const code = await store.approveLegacyRecovery({ deckId, legacyOwnerId, targetUserId, operatorId });
    // Deliberate one-time operator output, not an application log.
    process.stdout.write(`Recovery code (expires in 24 hours; deliver privately to the verified learner):\n${code}\n`);
  } catch {
    process.stderr.write("Recovery approval unconfirmed. Check operator permission, identifiers, and database transaction support. No code displayed; retry approval to replace any uncertain code.\n");
    process.exitCode = 1;
  } finally {
    await store.close().catch(() => {
      process.stderr.write("Could not close database connection cleanly.\n");
      process.exitCode = 1;
    });
  }
}
