import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudyAnalytics } from '../hooks/useStudyAnalytics';

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  capture: vi.fn(),
  shutdown: vi.fn(() => Promise.resolve()),
}));
vi.mock('posthog-react-native', () => ({
  default: class {
    capture = sdk.capture;
    shutdown = sdk.shutdown;
    constructor(key: string, options: unknown) { sdk.create(key, options); }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', true);
  vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test_only');
  vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('study analytics safety', () => {
  it('does not initialize or capture without configuration', () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', '');
    const { result } = renderHook(() => useStudyAnalytics());
    act(() => result.current('study_opened', {}));
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it('requires an explicit HTTPS host', () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', 'http://insecure.example');
    renderHook(() => useStudyAnalytics());
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('disables replay, profiles, geolocation and automatic lifecycle capture', () => {
    renderHook(() => useStudyAnalytics());
    expect(sdk.create).toHaveBeenCalledWith('phc_test_only', expect.objectContaining({
      host: 'https://eu.i.posthog.com',
      persistence: 'memory',
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      personProfiles: 'never',
      disableGeoip: true,
      disableRemoteFeatureFlags: true,
      disableSurveys: true,
    }));
  });

  it('captures explicit metrics with environment and platform dimensions', () => {
    const { result } = renderHook(() => useStudyAnalytics());
    act(() => result.current('study_completed', {
      source: 'saved', card_count: 6, known_count: 4, revisit_count: 2,
    }));
    expect(sdk.capture).toHaveBeenCalledWith('study_completed', {
      source: 'saved', card_count: 6, known_count: 4, revisit_count: 2,
      platform: 'web', environment: 'development',
    });
  });

  it('removes free text, account details, URLs and device metadata before sending', () => {
    renderHook(() => useStudyAnalytics());
    const options = sdk.create.mock.calls[0][1];
    const filtered = options.before_send({
      event: 'card_reviewed',
      properties: {
        result: 'known', source: 'saved', distinct_id: 'anonymous-random-id',
        topic: 'private study topic', question: 'private question',
        email: 'never-send@example.com', userId: 'account-id',
        '$current_url': 'https://example.com/?private=query',
        '$device_name': 'private device name', nested: { content: 'private' },
      },
    });
    expect(filtered.properties).toEqual({
      result: 'known', source: 'saved', distinct_id: 'anonymous-random-id',
    });
    expect(options.before_send({ event: '$autocapture', properties: {} })).toBeNull();
  });

  it('never throws when SDK capture fails', () => {
    sdk.capture.mockImplementationOnce(() => { throw new Error('unavailable'); });
    const { result } = renderHook(() => useStudyAnalytics());
    expect(() => result.current('study_opened', {})).not.toThrow();
  });

  it('never blocks the app when SDK initialization fails', () => {
    sdk.create.mockImplementationOnce(() => { throw new Error('unavailable'); });
    const { result } = renderHook(() => useStudyAnalytics());
    expect(() => result.current('study_opened', {})).not.toThrow();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it('drops late callbacks after the learner workspace unmounts', () => {
    const { result, unmount } = renderHook(() => useStudyAnalytics());
    const oldTrack = result.current;
    unmount();
    oldTrack('card_reviewed', { result: 'revisit', source: 'saved' });
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.shutdown).toHaveBeenCalledWith(2000);
  });
});
