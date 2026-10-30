# Legacy deck recovery

Legacy decks have an installation owner (`sw-…`), not a verified learner.
Signing in, possessing the device, knowing the installation ID or deck ID,
or checking an “I own this” box is **not** sufficient ownership evidence.
There is deliberately no installation-based discovery or self-claim endpoint.

## Operator approval

1. Independently verify the original learner's ownership using trustworthy
   evidence outside the installation record (for example, a pre-existing
   verified support record linking that learner to those specific decks).
   The current database alone cannot establish this. If no such evidence
   exists, decline recovery; do not guess or disclose deck topics as hints.
2. Verify the receiving account's Clerk user ID in the correct environment.
   The learner can see their account ID in the recovery panel.
3. For each approved deck, run from `artifacts/api-server` in the intended
   environment, using that environment's existing database configuration:

   ```sh
   pnpm exec tsx src/scripts/approve-legacy-recovery.ts \
     DECK_UUID sw-LEGACY-INSTALLATION-ID user_VERIFIED_ACCOUNT --ownership-verified
   ```

   This changes only that deck's recovery approval, not its owner or progress.
   It refuses account-owned decks. Reissuing replaces any previous code.
   Keep the command output out of shared logs, tickets, source control, and chat.
4. Deliver the code privately to the independently verified learner.
   It is bound to that Clerk account, valid for 24 hours, and stored only as
   a SHA-256 hash of its random 256-bit secret.
5. The learner opens **Saved decks → Recover older decks**, enters the code,
   reviews the topic, cards and progress, then explicitly chooses **Transfer
   to my account**. Canceling the review makes no ownership changes.

After acceptance the same deck, cards, creation date and study progress belong
only to the recipient. Old installation IDs and other accounts cannot read or
modify it. Retrying an accepted code is safe during its validity period.
Recovery metadata is never returned to clients. Codes are sent in POST bodies,
not URLs, and responses are marked `no-store`.

To revoke an unaccepted approval, an operator can unset `recovery` on the
specific legacy-owned deck using the normal database administration process.
Do not change `ownerId` manually or move an already transferred deck.
