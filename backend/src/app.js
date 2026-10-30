const express = require('express');
const cors = require('cors');
const flashcardRoutes = require('./routes/flashcards');

const app = express();

app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use('/api/flashcards', flashcardRoutes);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body')) {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  return next(err);
});

module.exports = app;
