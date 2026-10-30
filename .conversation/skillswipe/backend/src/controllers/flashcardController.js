const aiService = require('../services/aiService');
const Flashcard = require('../models/flashcard');
const { validateGenerationRequest } = require('../services/flashcardValidation');

exports.generateFlashcards = async (req, res) => {
  let input;

  try {
    input = validateGenerationRequest(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let cards;
  try {
    cards = await aiService.createCards(input.topic, input.count);
  } catch (err) {
    console.error('Flashcard generation failed:', err.message);
    return res.status(502).json({
      error: 'Flashcard generation failed. Please check the AI service configuration and retry.',
    });
  }

  try {
    const saved = await Flashcard.insertMany(
      cards.map(card => ({ ...card, topic: input.topic })),
    );
    return res.status(201).json(saved);
  } catch (err) {
    console.error('Flashcards could not be saved:', err.message);
    return res.status(500).json({ error: 'Generated flashcards could not be saved.' });
  }
};
