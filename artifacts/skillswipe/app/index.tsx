import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useGenerateFlashcards,
  useGetFlashcardDeck,
  useListFlashcardDecks,
  useRestartFlashcardDeck,
  useUpdateFlashcardProgress,
} from '@workspace/api-client-react';
import type { FlashcardDeck } from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type StudyCard = FlashcardDeck['cards'][number];

type Decision = 'know' | 'again';
type Difficulty = 'easy' | 'medium' | 'hard';

const CARD_COUNT_OPTIONS = [3, 6, 10] as const;
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const BIOLOGY_CARDS: StudyCard[] = [
  {
    id: 'cell',
    topic: 'Cell biology',
    question: 'What is the powerhouse of the cell?',
    answer:
      'The mitochondrion. It converts energy from food into ATP, the form of energy cells can use.',
    status: 'new',
  },
  {
    id: 'membrane',
    topic: 'Cell biology',
    question: 'What does a cell membrane do?',
    answer:
      'It separates the inside of the cell from its surroundings and controls what enters and leaves.',
    status: 'new',
  },
  {
    id: 'dna',
    topic: 'Genetics',
    question: 'What is DNA’s primary role?',
    answer:
      'DNA stores the genetic instructions cells use to build proteins and pass traits to new cells.',
    status: 'new',
  },
  {
    id: 'photosynthesis',
    topic: 'Plant science',
    question: 'What do plants take in during photosynthesis?',
    answer:
      'Plants use light energy, water, and carbon dioxide to make glucose and release oxygen.',
    status: 'new',
  },
  {
    id: 'enzyme',
    topic: 'Chemistry of life',
    question: 'How do enzymes speed up reactions?',
    answer:
      'They lower the activation energy needed for a reaction, without being used up themselves.',
    status: 'new',
  },
  {
    id: 'homeostasis',
    topic: 'Human biology',
    question: 'What does homeostasis keep stable?',
    answer:
      'Important internal conditions, such as temperature and fluid balance, despite changes outside the body.',
    status: 'new',
  },
];

export default function StudyHome() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [cards, setCards] = useState<StudyCard[]>(BIOLOGY_CARDS);
  const [topic, setTopic] = useState('Biology basics');
  const [cardCount, setCardCount] = useState<number>(6);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [showSavedDecks, setShowSavedDecks] = useState(false);
  const requestOptions = deviceId
    ? { headers: { 'x-skillswipe-device-id': deviceId } }
    : undefined;
  const decksQuery = useListFlashcardDecks({
    query: { enabled: Boolean(deviceId) },
    request: requestOptions,
  });
  const selectedDeckQuery = useGetFlashcardDeck(selectedDeckId ?? '', {
    query: { enabled: Boolean(deviceId && selectedDeckId) },
    request: requestOptions,
  });
  const generateMutation = useGenerateFlashcards({ request: requestOptions });
  const progressMutation = useUpdateFlashcardProgress({ request: requestOptions });
  const restartMutation = useRestartFlashcardDeck({ request: requestOptions });
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  const card = cards[activeIndex];
  const isComplete = activeIndex >= cards.length;
  const knownCount = cards.filter(studyCard => studyCard.status === 'known').length;
  const progress = cards.length > 0 ? Math.min(activeIndex / cards.length, 1) : 0;
  const rotate = translateX.interpolate({
    inputRange: [-260, 0, 260],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });
  const cardHeight = Math.min(height * 0.405, 350);

  useEffect(() => {
    let mounted = true;
    const loadDeviceId = async () => {
      try {
        const storedId = await AsyncStorage.getItem('skillswipe-device-id');
        if (!mounted) return;
        if (storedId) {
          setDeviceId(storedId);
          return;
        }

        const newId = `sw-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 14)}`;
        await AsyncStorage.setItem('skillswipe-device-id', newId);
        if (mounted) setDeviceId(newId);
      } catch {
        if (mounted) {
          setDeviceError('Saved decks need local storage. Restart the app and try again.');
        }
      }
    };
    void loadDeviceId();
    return () => {
      mounted = false;
    };
  }, []);

  const applyDeck = useCallback((deck: FlashcardDeck) => {
    setCards(deck.cards);
    setTopic(deck.topic);
    setCardCount(deck.cards.length);
    if (deck.difficulty) setDifficulty(deck.difficulty);
    setActiveIndex(deck.activeIndex);
    setActiveDeckId(deck.id);
    setSelectedDeckId(null);
    setIsRevealed(false);
    setGenerationError(null);
    setProgressError(null);
    translateX.setValue(0);
  }, [translateX]);

  useEffect(() => {
    const deck = selectedDeckQuery.data;
    if (deck && deck.id === selectedDeckId) applyDeck(deck);
  }, [applyDeck, selectedDeckId, selectedDeckQuery.data]);

  useEffect(() => {
    if (selectedDeckId && selectedDeckQuery.isError) {
      setProgressError('Couldn’t open that saved deck. Please try again.');
      setSelectedDeckId(null);
    }
  }, [selectedDeckId, selectedDeckQuery.isError]);

  const advanceCard = useCallback(
    (decision: Decision) => {
      if (!card || isAnimating.current) return;
      isAnimating.current = true;
      const direction = decision === 'know' ? 1 : -1;

      Animated.timing(translateX, {
        toValue: direction * Math.max(width, 420),
        duration: 190,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          isAnimating.current = false;
        } else {
          const saveAndAdvance = async () => {
            try {
              if (activeDeckId) {
                if (!deviceId) throw new Error('The device ID is unavailable.');
                const updatedDeck = await progressMutation.mutateAsync({
                  deckId: activeDeckId,
                  data: {
                    cardId: card.id,
                    status: decision === 'know' ? 'known' : 'again',
                    activeIndex: activeIndex + 1,
                  },
                });
                setCards(updatedDeck.cards);
                setActiveIndex(updatedDeck.activeIndex);
              } else {
                setCards(previous =>
                  previous.map(studyCard =>
                    studyCard.id === card.id
                      ? {
                          ...studyCard,
                          status: decision === 'know' ? 'known' : 'again',
                        }
                      : studyCard,
                  ),
                );
                setActiveIndex(index => index + 1);
              }
              setIsRevealed(false);
              setProgressError(null);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => undefined,
              );
            } catch {
              setProgressError('Couldn’t save progress. Your card is ready to try again.');
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
              }).start();
            } finally {
              translateX.setValue(0);
              isAnimating.current = false;
            }
          };
          void saveAndAdvance();
        }
      });
    },
    [
      activeDeckId,
      activeIndex,
      card,
      deviceId,
      progressMutation,
      translateX,
      width,
    ],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onPanResponderMove: (_, gesture) => {
          if (!isAnimating.current) translateX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 90) {
            advanceCard('know');
          } else if (gesture.dx < -90) {
            advanceCard('again');
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              speed: 22,
              bounciness: 7,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [advanceCard, translateX],
  );

  const restartDeck = async () => {
    if (isAnimating.current) return;
    setProgressError(null);
    if (activeDeckId) {
      try {
        const restartedDeck = await restartMutation.mutateAsync({
          deckId: activeDeckId,
        });
        applyDeck(restartedDeck);
        void decksQuery.refetch();
      } catch {
        setProgressError('Couldn’t reset progress. Please try again.');
      }
      return;
    }
    setActiveIndex(0);
    setIsRevealed(false);
    setCards(previous =>
      previous.map(studyCard => ({ ...studyCard, status: 'new' })),
    );
    translateX.setValue(0);
  };

  const generateDeck = () => {
    if (!deviceId) {
      setGenerationError('Preparing saved decks. Please try again in a moment.');
      return;
    }
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length < 2) {
      setGenerationError('Enter a topic with at least 2 characters.');
      return;
    }

    setGenerationError(null);
    generateMutation.mutate(
      { data: { topic: trimmedTopic, cardCount, difficulty } },
      {
        onSuccess: result => {
          applyDeck(result);
          void decksQuery.refetch();
        },
        onError: () => {
          setGenerationError('Couldn’t create that deck. Please try again.');
        },
      },
    );
  };

  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: topPadding + 12,
          paddingBottom: bottomPadding + 12,
        },
      ]}
    >
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Ionicons
              name="albums"
              size={18}
              color={colors.primaryForeground}
            />
          </View>
          <Text style={[styles.brandName, { color: colors.foreground }]}>
            skillswipe
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open saved decks"
            testID="open-saved-decks"
            onPress={() => {
              setShowSavedDecks(true);
              void decksQuery.refetch();
            }}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="library-outline" size={19} color={colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restart this deck"
            testID="restart-deck"
            disabled={restartMutation.isPending}
            onPress={restartDeck}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="refresh" size={19} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      <View style={styles.intro}>
        <View style={styles.kickerRow}>
          <View style={[styles.kickerDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>
            YOUR QUICK STUDY SESSION
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Make learning stick.
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Try the sample deck or create one for any topic.
        </Text>
      </View>

      <View style={styles.generator}>
        <View
          style={[
            styles.topicInputWrap,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={18}
            color={colors.mutedForeground}
          />
          <TextInput
            accessibilityLabel="Study topic"
            testID="study-topic"
            value={topic}
            onChangeText={value => {
              setTopic(value);
              setGenerationError(null);
            }}
            onSubmitEditing={generateDeck}
            returnKeyType="go"
            editable={!generateMutation.isPending}
            maxLength={120}
            placeholder="What do you want to learn?"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.topicInput, { color: colors.foreground }]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Generate ${cardCount} ${difficulty} flashcards`}
          testID="generate-deck"
          disabled={generateMutation.isPending}
          onPress={generateDeck}
          style={({ pressed }) => [
            styles.generateButton,
            {
              backgroundColor: colors.accent,
              opacity: generateMutation.isPending ? 0.72 : pressed ? 0.82 : 1,
            },
          ]}
        >
          {generateMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.accentForeground} />
          ) : (
            <Ionicons
              name="sparkles"
              size={17}
              color={colors.accentForeground}
            />
          )}
          <Text
            style={[
              styles.generateButtonText,
              { color: colors.accentForeground },
            ]}
          >
            {generateMutation.isPending ? 'Creating' : 'Generate'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.generationOptions}>
        <View style={styles.generationOptionRow}>
          <Text style={[styles.generationOptionLabel, { color: colors.mutedForeground }]}>
            CARDS
          </Text>
          <View style={styles.generationOptionChoices}>
            {CARD_COUNT_OPTIONS.map(option => {
              const selected = cardCount === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: generateMutation.isPending }}
                  accessibilityLabel={`${option} flashcards`}
                  testID={`card-count-${option}`}
                  disabled={generateMutation.isPending}
                  onPress={() => setCardCount(option)}
                  style={({ pressed }) => [
                    styles.generationChoice,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.generationChoiceText,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.generationOptionRow}>
          <Text style={[styles.generationOptionLabel, { color: colors.mutedForeground }]}>
            LEVEL
          </Text>
          <View style={styles.generationOptionChoices}>
            {DIFFICULTY_OPTIONS.map(option => {
              const selected = difficulty === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: generateMutation.isPending }}
                  accessibilityLabel={`${option.label} difficulty`}
                  testID={`difficulty-${option.value}`}
                  disabled={generateMutation.isPending}
                  onPress={() => setDifficulty(option.value)}
                  style={({ pressed }) => [
                    styles.generationChoice,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.generationChoiceText,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      {generationError ? (
        <Text
          accessibilityRole="alert"
          testID="generation-error"
          style={[styles.generationError, { color: colors.destructive }]}
        >
          {generationError}
        </Text>
      ) : null}
      {deviceError || progressError ? (
        <Text
          accessibilityRole="alert"
          testID="progress-error"
          style={[styles.generationError, { color: colors.destructive }]}
        >
          {deviceError ?? progressError}
        </Text>
      ) : null}
      {selectedDeckId && selectedDeckQuery.isFetching ? (
        <View style={styles.openingDeck}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.openingDeckText, { color: colors.mutedForeground }]}>
            Opening saved deck…
          </Text>
        </View>
      ) : null}

      <View style={styles.progressSection}>
        <View style={styles.progressLabels}>
          <Text style={[styles.progressTitle, { color: colors.foreground }]}>
            {isComplete
              ? 'Session complete'
              : `Card ${String(activeIndex + 1).padStart(2, '0')}`}
          </Text>
          <Text style={[styles.progressCount, { color: colors.mutedForeground }]}>
            {isComplete
              ? `${knownCount} mastered`
              : `${activeIndex} of ${cards.length} done`}
          </Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress * 100}%`,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
      </View>

      {isComplete ? (
        <View
          style={[
            styles.completeCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.completeIcon,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Ionicons name="checkmark-done" size={30} color={colors.primary} />
          </View>
          <Text style={[styles.completeTitle, { color: colors.cardForeground }]}>
            Nice work.
          </Text>
          <Text
            style={[
              styles.completeCopy,
              { color: colors.mutedForeground },
            ]}
          >
            You marked {knownCount} of {cards.length} cards as
            known. Revisit the others whenever you’re ready.
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="study-again"
            onPress={restartDeck}
            style={({ pressed }) => [
              styles.restartButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Ionicons
              name="refresh"
              size={18}
              color={colors.primaryForeground}
            />
            <Text
              style={[
                styles.restartButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              Study again
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.cardStage}>
            <View
              pointerEvents="none"
              style={[
                styles.cardShadow,
                {
                  backgroundColor: colors.primary,
                  transform: [{ rotate: '3deg' }],
                },
              ]}
            />
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.studyCard,
                {
                  height: cardHeight,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  transform: [{ translateX }, { rotate }],
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isRevealed ? 'Show the question' : 'Reveal the answer'
                }
                testID="flashcard-toggle"
                onPress={() => setIsRevealed(value => !value)}
                style={({ pressed }) => [
                  styles.cardContent,
                  { opacity: pressed ? 0.94 : 1 },
                ]}
              >
                <View style={styles.cardTopline}>
                  <View
                    style={[
                      styles.topicPill,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.topicPillText,
                        { color: colors.secondaryForeground },
                      ]}
                    >
                      {card.topic}
                    </Text>
                  </View>
                  <Ionicons
                    name={isRevealed ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.mutedForeground}
                  />
                </View>

                <View style={styles.cardMessage}>
                  <Text
                    style={[
                      styles.cardEyebrow,
                      { color: colors.accent },
                    ]}
                  >
                    {isRevealed ? 'THE ANSWER' : 'QUESTION'}
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    style={[
                      styles.cardText,
                      { color: colors.cardForeground },
                    ]}
                  >
                    {isRevealed ? card.answer : card.question}
                  </Text>
                </View>

                <View
                  style={[
                    styles.cardBottomline,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.cardHint,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {isRevealed ? 'Tap to see question' : 'Tap to reveal answer'}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={16}
                    color={colors.mutedForeground}
                  />
                </View>
              </Pressable>
            </Animated.View>
          </View>

          <View style={styles.gestureHint}>
            <Ionicons
              name="swap-horizontal"
              size={16}
              color={colors.mutedForeground}
            />
            <Text style={[styles.gestureText, { color: colors.mutedForeground }]}>
              Swipe left to revisit · right to know it
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark for review and continue"
              testID="mark-again"
              onPress={() => advanceCard('again')}
              style={({ pressed }) => [
                styles.actionButton,
                styles.reviewButton,
                {
                  backgroundColor: colors.secondary,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={19}
                color={colors.secondaryForeground}
              />
              <Text
                style={[
                  styles.actionText,
                  { color: colors.secondaryForeground },
                ]}
              >
                Again
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark as known and continue"
              testID="mark-known"
              onPress={() => advanceCard('know')}
              style={({ pressed }) => [
                styles.actionButton,
                styles.knownButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  { color: colors.primaryForeground },
                ]}
              >
                Got it
              </Text>
              <Ionicons
                name="checkmark"
                size={19}
                color={colors.primaryForeground}
              />
            </Pressable>
          </View>
        </>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={showSavedDecks}
        onRequestClose={() => setShowSavedDecks(false)}
      >
        <View style={styles.savedDecksBackdrop}>
          <View
            style={[
              styles.savedDecksPanel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.savedDecksHeader}>
              <View>
                <Text style={[styles.savedDecksTitle, { color: colors.foreground }]}>
                  Saved decks
                </Text>
                <Text style={[styles.savedDecksSubtitle, { color: colors.mutedForeground }]}>
                  Pick up where you left off.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close saved decks"
                onPress={() => setShowSavedDecks(false)}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Ionicons name="close" size={19} color={colors.foreground} />
              </Pressable>
            </View>

            {decksQuery.isLoading ? (
              <ActivityIndicator
                style={styles.savedDecksLoading}
                color={colors.primary}
              />
            ) : decksQuery.isError ? (
              <Text style={[styles.savedDecksEmpty, { color: colors.destructive }]}>
                Saved decks are unavailable. Check your connection and try again.
              </Text>
            ) : !decksQuery.data?.decks.length ? (
              <Text style={[styles.savedDecksEmpty, { color: colors.mutedForeground }]}>
                Your generated decks will appear here.
              </Text>
            ) : (
              <FlatList
                data={decksQuery.data.decks}
                keyExtractor={deckSummary => deckSummary.id}
                style={styles.savedDeckList}
                showsVerticalScrollIndicator={false}
                renderItem={({ item: deckSummary }) => (
                  <Pressable
                    accessibilityRole="button"
                    testID={`saved-deck-${deckSummary.id}`}
                    onPress={() => {
                      setSelectedDeckId(deckSummary.id);
                      setShowSavedDecks(false);
                    }}
                    style={({ pressed }) => [
                      styles.savedDeckRow,
                      {
                        backgroundColor: colors.secondary,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <View style={styles.savedDeckInfo}>
                      <Text
                        numberOfLines={1}
                        style={[styles.savedDeckTopic, { color: colors.foreground }]}
                      >
                        {deckSummary.topic}
                      </Text>
                      <Text
                        style={[
                          styles.savedDeckProgress,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {deckSummary.knownCount} mastered · {deckSummary.cardCount} cards
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.4,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedDecksBackdrop: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  savedDecksPanel: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '76%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  savedDecksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  savedDecksTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  savedDecksSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedDecksLoading: {
    marginVertical: 28,
  },
  savedDecksEmpty: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: 18,
  },
  savedDeckList: {
    flexGrow: 0,
  },
  savedDeckRow: {
    minHeight: 66,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 9,
  },
  savedDeckInfo: {
    flex: 1,
    minWidth: 0,
  },
  savedDeckTopic: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  savedDeckProgress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 5,
  },
  openingDeck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  openingDeckText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  intro: {
    width: '100%',
    maxWidth: 520,
    marginTop: 27,
    marginBottom: 15,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  kickerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  kicker: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.35,
  },
  title: {
    fontSize: 29,
    lineHeight: 35,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -1.05,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  generator: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 17,
  },
  generationOptions: {
    width: '100%',
    maxWidth: 520,
    gap: 10,
    marginTop: -5,
    marginBottom: 17,
  },
  generationOptionRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  generationOptionLabel: {
    width: 48,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.1,
  },
  generationOptionChoices: {
    flex: 1,
    flexDirection: 'row',
    gap: 7,
  },
  generationChoice: {
    minHeight: 34,
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  generationChoiceText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  topicInputWrap: {
    flex: 1,
    minWidth: 0,
    height: 50,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
  },
  topicInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  generateButton: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  generateButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  generationError: {
    width: '100%',
    maxWidth: 520,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: -9,
    marginBottom: 12,
  },
  progressSection: {
    width: '100%',
    maxWidth: 520,
    marginBottom: 16,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 9,
  },
  progressTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  progressCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  progressTrack: {
    height: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 6,
  },
  cardStage: {
    width: '100%',
    maxWidth: 520,
    position: 'relative',
    justifyContent: 'center',
  },
  cardShadow: {
    position: 'absolute',
    top: 8,
    left: 5,
    right: 5,
    bottom: -3,
    borderRadius: 29,
    opacity: 0.12,
  },
  studyCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#17372e',
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardContent: {
    flex: 1,
    padding: 23,
    justifyContent: 'space-between',
  },
  cardTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topicPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  topicPillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.15,
  },
  cardMessage: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 22,
  },
  cardEyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 17,
  },
  cardText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 27,
    lineHeight: 35,
    letterSpacing: -0.75,
  },
  cardBottomline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  gestureHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 15,
  },
  gestureText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  actions: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    minHeight: 54,
    borderRadius: 18,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
  },
  reviewButton: {
    flex: 0.9,
  },
  knownButton: {
    flex: 1.1,
  },
  actionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  completeCard: {
    width: '100%',
    maxWidth: 520,
    flex: 1,
    maxHeight: 410,
    marginTop: 18,
    borderRadius: 28,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 19,
  },
  completeTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -0.7,
    marginBottom: 9,
  },
  completeCopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 24,
  },
  restartButton: {
    minHeight: 52,
    borderRadius: 17,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  restartButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
