import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import PostHog from 'posthog-react-native';

type Level = 'beginner' | 'intermediate' | 'advanced';
type DeckSource = 'sample' | 'saved';
type StudyEvents = {
  study_opened: Record<string, never>;
  deck_generation_started: { difficulty: Level; card_count: number };
  deck_generation_succeeded: { difficulty: Level; card_count: number };
  deck_generation_failed: { difficulty: Level };
  saved_decks_opened: Record<string, never>;
  saved_deck_opened: { card_count: number };
  answer_revealed: { source: DeckSource };
  card_reviewed: { result: 'known' | 'revisit'; source: DeckSource };
  progress_save_failed: { source: DeckSource };
  study_completed: { card_count: number; known_count: number; revisit_count: number; source: DeckSource };
  study_restarted: { source: DeckSource };
  background_changed: { background: 'default' | 'sage' | 'blue' | 'rose' | 'lavender' };
};

// Defense in depth: no arbitrary user text, account IDs, URLs, or SDK device
// properties may leave through this integration.
const propertyNames = new Set([
  'difficulty', 'card_count', 'source', 'result', 'known_count',
  'revisit_count', 'background', 'platform', 'environment',
  'distinct_id', '$session_id', '$lib', '$lib_version', '$geoip_disable',
  '$process_person_profile',
]);
const eventNames = new Set<keyof StudyEvents>([
  'study_opened', 'deck_generation_started', 'deck_generation_succeeded',
  'deck_generation_failed', 'saved_decks_opened', 'saved_deck_opened',
  'answer_revealed', 'card_reviewed', 'progress_save_failed',
  'study_completed', 'study_restarted', 'background_changed',
]);

export function useStudyAnalytics() {
  const client = useRef<PostHog | null>(null);

  useEffect(() => {
    const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;
    if (!key || !host) return;
    // HTTPS only; never silently send a project's events to a different region.
    try {
      if (new URL(host).protocol !== 'https:') return;
      const instance = new PostHog(key, {
        host,
        persistence: 'memory',
        captureAppLifecycleEvents: false,
        enableSessionReplay: false,
        preloadFeatureFlags: false,
        disableRemoteFeatureFlags: true,
        disableSurveys: true,
        personProfiles: 'never',
        disableGeoip: true,
        flushAt: 10,
        flushInterval: 10000,
        maxQueueSize: 100,
        fetchRetryCount: 1,
        requestTimeout: 5000,
        before_send: event => {
          if (!event || !eventNames.has(event.event as keyof StudyEvents)) return null;
          event.properties = Object.fromEntries(
            Object.entries(event.properties ?? {}).filter(
              ([name, value]) =>
                propertyNames.has(name) &&
                ['string', 'number', 'boolean'].includes(typeof value),
            ),
          );
          return event;
        },
      });
      client.current = instance;
      return () => {
        // Late callbacks from a discarded learner session cannot track events.
        client.current = null;
        try {
          void instance.shutdown(2000).catch(() => undefined);
        } catch {
          // Telemetry is best-effort and must not affect studying or sign-out.
        }
      };
    } catch {
      // Missing/invalid configuration and SDK failures must not block the app.
    }
  }, []);

  return useCallback(<E extends keyof StudyEvents>(name: E, properties: StudyEvents[E]) => {
    try {
      client.current?.capture(name, {
        ...properties,
        platform: Platform.OS,
        environment: __DEV__ ? 'development' : 'production',
      });
    } catch {
      // Analytics failures never change the result of a learner's action.
    }
  }, []);
}
