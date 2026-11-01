const axios = require('axios');
const { parseGeneratedFlashcards } = require('./flashcardValidation');

const flashcardSchema = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['flashcards'],
  additionalProperties: false,
};

async function createCards(topic, count = 5) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not configured.');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'flashcard_set',
          strict: true,
          schema: flashcardSchema,
        },
      },
      messages: [
        {
          role: 'system',
          content: 'Create accurate, concise educational flashcards. Return exactly the requested number.',
        },
        {
          role: 'user',
          content: `Create exactly ${count} question-and-answer flashcards about this topic: ${JSON.stringify(topic)}`,
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000,
    },
  );

  const message = response.data?.choices?.[0]?.message;
  if (message?.refusal) {
    throw new Error('The AI service refused to generate flashcards.');
  }

  return parseGeneratedFlashcards(message?.content, count);
}

module.exports = { createCards };
