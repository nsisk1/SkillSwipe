import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function Flashcard({ question, answer }) {
  const [showAns, setShowAns] = useState(false);

  return (
    <TouchableOpacity onPress={() => setShowAns(!showAns)}>
      <View style={styles.card}>
        <Text style={styles.text}>{showAns ? answer : question}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 300,
    height: 200,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  text: { fontSize: 18 }
});
