import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth, useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

type AuthMode = 'sign-in' | 'sign-up';
type VerificationMode = 'sign-in' | 'sign-up' | null;

WebBrowser.maybeCompleteAuthSession();

export default function AccountAccessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isLoaded } = useAuth();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [verificationMode, setVerificationMode] = useState<VerificationMode>(null);
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ssoPending, setSsoPending] = useState(false);
  const fetching =
    signInFetchStatus === 'fetching' ||
    signUpFetchStatus === 'fetching' ||
    ssoPending;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const finishSignIn = async () => {
    await signIn.finalize({ navigate: () => undefined });
  };

  const finishSignUp = async () => {
    await signUp.finalize({ navigate: () => undefined });
  };

  const submitPassword = async () => {
    setFeedback(null);
    if (mode === 'sign-up') {
      const { error } = await signUp.password({ emailAddress, password });
      if (error) {
        setFeedback(error.message);
        return;
      }
      if (signUp.status === 'complete') {
        await finishSignUp();
        return;
      }
      const { error: verificationError } =
        await signUp.verifications.sendEmailCode();
      if (verificationError) {
        setFeedback(verificationError.message);
        return;
      }
      setVerificationMode('sign-up');
      return;
    }

    const { error } = await signIn.password({ emailAddress, password });
    if (error) {
      setFeedback(error.message);
      return;
    }
    if (signIn.status === 'complete') {
      await finishSignIn();
      return;
    }
    if (
      signIn.status === 'needs_client_trust' ||
      signIn.status === 'needs_second_factor'
    ) {
      const emailFactor = signIn.supportedSecondFactors?.find(
        factor => factor.strategy === 'email_code',
      );
      if (emailFactor) {
        const { error: verificationError } = await signIn.mfa.sendEmailCode();
        if (verificationError) {
          setFeedback(verificationError.message);
          return;
        }
        setVerificationMode('sign-in');
        return;
      }
      setFeedback('This account needs another verification method to sign in.');
    }
  };

  const verifyCode = async () => {
    setFeedback(null);
    if (verificationMode === 'sign-up') {
      const { error } = await signUp.verifications.verifyEmailCode({
        code: verificationCode,
      });
      if (error) {
        setFeedback(error.message);
        return;
      }
      if (signUp.status === 'complete') await finishSignUp();
      return;
    }

    const { error } = await signIn.mfa.verifyEmailCode({
      code: verificationCode,
    });
    if (error) {
      setFeedback(error.message);
      return;
    }
    if (signIn.status === 'complete') await finishSignIn();
  };

  const signInWithGoogle = async () => {
    setFeedback(null);
    setSsoPending(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: () => undefined,
        });
      } else {
        setFeedback('Google sign-in needs additional account setup. Try email instead.');
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Google sign-in is unavailable right now.',
      );
    } finally {
      setSsoPending(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setVerificationMode(null);
    setFeedback(null);
    setVerificationCode('');
  };

  const fieldError =
    mode === 'sign-in'
      ? signInErrors.fields.identifier?.message ??
        signInErrors.fields.password?.message
      : signUpErrors.fields.emailAddress?.message ??
        signUpErrors.fields.password?.message ??
        signUpErrors.fields.code?.message;
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!isLoaded) return null;

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: topPadding + 24, paddingBottom: bottomPadding + 24 },
      ]}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
    >
        <View style={styles.content}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Text style={[styles.brandInitial, { color: colors.primaryForeground }]}>
              S
            </Text>
          </View>
          <Text style={[styles.brand, { color: colors.foreground }]}>skillswipe</Text>
          <Text style={[styles.heading, { color: colors.foreground }]}>
            {verificationMode
              ? 'Check your email'
              : mode === 'sign-in'
                ? 'Welcome back'
                : 'Create your account'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {verificationMode
              ? `Enter the code sent to ${emailAddress}.`
              : 'Sign in to keep your decks and study progress with you.'}
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {verificationMode ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Email verification code
                </Text>
                <TextInput
                  accessibilityLabel="Email verification code"
                  autoComplete="one-time-code"
                  autoFocus
                  keyboardType="number-pad"
                  onChangeText={setVerificationCode}
                  placeholder="Enter the code"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  value={verificationCode}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!verificationCode || fetching}
                  onPress={() => void verifyCode()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: !verificationCode || fetching || pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {fetching ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                      Verify and continue
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setVerificationMode(null);
                    setFeedback(null);
                  }}
                  style={styles.textButton}
                >
                  <Text style={[styles.textButtonLabel, { color: colors.primary }]}>
                    Back to sign in
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setEmailAddress}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  value={emailAddress}
                />
                <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  value={password}
                />
                {fieldError ? (
                  <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                    {fieldError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={!emailAddress || !password || fetching}
                  onPress={() => void submitPassword()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: !emailAddress || !password || fetching || pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {fetching ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                      {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                    </Text>
                  )}
                </Pressable>
                <View style={styles.separator}>
                  <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
                  <Text style={[styles.separatorText, { color: colors.mutedForeground }]}>
                    OR
                  </Text>
                  <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={fetching}
                  onPress={() => void signInWithGoogle()}
                  style={({ pressed }) => [
                    styles.googleButton,
                    {
                      backgroundColor: colors.secondary,
                      opacity: fetching || pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.googleButtonText, { color: colors.secondaryForeground }]}>
                    Continue with Google
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
                  style={styles.textButton}
                >
                  <Text style={[styles.textButtonLabel, { color: colors.primary }]}>
                    {mode === 'sign-in'
                      ? 'New to SkillSwipe? Create an account'
                      : 'Already have an account? Sign in'}
                  </Text>
                </Pressable>
              </>
            )}
            {feedback ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                {feedback}
              </Text>
            ) : null}
          </View>
          <View nativeID="clerk-captcha" />
        </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  brandInitial: { fontSize: 24, fontWeight: '700' },
  brand: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 36,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
  },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700' },
  googleButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: { fontSize: 15, fontWeight: '600' },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 18,
  },
  separatorLine: { height: 1, flex: 1 },
  separatorText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  textButton: { alignItems: 'center', paddingVertical: 14 },
  textButtonLabel: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  error: { fontSize: 13, lineHeight: 19, marginTop: 14 },
});
