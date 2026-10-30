# Legacy deck recovery

Legacy decks have an installation owner (`sw-…`), not a verified learner.
Signing in, possessing the device, knowing the installation ID or deck ID,
or checking an “I own this” box is **not** sufficient ownership evidence.
There is deliberately no installation-based discovery or self-claim endpoint.

## Private verification requests

Learners open **Saved decks → Recover older decks → Request ownership
verification**, enter a reply email, and choose **Send private request**.
The app explains that independent evidence is required and recovery may be
declined. It does not collect evidence, device IDs, deck IDs, or topics.

The private support channel is the `skillswipe_recovery_requests` inbox in the
existing MongoDB database, configured by the server's `MONGODB_URI` and optional
`MONGODB_DATABASE`. No external mail provider is required: this is a private
operator inbox, **not an automatic email delivery service**. Operators must
monitor it regularly and send replies from their private support email.
Ensure the database account can read/write this collection and create its
unique indexes. Restrict database and terminal access to authorized operators.
When the inbox is unavailable, the app reports an unconfirmed submission,
never a successful delivery.

`POST /api/flashcards/recovery/requests` requires an authenticated Clerk
session. The server derives the receiving account ID from that session, not
from submitted identity fields. The body accepts only `replyEmail`.
It saves a reference, account ID, reply email, timestamp and pending status,
and returns only the reference and saved reply email with `Cache-Control:
no-store`. An atomic unique index permits one pending request per account,
including concurrent retries. Retrying does not overwrite the original reply
email. No learner-facing endpoint lists or reads the private inbox.

From `artifacts/api-server`, in the intended environment:

```sh
pnpm exec tsx src/scripts/legacy-recovery-inbox.ts list
```

This prints pending requests oldest first, including the authenticated account
ID and reply email. Run it only in a private terminal; do not pipe output into
shared logs, tickets, source control or chat. Request bodies and database error
details are intentionally not logged by the submission route.

1. Reply privately to the contact email, quoting the reference. **The reply
   email is unverified correspondence information, not identity or ownership
   proof.** Signing in establishes only the receiving account.
2. Ask whether there is pre-existing independent evidence linking the original
   learner to specific decks (for example, a verified support record). Agree on
   a private evidence channel before collecting anything sensitive. Never ask
   for passwords, session tokens or recovery codes. Never look up an
   installation's decks to reveal their topics or use deck content as a quiz.
3. Independently validate the evidence and receiving account. If ownership
   cannot be established, explain privately that recovery is declined. A
   request is not an approval and must not trigger the approval script.
4. Only after verification, follow **Operator approval** below and deliver
   codes privately to the independently verified learner, not automatically
   to the submitted email.
5. After replying with the outcome, close the request:

   ```sh
   pnpm exec tsx src/scripts/legacy-recovery-inbox.ts close REQUEST_UUID
   ```

   Closing records a closed timestamp only. It grants no recovery approval
   and changes no deck ownership; the account may then submit a new request.
   Closed requests remain private in the database and should be removed under
   the operator's support-data retention policy. Do not store evidence or
   identity documents in this inbox.

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
   read -r -s -p 'Operator session JWT: ' OPERATOR_SESSION; printf '\n'
   printf '%s' "$OPERATOR_SESSION" | pnpm exec tsx src/scripts/approve-legacy-recovery.ts \
     DECK_UUID sw-LEGACY-INSTALLATION-ID user_VERIFIED_ACCOUNT --ownership-verified
   unset OPERATOR_SESSION
   ```

   Use a fresh session JWT from your own signed-in operator account in the
   correct environment. Input is hidden; never put the token in command-line
   arguments, source, chat, tickets, shared logs, or persistent files. Do not
   run with shell tracing (`set -x`) or terminal recording enabled. Stdin is
   used only for this private authentication step and is never persisted.
   The command verifies the JWT, checks the session is still active, and
   fetches the operator's current server-managed Clerk private metadata.
   An authorized administrator must provision
   `privateMetadata.legacyRecoveryOperator = true` in the correct Clerk
   environment before use. Learner-editable metadata never grants this role.
   No operator is automatically seeded or assigned by this script.

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

To revoke an unaccepted approval, authenticate the same way and use:

```sh
read -r -s -p 'Operator session JWT: ' OPERATOR_SESSION; printf '\n'
printf '%s' "$OPERATOR_SESSION" | pnpm exec tsx src/scripts/revoke-legacy-recovery.ts DECK_UUID
unset OPERATOR_SESSION
```

Do not unset `recovery` or change `ownerId` manually: that bypasses the audit.
Revocation cannot move an already transferred deck. Reissuing an approval
atomically records revocation of the previous grant followed by the new approval.

## Durable audit and failure policy

`skillswipe_recovery_audit` is a separate collection in the same database.
Every approval, replacement/explicit revocation, and first accepted transfer
records a random event ID, a non-secret grant ID, deck ID, authenticated operator
Clerk ID, receiving account ID, acting account ID, event type, UTC timestamp,
and expiry. On transfer the operator is the original approving operator and the
actor is the authenticated receiving learner. Retried acceptance produces no
duplicate transfer event. Audit entries survive deck deletion and code expiry.
No plaintext codes, code hashes, credentials, deck contents, emails, or raw
ownership evidence are recorded. There is no evidence/free-text field.

**Retention:** events expire 365 days after creation through a MongoDB TTL
index on `expiresAt`. TTL deletion is asynchronous, not an exact-second
guarantee. Apply the same 365-day maximum to exports and backup retention;
after restoring a backup, allow TTL cleanup before operator access. Do not
export these records into indefinite application logs.

**Operator-only access:** there is no learner-facing audit read/write endpoint;
deck responses continue to exclude all recovery metadata. Limit human reads
to authorized support/security operators with separately provisioned read-only
database access to this collection. Search by `deckId` or `grantId` in a private
database administration session. Restrict terminal/database administration access.
The application database principal needs insert and createIndex privileges for
the audit collection, but not find/update/remove; TTL deletion is performed by
MongoDB. Provision narrower collection-specific roles rather than sharing an
administrator credential with learners. The privileged database administrator
can bypass application controls; protect and monitor those credentials.

**Atomicity:** MongoDB must support multi-document transactions (a replica set
or transaction-capable sharded deployment). Audit insert and deck mutation
commit together with majority write concern. Index setup, audit insert, database,
or transaction failure rejects the action; there is no unaudited fallback.
Failed transfer leaves ownership unchanged unless the commit succeeded but its
acknowledgement was lost. In that uncertain case the committed audit exists:
retry the same account-bound code safely. An approval whose outcome is uncertain
displays no code; retry issuance to replace it. Revocation is safe to retry.
Never interpret a connection error as proof that a transaction did not commit.

Approvals issued before auditing have no authenticated approving operator.
Unaccepted old grants must be independently verified and reissued with the
authenticated command before transfer; do not invent an operator identity.
Their replacement/revocation is recorded with a `pre-audit` grant marker.
Previously completed transfers remain accessible only to their existing owner;
no history is fabricated retroactively. Account binding, expiry, secret proof,
legacy owner matching, and explicit learner acceptance are unchanged.
