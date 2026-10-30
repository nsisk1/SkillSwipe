import { readFileSync } from "node:fs";
import { MongoFlashcardDeckStore } from "../lib/flashcard-decks";
import { authenticateRecoveryOperator } from "../lib/recovery-operator";

const [deckId] = process.argv.slice(2);
if (!deckId) {
  process.stderr.write("Usage: tsx src/scripts/revoke-legacy-recovery.ts DECK_UUID (operator session on stdin)\n");
  process.exitCode = 1;
} else {
  const store = new MongoFlashcardDeckStore();
  try {
    if (process.stdin.isTTY) throw new Error("Provide the private operator session on stdin.");
    const operatorId = await authenticateRecoveryOperator(readFileSync(0, "utf8").trim());
    const revoked = await store.revokeLegacyRecovery(deckId, operatorId);
    process.stdout.write(revoked ? "Recovery approval revoked.\n" : "No unaccepted approval found.\n");
  } catch {
    process.stderr.write("Revocation unconfirmed. Check operator permission and database transaction support; retry safely.\n");
    process.exitCode = 1;
  } finally {
    await store.close().catch(() => {
      process.stderr.write("Could not close database connection cleanly.\n");
      process.exitCode = 1;
    });
  }
}
