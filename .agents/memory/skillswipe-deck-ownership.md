---
name: SkillSwipe deck ownership
description: Privacy rule for migrating SkillSwipe decks from installation scope to learner accounts.
---

Decks saved before account sign-in have no verified learner owner. Do not automatically transfer them to the first account that signs in on an installation.

**Why:** Installation identifiers are not authenticated identities, so auto-claiming could expose one learner's prior study data to another learner on a shared device.

**How to apply:** Recovery must remain an explicit transfer approved for a particular authenticated account, never an installation-based claim or discovery flow.

For legacy records without an authenticated identity, ownership must be verified independently by an operator before issuing an account-bound recovery approval. If no independent evidence exists, decline recovery; do not disclose topics as identity challenges.

**Why:** Neither possession of a shared device nor knowledge of deck content establishes which learner originally created the installation-scoped history. The legacy records cannot supply identity evidence they never captured.

**How to apply:** Keep approval issuance operator-only, bind approval to the verified receiving account and specific deck, and require the learner to review and explicitly accept. Do not replace this with an “I own these decks” checkbox.
