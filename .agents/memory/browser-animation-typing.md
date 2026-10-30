---
name: Browser animation typing
description: Diagnose misleading Framer Motion type errors before changing animation presets.
---

When browser-global errors and Framer Motion variant/transition errors occur together, check the effective TypeScript libraries before rewriting animation types.

**Why:** Missing DOM definitions caused valid nested transitions to be rejected as animation targets. Restoring browser libraries resolved both classes of errors without changing animations or weakening type checks.

**How to apply:** Keep browser libraries local to browser artifacts rather than adding them to the shared server/library configuration. Recheck after correcting the environment types before changing valid presets.
