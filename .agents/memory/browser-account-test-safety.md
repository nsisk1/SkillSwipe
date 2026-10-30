---
name: Browser account test safety
description: Why CI account traces need strict credential removal and local browsers need a coherent runtime.
---

Account-isolation failure traces must contain only synthetic learner content,
action metadata and screenshots, not raw authentication diagnostics.

**Why:** Real Clerk ticket sign-in places credentials in browser evaluation
arguments as well as network traffic. Disabling DOM snapshots or hiding HTTP
headers alone does not make a raw Playwright trace safe to upload.

**How to apply:** Keep raw traces ephemeral and outside artifact upload paths.
Prefer an allowlist of safe event fields over token-pattern redaction. Check
that screenshot references survive Playwright version changes; a valid ZIP alone
does not prove a useful trace.

For local Nix checks, prefer a system-wrapped Chromium when a downloaded browser
cannot load its runtime libraries.

**Why:** Mixing libraries from multiple Nix versions can resolve missing shared
libraries but introduce incompatible glibc symbols instead. Ubuntu CI and local
Nix do not need the same browser-runtime installation procedure.

**How to apply:** Keep CI on Playwright's matching browser with Ubuntu runtime
dependencies. Use the explicit local browser override rather than assembling a
library path from unrelated Nix store versions.
