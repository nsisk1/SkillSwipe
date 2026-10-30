---
name: SkillSwipe deck ownership
description: Privacy rule for migrating SkillSwipe decks from installation scope to learner accounts.
---

Decks saved before account sign-in have no verified learner owner. Do not automatically transfer them to the first account that signs in on an installation.

**Why:** Installation identifiers are not authenticated identities, so auto-claiming could expose one learner's prior study data to another learner on a shared device.

**How to apply:** If legacy-deck recovery is added, design an explicit, privacy-reviewed ownership transfer rather than trusting a device header.
