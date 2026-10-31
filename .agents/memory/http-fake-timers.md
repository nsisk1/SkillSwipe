---
name: HTTP fake timer boundaries
description: Why sequential HTTP timeout tests should share one fake-clock lifetime.
---

Keep one fake-clock lifetime across related HTTP timeout scenarios that reuse
Node's fetch transport; use nested cases rather than replacing the clock between
requests.

**Why:** Node 24's undici transport can retain timer handles between requests.
Replacing the Node test-runner fake clock between requests produced a false
deadline failure that passed in isolation. A retained handle can still carry a
queue position when the old clock is reset, interfering with a new clock's
timers when cleared.

**How to apply:** Enable mocked timers on the parent test and advance that clock
from transport stubs in sequential child cases. Keep transport mocks scoped to
each child, and check assertions outside SDK-caught transport errors too.
