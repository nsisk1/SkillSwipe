# SkillSwipe analytics

SkillSwipe sends explicit events to PostHog when configured. It does not use
Replit's website-only analytics tracker. The promo video is not instrumented.

## Configuration

Set these build-time variables in the workspace and publishing environment:

- `EXPO_PUBLIC_POSTHOG_KEY`: the **project token** from PostHog Project Settings,
  not a personal API key. This ingestion token is intentionally bundled in the app.
- `EXPO_PUBLIC_POSTHOG_HOST`: your project's ingestion host, normally
  `https://us.i.posthog.com` or `https://eu.i.posthog.com`.

Missing configuration disables tracking, not the app. Rebuild/republish the web
app and rebuild the native app after changing these values. In development,
restart Metro after changes. In PostHog's live events view, filter by
`environment = development` for a smoke check, then use `production` in reports.

## Events

| Event | When | Dimensions |
| --- | --- | --- |
| `study_opened` | Learner's workspace mounts | — |
| `deck_generation_started` | Valid request submitted | difficulty, card_count |
| `deck_generation_succeeded` | Generated deck successfully returned/saved | difficulty, card_count |
| `deck_generation_failed` | Generation request fails | difficulty |
| `saved_decks_opened` | Saved-decks panel opened | — |
| `saved_deck_opened` | Saved deck successfully loaded | card_count |
| `answer_revealed` | Question changed to answer | source |
| `card_reviewed` | Decision successfully applied (and saved for saved decks) | result: known/revisit, source |
| `progress_save_failed` | Study progress update fails | source |
| `study_completed` | Final card decision successfully applied | card_count, known_count, revisit_count, source |
| `study_restarted` | Deck successfully reset for another pass | source |
| `background_changed` | User selects a background | background |

Every event includes `platform` and `environment`. `source` is `sample` or `saved`.
Opening a previously completed deck does not create another completion event.
Retries and repeated reveals are actions, not unique-user counts.

## Privacy and reliability

- No identification calls, names, emails, account IDs, deck IDs, topics,
  questions, answers, search queries, raw errors or URLs are sent.
- No provider/autocapture, session replay, person profiles, surveys, feature flags
  or GeoIP enrichment. A send-time allowlist removes unexpected SDK metadata.
- A fresh, in-memory anonymous SDK instance belongs to each mounted learner
  workspace. Nothing is persisted to identify learners across launches/devices.
  Analytics therefore measures anonymous usage, not registered-user retention.
- Memory queues are bounded. Network errors do not affect study actions.
  Unmount attempts a bounded flush; delivery is best-effort, not guaranteed.
- The analytics service necessarily receives network requests; this is not a
  claim that no network metadata reaches PostHog.
- Update the app's privacy disclosure before release. No consent UI is added;
  assess applicable consent requirements before enabling production tracking.

## Verification

Run `pnpm --filter @workspace/skillswipe run test:analytics` and `typecheck`.
After configuration, create a deck, reveal an answer, mark cards known/revisit,
and finish the deck. Confirm the events in PostHog's live events view. Never use
real private card text as test data.
