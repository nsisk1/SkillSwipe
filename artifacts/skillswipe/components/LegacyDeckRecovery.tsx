import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useAuth } from '@clerk/expo';
import { useReviewLegacyDeck, useTransferLegacyDeck, type FlashcardDeck } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function LegacyDeckRecovery({
  onClose,
  onTransferred,
}: {
  onClose: () => void;
  onTransferred: (deck: FlashcardDeck) => void;
}) {
  const colors = useColors();
  const { userId } = useAuth();
  const [code, setCode] = useState('');
  const [reviewedCode, setReviewedCode] = useState('');
  const [deck, setDeck] = useState<FlashcardDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const review = useReviewLegacyDeck({ mutation: { gcTime: 0 } });
  const transfer = useTransferLegacyDeck({ mutation: { gcTime: 0 } });
  const busy = review.isPending || transfer.isPending;
  const text = { color: colors.foreground };
  const muted = { color: colors.mutedForeground };

  const reviewCode = async () => {
    setError(null);
    const enteredCode = code.trim();
    if (!/^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(enteredCode)) {
      setError('Enter the complete recovery code supplied after ownership verification.');
      return;
    }
    try {
      const result = await review.mutateAsync({ data: { code: enteredCode } });
      setReviewedCode(enteredCode);
      setDeck(result);
      setCode('');
    } catch {
      setError('Couldn’t review this code. It may be expired or not approved for this account. Check your connection and try again.');
    } finally {
      review.reset();
    }
  };

  const accept = async () => {
    setError(null);
    try {
      const recovered = await transfer.mutateAsync({ data: { code: reviewedCode } });
      onTransferred(recovered);
    } catch {
      setError('Transfer could not be confirmed. Check your connection and retry. Repeating a transfer will not duplicate your deck.');
    } finally {
      transfer.reset();
    }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, text]}>Recover older decks</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            <Text style={[styles.copy, muted]}>
              Older decks are not linked to a learner account. Using this device does not prove they belong to you.
              Recovery requires the app operator to independently verify ownership and issue a code for each eligible deck.
              If ownership cannot be verified, the deck cannot be recovered.
            </Text>
            <Text selectable style={[styles.copy, muted]}>Receiving account: {userId}</Text>
            {!deck ? (
              <>
                <Text style={[styles.label, text]}>Account-approved recovery code</Text>
                <TextInput
                  accessibilityLabel="Recovery code"
                  testID="recovery-code"
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={120}
                  placeholder="Paste your recovery code"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, text, { borderColor: colors.border }]}
                />
                <Pressable accessibilityRole="button" testID="review-recovery" disabled={busy || !code.trim()} onPress={() => void reviewCode()}
                  style={[styles.button, { backgroundColor: colors.primary, opacity: busy || !code.trim() ? 0.5 : 1 }]}>
                  <Text style={[styles.label, { color: colors.primaryForeground }]}>Review deck</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.heading, text]}>{deck.topic}</Text>
                <Text style={[styles.copy, muted]}>
                  {deck.cards.length} cards · {deck.cards.filter(card => card.status === 'known').length} mastered · Position {deck.activeIndex} of {deck.cards.length}
                </Text>
                <Text style={[styles.copy, muted]}>
                  Review the cards below. Transfer only if this is your study history. It will become private to the account shown above; your progress will be preserved.
                </Text>
                {deck.cards.map(card => (
                  <View key={card.id} style={[styles.card, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.label, text]}>{card.question}</Text>
                    <Text style={[styles.copy, muted]}>{card.answer}</Text>
                  </View>
                ))}
                <Pressable accessibilityRole="button" testID="confirm-recovery" disabled={busy} onPress={() => void accept()}
                  style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}>
                  <Text style={[styles.label, { color: colors.primaryForeground }]}>Transfer to my account</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setDeck(null); setReviewedCode(''); setError(null); }} style={styles.button}>
                  <Text style={[styles.label, text]}>Use another code</Text>
                </Pressable>
              </>
            )}
            {busy && <ActivityIndicator color={colors.primary} />}
            {error && <Text accessibilityRole="alert" testID="recovery-error" style={[styles.copy, { color: colors.destructive }]}>{error}</Text>}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel recovery" testID="cancel-recovery" disabled={busy} onPress={onClose}
            style={[styles.button, { backgroundColor: colors.secondary, opacity: busy ? 0.5 : 1 }]}>
            <Text style={[styles.label, text]}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  panel: { width: '100%', maxWidth: 520, maxHeight: '85%', alignSelf: 'center', borderWidth: 1, borderRadius: 24, padding: 20 },
  scroll: { flexGrow: 0 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 17, marginVertical: 10 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  copy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20, marginVertical: 8 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 10, fontSize: 13 },
  button: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  card: { borderRadius: 14, padding: 14, marginBottom: 9 },
});
