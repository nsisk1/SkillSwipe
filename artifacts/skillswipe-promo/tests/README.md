# Playback regression checks

Run from the workspace root:

```sh
pnpm --filter @workspace/skillswipe-promo run test:playback
```

The command type-checks the tests and runs Vitest in jsdom, without starting
Vite, Expo, the API, a database, or using credentials. The dedicated
`promo-playback.yml` GitHub Actions job runs the same command.

The checks cover two separate control paths: the `App` → `VideoWithControls`
→ `useSceneControls` path currently mounted in the promo, and the reusable
player actions, bridge, React wrapper, and workspace message handler named
in the playback contract. The active-app checks replace only VideoTemplate
with a lightweight scene substitute, preserving the real control buttons,
hook, timer, animation effects, and listener cleanup.

A genuine jsdom iframe selects preview mode; top-level rendering separately
checks the export bypass. The unavailable Web Animations browser API uses
animation objects whose pause/play calls can be observed. No recording,
network access, real-time waits, or real scene assets are needed.
Active-app timer checks use fake clocks.

Coverage includes invalid and boundary scene indexes, missing playback,
same-scene replay, scene selection messages, lock transition versus no-op
behavior, active-scene restarts, pause context, animation ownership across
pause cycles and unmount, scene remount keys, and message/store cleanup
including remounting the wrapper. These are control-contract checks, not
visual animation or video-export checks.
