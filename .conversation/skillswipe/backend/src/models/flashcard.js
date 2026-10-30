const mongoose = require('mongoose');

const flashcardSchema = new mongoose.Schema(
  {
    topic: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    question: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Flashcard', flashcardSchema);
