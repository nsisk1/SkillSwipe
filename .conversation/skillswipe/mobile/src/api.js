import axios from 'axios';

export const generateFlashcards = (topic, count) =>
  axios.post('http://localhost:5000/api/flashcards/generate', { topic, count });
