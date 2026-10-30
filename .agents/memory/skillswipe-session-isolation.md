---
name: SkillSwipe session isolation
description: Why learner data needs a separate cache and component lifetime per authenticated session.
---

Use a fresh cache and component lifetime for each learner session; do not rely solely on clearing a shared cache in an authentication-change effect.

**Why:** Children may render or start requests before a parent's passive effect runs. On a shared installation, clearing after the account change can be too late to prevent the next learner from reading prior cached content. Late requests must settle only into a discarded session's cache.

**How to apply:** Keep session changes as synchronous render boundaries, including sign-out and a new session for the same learner. Regression checks should delay the new learner's list response and assert no prior saved-deck rows or active study content appear while it is pending.
