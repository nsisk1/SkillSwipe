import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  StatusBar,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type StudyCard = {
  id: string;
  topic: string;
  question: string;
  answer: string;
};

type Decision = 'know' | 'again';

const BIOLOGY_CARDS: StudyCard[] = [
  {
    id: 'cell',
    topic: 'Cell biology',
    question: 'What is the powerhouse of the cell?',
    answer:
      'The mitochondrion. It converts energy from food into ATP, the form of energy cells can use.',
  },
  {
    id: 'membrane',
    topic: 'Cell biology',
    question: 'What does a cell membrane do?',
    answer:
      'It separates the inside of the cell from its surroundings and controls what enters and leaves.',
  },
  {
    id: 'dna',
    topic: 'Genetics',
    question: 'What is DNA’s primary role?',
    answer:
      'DNA stores the genetic instructions cells use to build proteins and pass traits to new cells.',
  },
  {
    id: 'photosynthesis',
    topic: 'Plant science',
    question: 'What do plants take in during photosynthesis?',
    answer:
      'Plants use light energy, water, and carbon dioxide to make glucose and release oxygen.',
  },
  {
    id: 'enzyme',
    topic: 'Chemistry of life',
    question: 'How do enzymes speed up reactions?',
    answer:
      'They lower the activation energy needed for a reaction, without being used up themselves.',
  },
  {
    id: 'homeostasis',
    topic: 'Human biology',
    question: 'What does homeostasis keep stable?',
    answer:
      'Important internal conditions, such as temperature and fluid balance, despite changes outside the body.',
  },
];

export default function StudyHome() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  const card = BIOLOGY_CARDS[activeIndex];
  const isComplete = activeIndex >= BIOLOGY_CARDS.length;
  const progress = Math.min(activeIndex / BIOLOGY_CARDS.length, 1);
  const rotate = translateX.interpolate({
    inputRange: [-260, 0, 260],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });
  const cardHeight = Math.min(height * 0.405, 350);

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
        if (finished) {
          if (decision === 'know') {
            setKnownIds(previous =>
              previous.includes(card.id) ? previous : [...previous, card.id],
            );
          }
          setActiveIndex(index => index + 1);
          setIsRevealed(false);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
            () => undefined,
          );
        }
        translateX.setValue(0);
        isAnimating.current = false;
      });
    },
    [card, translateX, width],
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

  const restartDeck = () => {
    if (isAnimating.current) return;
    setActiveIndex(0);
    setIsRevealed(false);
    setKnownIds([]);
    translateX.setValue(0);
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
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restart this deck"
          testID="restart-deck"
          onPress={restartDeck}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="refresh" size={19} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.intro}>
        <View style={styles.kickerRow}>
          <View style={[styles.kickerDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>
            YOUR QUICK STUDY SESSION
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Biology, made clear.
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Six focused cards. One thing at a time.
        </Text>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressLabels}>
          <Text style={[styles.progressTitle, { color: colors.foreground }]}>
            {isComplete
              ? 'Session complete'
              : `Card ${String(activeIndex + 1).padStart(2, '0')}`}
          </Text>
          <Text style={[styles.progressCount, { color: colors.mutedForeground }]}>
            {isComplete
              ? `${knownIds.length} mastered`
              : `${activeIndex} of ${BIOLOGY_CARDS.length} done`}
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
            You marked {knownIds.length} of {BIOLOGY_CARDS.length} cards as
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
  intro: {
    width: '100%',
    maxWidth: 520,
    marginTop: 27,
    marginBottom: 22,
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
