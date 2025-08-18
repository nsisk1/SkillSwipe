const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const flashcardRoutes = require('./routes/flashcards');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/flashcards', flashcardRoutes);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('DB connected');
    app.listen(process.env.PORT, () =>
      console.log(`Server running on ${process.env.PORT}`)
    );
  })
  .catch(err => console.error(err));
