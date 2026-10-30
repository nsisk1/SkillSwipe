# Saved-deck filter regression checks

Run from the repository root:

```sh
pnpm --filter @workspace/skillswipe run test:saved-deck-filters
```

The same command runs in the **Saved-deck level filter UI** job in
`.github/workflows/saved-decks.yml` for pushes, pull requests, and manual runs.
It needs no environment secrets, server, database, or Clerk account.

The suite mounts the real `app/index.tsx` screen using React Native Web and
clicks its production controls. Session, generated API hooks, storage, device
APIs, and unrelated account/recovery screens are isolated test boundaries.
Fixtures cover every learner level, every easy/medium/hard alias, and a legacy
deck with omitted difficulty. Checks cover:

- Default All decks selection and the complete row set.
- Each level's exact row set, labels, and visible selection.
- Direct transitions between levels and restoration via All decks.
- Each level's empty-state guidance and return to the full collection.
- Opening all six level/alias rows by their actual IDs and resuming their
  distinct topic, card, and progress.

These are deterministic screen-interaction tests, not native-device or
real-auth end-to-end tests. jsdom does not perform layout or CSS animations;
the opening checks explicitly dispatch the modal's fade-out completion.
Selection assertions use visible background colors because React Native Web
0.21 does not map `accessibilityState.selected` to `aria-selected`.
