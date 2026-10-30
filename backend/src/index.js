const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const flashcardRoutes = require('./routes/flashcards');

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

app.use('/api/flashcards', flashcardRoutes);

const port = process.env.PORT ? Number(process.env.PORT) : 5000;
const mongoUri = process.env.MONGODB_URI;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

if (!mongoUri) {
  console.error('MONGODB_URI is required to start the backend.');
  process.exit(1);
}

mongoose.connect(mongoUri)
  .then(() => {
    console.log('DB connected');
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });
