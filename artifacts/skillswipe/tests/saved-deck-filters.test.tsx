import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FlashcardDeck, FlashcardDeckSummary } from '@workspace/api-client-react';

// Exercise the production screen and React Native Web controls, not a copy of
// the filtering logic. Only external session, network and device boundaries
// are replaced; no real account, AI request or database is used.
const api = vi.hoisted(() => ({
  decks: [] as FlashcardDeckSummary[],
  openedIds: [] as string[],
  detail: null as FlashcardDeck | null,
  refetch: vi.fn(),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'filter-test-learner' }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useListFlashcardDecks: () => ({
    data: { decks: api.decks }, isLoading: false, isError: false, refetch: api.refetch,
  }),
  useGetFlashcardDeck: (id: string, options: { query: { enabled: boolean } }) => {
    if (options.query.enabled) api.openedIds.push(id);
    return {
      data: options.query.enabled && api.detail?.id === id ? api.detail : undefined,
      isFetching: false, isError: false,
    };
  },
  useGenerateFlashcards: () => ({ isPending: false, mutate: vi.fn() }),
  useRestartFlashcardDeck: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateFlashcardProgress: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-haptics', () => ({}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('@/components/AccountAccessScreen', () => ({ default: () => null }));
vi.mock('@/components/LegacyDeckRecovery', () => ({ default: () => null }));

import StudyHome from '../app/index';
import colors from '../constants/colors';

const levels = [
  ['beginner', 'Beginner', 'easy'],
  ['intermediate', 'Intermediate', 'medium'],
  ['advanced', 'Advanced', 'hard'],
] as const;

function summary(id: string, difficulty?: FlashcardDeckSummary['difficulty']): FlashcardDeckSummary {
  return {
    id, topic: `Topic ${id}`, cardCount: 2, knownCount: 0, activeIndex: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(difficulty === undefined ? {} : { difficulty }),
  };
}

const fixtures: FlashcardDeckSummary[] = [
  summary('legacy-without-level'),
  ...levels.flatMap(([level, , alias]) => [summary(level, level), summary(alias, alias)]),
];

function filter(label: string) {
  return screen.getByRole('button', { name: `Filter saved decks: ${label}` });
}

function expectSelected(label: string) {
  // RN Web 0.21 does not translate RN's accessibilityState.selected.
  // Assert the actual visible selection treatment rather than inventing an
  // ARIA state in a mock. Compare normalized browser colors.
  const swatch = document.createElement('div');
  for (const candidate of ['All decks', ...levels.map(([, name]) => name)]) {
    swatch.style.backgroundColor = candidate === label ? colors.light.primary : colors.light.secondary;
    expect(filter(candidate).style.backgroundColor).toBe(swatch.style.backgroundColor);
  }
}

function expectRows(ids: string[]) {
  // Verify the entire rendered row set: extra nonmatching rows are failures too.
  const rows = screen.queryAllByTestId(/^saved-deck-/)
    .filter(row => !row.dataset.testid?.startsWith('saved-deck-filter-'));
  expect(rows.map(row => row.dataset.testid).sort())
    .toEqual(ids.map(id => `saved-deck-${id}`).sort());
  for (const id of ids) {
    expect(screen.getByTestId(`saved-deck-${id}`).textContent)
      .toContain(api.decks.find(deck => deck.id === id)!.topic);
  }
}

async function openSavedDecks() {
  render(<StudyHome />);
  fireEvent.click(screen.getByRole('button', { name: 'Open saved decks' }));
  await screen.findByRole('button', { name: 'Filter saved decks: All decks' });
}

beforeEach(() => {
  api.decks = fixtures.map(deck => ({ ...deck }));
  api.openedIds = [];
  api.detail = null;
  api.refetch.mockClear();
});
afterEach(cleanup);

describe('saved-deck level filters on the study screen', () => {
  it('starts on All decks and includes decks without level metadata', async () => {
    await openSavedDecks();
    expectSelected('All decks');
    expectRows(fixtures.map(deck => deck.id));
    expect(screen.queryByTestId('saved-decks-empty')).toBeNull();
  });

  it.each(levels)('shows only %s decks, including the %s label and legacy alias', async (level, label, alias) => {
    await openSavedDecks();
    fireEvent.click(filter(label));
    expectSelected(label);
    expectRows([level, alias]);
    for (const id of [level, alias]) {
      expect(screen.getByTestId(`saved-deck-${id}`).textContent).toContain(`Level: ${label}`);
    }
    fireEvent.click(filter('All decks'));
    expectSelected('All decks');
    expectRows(fixtures.map(deck => deck.id));
  });

  it('searches topics case-insensitively within the selected level and clears without changing levels', async () => {
    api.decks = [
      { ...summary('biology', 'beginner'), topic: 'Cell Biology' },
      { ...summary('chemistry', 'easy'), topic: 'Chemistry' },
      { ...summary('advanced-biology', 'advanced'), topic: 'Cell Biology' },
    ];
    await openSavedDecks();
    fireEvent.click(filter('Beginner'));
    const search = screen.getByRole('textbox', { name: 'Search saved decks by topic' });
    fireEvent.change(search, { target: { value: '  bIoLoGy  ' } });
    expectRows(['biology']);
    fireEvent.click(filter('Advanced'));
    expectRows(['advanced-biology']);
    fireEvent.click(filter('Beginner'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear topic search' }));
    expectSelected('Beginner');
    expectRows(['biology', 'chemistry']);
    expect((search as HTMLInputElement).value).toBe('');
    fireEvent.change(search, { target: { value: 'chem' } });
    expectRows(['chemistry']);
    fireEvent.change(search, { target: { value: '' } });
    expectRows(['biology', 'chemistry']);
  });

  it('explains unmatched search results separately from an empty level', async () => {
    await openSavedDecks();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved decks by topic' }), {
      target: { value: 'unmatched topic' },
    });
    expectRows([]);
    expect(screen.getByTestId('saved-decks-empty').textContent).toContain('No topics match');
    fireEvent.click(filter('Intermediate'));
    expect(screen.getByTestId('saved-decks-empty').textContent).toContain('at the Intermediate level');
    fireEvent.click(screen.getByRole('button', { name: 'Clear topic search' }));
    expectRows(['intermediate', 'medium']);
  });

  it('keeps the empty-collection message even with a search or level selected', async () => {
    api.decks = [];
    await openSavedDecks();
    fireEvent.click(filter('Beginner'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved decks by topic' }), {
      target: { value: 'biology' },
    });
    expectRows([]);
    expect(screen.getByTestId('saved-decks-empty').textContent).toBe('Your generated decks will appear here.');
  });

  it('updates the rows when switching directly between levels', async () => {
    await openSavedDecks();
    for (const [level, label, alias] of levels) {
      fireEvent.click(filter(label));
      expectSelected(label);
      expectRows([level, alias]);
    }
  });

  it.each(levels)('explains an empty %s result and restores every row with All decks', async (level, label, alias) => {
    api.decks = fixtures.filter(deck => deck.id !== level && deck.id !== alias);
    await openSavedDecks();
    fireEvent.click(filter(label));
    expectSelected(label);
    expectRows([]);
    const empty = screen.getByTestId('saved-decks-empty');
    expect(empty.textContent).toContain(`No ${label} decks yet.`);
    expect(empty.textContent).toContain('Choose All decks to see your full collection');
    fireEvent.click(filter('All decks'));
    expectSelected('All decks');
    expectRows(api.decks.map(deck => deck.id));
    expect(screen.queryByTestId('saved-decks-empty')).toBeNull();
  });

  it.each(levels.flatMap(([level, label, alias]) => [
    [level, label], [alias, label],
  ]))('opens the exact %s deck from a filtered row', async (id, label) => {
    api.detail = {
      ...fixtures.find(deck => deck.id === id)!,
      createdAt: '2026-01-01T00:00:00.000Z',
      activeIndex: 1,
      cards: [
        { id: `${id}-first`, topic: `Topic ${id}`, question: 'Already studied', answer: 'First answer', status: 'known' },
        { id: `${id}-next`, topic: `Topic ${id}`, question: `Resume question for ${id}`, answer: `Answer for ${id}`, status: 'new' },
      ],
    };
    await openSavedDecks();
    fireEvent.click(filter(label));
    fireEvent.click(screen.getByTestId(`saved-deck-${id}`));
    await waitFor(() => {
      expect(screen.getByTestId('study-topic').getAttribute('value')).toBe(`Topic ${id}`);
    });
    expect(api.openedIds.length).toBeGreaterThan(0);
    expect(new Set(api.openedIds)).toEqual(new Set([id]));
    // jsdom does not run CSS animations. Complete the real modal's fade-out
    // event explicitly, as a browser does before removing the modal content.
    let animationContainer = filter('All decks');
    while (animationContainer.parentElement?.parentElement !== document.body) {
      const parent = animationContainer.parentElement;
      if (!parent) throw new Error('Saved-deck modal is not in a body portal');
      animationContainer = parent;
    }
    fireEvent.animationEnd(animationContainer);
    expect(screen.queryByRole('button', { name: 'Filter saved decks: All decks' })).toBeNull();
    expect(screen.getByText(`Resume question for ${id}`)).toBeTruthy();
    expect(screen.getByText('Card 02')).toBeTruthy();
    expect(screen.getByTestId('known-card-count').textContent).toBe('Known: 1');
  });
});
