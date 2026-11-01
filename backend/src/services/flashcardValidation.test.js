const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGeneratedFlashcards,
  validateGenerationRequest,
} = require('./flashcardValidation');

test('defaults the card count and trims the topic', () => {
  assert.deepEqual(validateGenerationRequest({ topic: '  Biology  ' }), {
    topic: 'Biology',
    count: 5,
  });
});

test('rejects invalid generation requests', () => {
  for (const body of [
    {},
    { topic: '   ' },
    { topic: 'Biology', count: 0 },
    { topic: 'Biology', count: 21 },
    { topic: 'Biology', count: '5' },
    { topic: 'x'.repeat(201) },
  ]) {
    assert.throws(() => validateGenerationRequest(body));
  }
});

test('parses, trims, and returns exactly the requested cards', () => {
  const cards = parseGeneratedFlashcards(
    JSON.stringify({
      flashcards: [
        { question: '  What is a cell?  ', answer: '  The basic unit of life.  ' },
        { question: 'What is DNA?', answer: 'Genetic material.' },
      ],
    }),
    2,
  );

  assert.deepEqual(cards, [
    { question: 'What is a cell?', answer: 'The basic unit of life.' },
    { question: 'What is DNA?', answer: 'Genetic material.' },
  ]);
});

test('rejects malformed JSON and the wrong number of cards', () => {
  assert.throws(() => parseGeneratedFlashcards('{nope', 1), /invalid JSON/);
  assert.throws(
    () => parseGeneratedFlashcards(JSON.stringify({ flashcards: [] }), 1),
    /exactly 1 flashcards/,
  );
});

test('rejects empty fields, oversized fields, and extra properties', () => {
  const invalidCards = [
    { question: '', answer: 'Answer' },
    { question: 'Question', answer: ' ' },
    { question: 'Q'.repeat(501), answer: 'Answer' },
    { question: 'Question', answer: 'A'.repeat(5001) },
    { question: 'Question', answer: 'Answer', extra: true },
  ];

  for (const card of invalidCards) {
    assert.throws(() =>
      parseGeneratedFlashcards(JSON.stringify({ flashcards: [card] }), 1),
    );
  }
});
