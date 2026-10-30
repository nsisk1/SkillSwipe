import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';
import GestureRecognizer from 'react-native-swipe-gestures';
import Flashcard from './Flashcard';
import { generateFlashcards } from '../api';

export default function SwipeDeck() {
  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    generateFlashcards('Python basics', 5)
      .then(res => setCards(res.data))
      .catch(console.error);
  }, []);

  const onSwipe = () => setIdx(prev => Math.min(prev + 1, cards.length - 1));

  if (!cards.length) return <Text>Loading…</Text>;

  return (
    <GestureRecognizer onSwipeLeft={onSwipe} onSwipeRight={onSwipe}>
      <View style={styles.container}>
        <Flashcard {...cards[idx]} />
        <Button title="Next" onPress={onSwipe} />
      </View>
    </GestureRecognizer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
