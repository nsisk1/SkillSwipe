const express = require('express');
const { generateFlashcards } = require('../controllers/flashcardController');

const router = express.Router();

router.post('/generate', generateFlashcards);

module.exports = router;
