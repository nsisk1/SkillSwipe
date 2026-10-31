# Account-switch privacy release check

`.github/workflows/account-isolation.yml` runs `test:accounts` in its own job on
pushes, pull requests and manual dispatch, independently of the saved-deck API
checks. It exports the **shipped Expo web app**, serves it over loopback HTTPS,
starts a disposable loopback-only MongoDB, and forwards browser API requests
with their real Clerk JWTs to `createApp`, the real Clerk middleware and deck
router. No test identity header or authentication bypass is used.

## CI setup (one time)

Create a **dedicated Clerk development instance** for CI, with email sign-in
enabled. Add the matching keys as repository Actions secrets:

- `ACCOUNTS_TEST_CLERK_SECRET_KEY` (`sk_test_…`)
- `ACCOUNTS_TEST_CLERK_PUBLISHABLE_KEY` (`pk_test_…`)

Do not reuse production keys, app database credentials or paid AI credentials.
The job creates two synthetic users per run with unique `+clerk_test` email
addresses and signs in using short-lived Clerk tickets (no email delivery).
Users and decks are removed in `finally`; the database container is always
removed. Use only this dedicated instance: terminating a runner abruptly can
prevent remote user cleanup.

Missing secrets, live keys, remote database URLs, an unavailable database,
or sign-in failure **fail** the check; they never silently skip it.
Fork PRs do not receive Actions secrets, so their job fails at configuration
validation. Review the contribution and run it on a trusted repository branch;
never switch this workflow to `pull_request_target` to expose secrets to PR code.
Configure `Browser account isolation` as a required branch-protection check if
merges must be blocked on this test.

## What is checked

- The authenticated generation route saves deterministic stubbed cards to MongoDB.
  The fixture always injects the generator; CI supplies only a dummy AI key and
  an unreachable loopback endpoint as an additional safety boundary.
- Two independent installations of the owner account share persisted progress.
- The shipped sign-out button removes active private study content and access.
- Switching accounts without reload cannot display the old saved rows or active
  study content, **while the new learner's list request is held pending**.
- The other account cannot list, read, update or restart the owner's deck;
  denied writes leave its progress unchanged.
- Switching back and reloading restores the owner's saved progress.

Revoked-session behavior and connection-error messaging are separate checks,
not covered or changed here.

## Study mutation error checks

`study-errors.e2e.ts` is a separate, focused set of shipped-screen checks, also
discovered by `test:accounts` and the existing browser CI job. It always uses
`AccountTestStore` in memory, even when the account-isolation test uses MongoDB.
It never connects to an app database or calls a paid generator.

- A controlled HTTP 503 on the first progress save displays the existing retry
  message, keeps the same card, position and totals, and leaves storage unchanged.
  Retrying sends the same card update, succeeds against the fixture API, clears
  the message and advances exactly one card.
- A controlled HTTP 503 on restart displays the existing reset error and keeps
  the nonzero study position, totals and saved progress unchanged.

These checks use one temporary development Clerk user per test and remove it in
cleanup. They do not switch accounts or revoke sessions. Run just these checks:

```sh
pnpm --filter @workspace/api-server test:accounts study-errors.e2e.ts
```

## Recovery request form checks

`recovery-requests.e2e.ts` runs in the same browser release job via
`test:accounts`, separately from the account-switch tests. It exercises the
shipped recovery modal with real development Clerk sign-in, the real API route
and an isolated in-memory private inbox. It checks invalid email without a POST,
cancellation, returning to approved-code entry (without looking up a deck),
the private non-approval receipt, duplicate submissions retaining the original
reference/contact, and a controlled inbox outage followed by an explicit retry.

Every test creates and removes one temporary Clerk user; request fixtures are
discarded on teardown. All API origins are intercepted, and only saved-list
reads and request submissions may reach the isolated API fixture. No app
database, legacy deck lookup/transfer, paid model, account switch or session
revocation is involved. Missing keys or failed cleanup fail the test.

```sh
pnpm --filter @workspace/api-server test:accounts recovery-requests.e2e.ts
```

Recovery failures use the same credential-stripped trace pipeline below; raw
traces must never be uploaded.

## Failure artifacts

On failure, CI uploads `account-isolation-failure-<run>-<attempt>` for seven days.
These are Playwright action/screenshot traces viewable with
`pnpm exec playwright show-trace <file.zip>` from the API package. Only synthetic
test content is displayed. Network requests, headers, cookies, evaluation
arguments/results, DOM snapshots, source files, console messages and raw errors
are removed by an allowlist sanitizer before upload. This intentionally limits
the trace to action order/timing, generic action failures and screenshots.

Raw traces stay under `/tmp/skillswipe-account-traces`, are **never uploaded**,
and are deleted after sanitizing. Do not upload raw traces, HARs or storage state,
or widen the upload path to the full test-output directory. Generated outputs
are under the ignored `generated-artifacts/` directory.

## Development

Start the SkillSwipe managed workflow with development Clerk keys, then run:

```sh
pnpm --filter @workspace/api-server test:accounts
```

`REPLIT_DEV_DOMAIN` targets the running workspace by default; alternatively set
`ACCOUNTS_TEST_APP_URL` to an app using the same development Clerk instance.
The default local store is in-memory. To check real persistence, provision a
**separate disposable local MongoDB** and explicitly set:

```sh
ACCOUNTS_TEST_STORAGE=mongodb \
SKILLSWIPE_TEST_MONGODB_URI=mongodb://127.0.0.1:27018/skillswipe_test \
SKILLSWIPE_TEST_MONGODB_DATABASE=skillswipe_test \
pnpm --filter @workspace/api-server test:accounts
```

Application `MONGODB_URI` is never used. Remote hosts, credentials, URI options,
and database names other than `skillswipe_test` are rejected. Both local modes
use the real auth middleware and the deterministic generation fixture.

Install the matching browser with `pnpm exec playwright install chromium` from
the API package. In Nix environments Chromium runtime libraries must be
available through `LD_LIBRARY_PATH`; `playwright install-deps` expects apt.
CI uses `playwright install --with-deps chromium` on Ubuntu instead.
For a Nix-provided wrapped browser, set
`ACCOUNTS_TEST_CHROMIUM_EXECUTABLE=/repl/tools/bin/chromium` rather than mixing
libraries from different Nix/glibc versions with a downloaded Chromium.
