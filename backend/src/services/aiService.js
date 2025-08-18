const axios = require('axios');

async function createCards(topic, count = 5) {
  const prompt = `
    Create ${count} Q&A flashcards for the topic "${topic}". 
    Output as JSON array: [{ question: "", answer: "" }, ...]
  `;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate flashcards.' },
        { role: 'user', content: prompt },
      ],
    },
    { headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` } },
  );

  return response.data.choices[0].message.content;
}

module.exports = { createCards };
