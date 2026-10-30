---
name: Disposable database checks
description: Why persistence checks must use a separately provisioned local service instead of app database credentials.
---

Persistence release checks must use a separately provisioned disposable MongoDB
service, never the application's database credentials or a remote cluster merely
renamed to a test database.

**Why:** A database name guards against some mistakes but does not prove that the
server is disposable. Production credentials must not be necessary to run
persistence checks, especially on pull requests.

**How to apply:** Keep test configuration explicit and fail closed when required
settings are absent. Preserve the local-only boundary when extending the checks;
do not allow remote app connection strings as a convenience fallback.
