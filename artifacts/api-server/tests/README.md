# Saved-deck release checks

GitHub Actions runs **Saved-deck release checks / API routes and MongoDB lifecycle**
on every push and pull request, and supports manual runs. Each job provisions a
fresh MongoDB 8.0 service with no persistent volume; GitHub removes it after the
job. No production database secrets are supplied or needed.

The job runs `pnpm --filter @workspace/api-server run test:ci`, which runs all
top-level API tests, including the route tests and real MongoDB lifecycle test.
Missing database settings, an unavailable database, or any failing test fails the
job. Unlike `test`, `test:ci` cannot silently skip MongoDB.
The CI runner supplies a dummy AI key and a non-serving loopback endpoint;
the route tests stub AI responses and do not need paid service credentials.

To run the same check outside CI, start a **disposable local MongoDB** instance
and set:

```sh
SKILLSWIPE_TEST_MONGODB_URI=mongodb://127.0.0.1:27018/skillswipe_test \
SKILLSWIPE_TEST_MONGODB_DATABASE=skillswipe_test \
pnpm --filter @workspace/api-server run test:ci
```

Tests only accept a loopback MongoDB address, no URI options or credentials,
and the exact database name `skillswipe_test`. They never fall back to
`MONGODB_URI`. Never forward a production server to this local port.
The lifecycle test deletes only its own randomly owned records in cleanup.

`pnpm --filter @workspace/api-server test` still permits a local run without
MongoDB, visibly skipping the lifecycle check. `test:mongodb` runs just that
lifecycle test when both test settings are provided.

To enforce this check before merging, make the named GitHub check required in
the repository's branch rules. The workflow itself runs automatically but
cannot change repository branch protection settings.
