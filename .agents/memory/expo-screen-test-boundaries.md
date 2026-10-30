---
name: Expo screen test boundaries
description: Non-obvious React Native Web and jsdom limitations when testing visible Expo interactions.
---

Do not assume React Native accessibility state appears as equivalent ARIA state
in React Native Web. Check the installed adapter before choosing assertions;
test visible selection separately from assistive-technology selection.

**Why:** React Native Web 0.21 ignores `accessibilityState.selected`, even though
the component's selection colors work. A test adapter that invents the ARIA
mapping would conceal that accessibility gap.

**How to apply:** Keep the real Web controls in screen tests; use actual visible
selection treatment until the production screen exposes web selection semantics.

For real modal tests in jsdom, provide an AnimationEvent constructor before
React DOM loads and explicitly dispatch animation completion.

**Why:** jsdom does not run CSS animations. React DOM chooses vendor event names
at import time when AnimationEvent is absent, so a normal animationend event can
silently miss its handler and leave a closing modal mounted.

**How to apply:** Treat animation completion as a browser boundary, not a timer
delay or evidence that the screen failed to close. Do not replace modal or
filter behavior with test-only implementations.
