const aiService = require('../services/aiService');
const Flashcard = require('../models/flashcard');

exports.generateFlashcards = async (req, res) => {
  try {
    const { topic, count } = req.body;
    const cards = await aiService.createCards(topic, count);

    // Optionally save to DB
    const saved = await Flashcard.insertMany(cards);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
