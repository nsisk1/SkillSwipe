# Real account isolation regression

Run the API Server and SkillSwipe managed workflows, then:

```sh
pnpm --filter @workspace/api-server test:accounts
```

Requires Chromium for Playwright, development Clerk keys, and the workflow's
Replit development domain. Missing setup is a
failure, not a skipped/passing test. Production Clerk keys are rejected.

Install the matching browser with `pnpm exec playwright install chromium` from
the API package. In Nix environments Chromium's runtime libraries must also be
available through `LD_LIBRARY_PATH`; `playwright install-deps` expects an
apt-based system and is not suitable here.

The test creates two temporary Clerk users and one isolated saved deck, signs into real
Clerk sessions in isolated browser contexts, and exercises the shipped app and
API middleware. Sign-in tickets avoid depending on email delivery; they are not
mock tokens or an authentication bypass. The default fixture replaces only
storage: requests with unchanged cookies/JWTs go through `createApp` and the
actual Clerk middleware and deck router. The Expo app uses Bearer session JWTs
on web and native; cookie-only development browser auth is not assumed.
AI output is seeded to avoid generation cost
and nondeterminism. Sign-out uses the actual app button.

Checks include shared progress across installations, list/detail/update/restart
denial for the other learner, no cached content during account switching and a
delayed list response, switching back, and reload persistence.

Fixtures are deleted in `finally`. Do not enable Playwright traces, HAR, video,
or storage-state output: these can contain sign-in tickets and session tokens.
Generated outputs go under the ignored `generated-artifacts/` directory.

To exercise the running API and real MongoDB as well, with the existing MongoDB
configuration available:

```sh
ACCOUNTS_TEST_STORAGE=mongodb pnpm --filter @workspace/api-server test:accounts
```

This opt-in variant does not intercept API transport or replace storage. A
database connection failure is a test failure, never an automatic fallback to
the isolated fixture.
