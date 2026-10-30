const MIN_COUNT = 1;
const MAX_COUNT = 20;
const MAX_TOPIC_LENGTH = 200;
const MAX_QUESTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 5000;

function validateGenerationRequest(body) {
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  const count = body?.count === undefined ? 5 : body.count;

  if (!topic) {
    throw new Error('topic must be a non-empty string.');
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    throw new Error(`topic must be ${MAX_TOPIC_LENGTH} characters or fewer.`);
  }
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new Error(`count must be an integer between ${MIN_COUNT} and ${MAX_COUNT}.`);
  }

  return { topic, count };
}

function parseGeneratedFlashcards(content, expectedCount) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('The AI service returned an empty response.');
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error('The AI service returned invalid JSON.');
  }

  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !Array.isArray(result.flashcards)
  ) {
    throw new Error('The AI response must contain a flashcards array.');
  }
  if (result.flashcards.length !== expectedCount) {
    throw new Error(`The AI response must contain exactly ${expectedCount} flashcards.`);
  }

  return result.flashcards.map((card, index) => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      throw new Error(`Flashcard ${index + 1} must be an object.`);
    }
    if (Object.keys(card).some(key => key !== 'question' && key !== 'answer')) {
      throw new Error(`Flashcard ${index + 1} contains unexpected fields.`);
    }

    const question = typeof card.question === 'string' ? card.question.trim() : '';
    const answer = typeof card.answer === 'string' ? card.answer.trim() : '';

    if (!question || question.length > MAX_QUESTION_LENGTH) {
      throw new Error(`Flashcard ${index + 1} has an invalid question.`);
    }
    if (!answer || answer.length > MAX_ANSWER_LENGTH) {
      throw new Error(`Flashcard ${index + 1} has an invalid answer.`);
    }

    return { question, answer };
  });
}

module.exports = { parseGeneratedFlashcards, validateGenerationRequest };
