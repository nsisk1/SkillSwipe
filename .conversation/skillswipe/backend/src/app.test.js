const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const app = require('./app');
const aiService = require('./services/aiService');
const Flashcard = require('./models/flashcard');

async function startServer() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/api/flashcards/generate`,
  };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify(body),
  });
}

function stubDependencies({ createCards, insertMany }) {
  const originalCreateCards = aiService.createCards;
  const originalInsertMany = Flashcard.insertMany;

  aiService.createCards = createCards;
  Flashcard.insertMany = insertMany;

  return () => {
    aiService.createCards = originalCreateCards;
    Flashcard.insertMany = originalInsertMany;
  };
}

test('generation endpoint rejects invalid input before calling dependencies', async t => {
  let dependencyCalled = false;
  const restore = stubDependencies({
    createCards: async () => {
      dependencyCalled = true;
      return [];
    },
    insertMany: async () => {
      dependencyCalled = true;
      return [];
    },
  });
  const { server, url } = await startServer();
  t.after(restore);
  t.after(() => closeServer(server));

  const response = await postJson(url, { topic: '   ', count: 2 });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /topic/);
  assert.equal(dependencyCalled, false);
});

test('generation endpoint sends validated cards to MongoDB and returns them', async t => {
  const generated = [
    { question: 'What is a cell?', answer: 'The basic unit of life.' },
    { question: 'What is DNA?', answer: 'Genetic material.' },
  ];
  let aiInput;
  let inserted;
  const restore = stubDependencies({
    createCards: async (topic, count) => {
      aiInput = { topic, count };
      return generated;
    },
    insertMany: async documents => {
      inserted = documents;
      return documents.map((document, index) => ({ ...document, _id: `card-${index + 1}` }));
    },
  });
  const { server, url } = await startServer();
  t.after(restore);
  t.after(() => closeServer(server));

  const response = await postJson(url, { topic: '  Biology  ', count: 2 });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(aiInput, { topic: 'Biology', count: 2 });
  assert.deepEqual(inserted, generated.map(card => ({ ...card, topic: 'Biology' })));
  assert.equal(result.length, 2);
  assert.equal(result[0]._id, 'card-1');
});

test('generation endpoint reports AI failures without attempting a save', async t => {
  let saveCalled = false;
  const restore = stubDependencies({
    createCards: async () => {
      throw new Error('simulated provider failure');
    },
    insertMany: async () => {
      saveCalled = true;
      return [];
    },
  });
  const { server, url } = await startServer();
  t.after(restore);
  t.after(() => closeServer(server));

  const response = await postJson(url, { topic: 'Biology', count: 1 });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /generation failed/);
  assert.equal(saveCalled, false);
});

test('generation endpoint reports database failures', async t => {
  const restore = stubDependencies({
    createCards: async () => [{ question: 'What is a cell?', answer: 'The basic unit of life.' }],
    insertMany: async () => {
      throw new Error('simulated database failure');
    },
  });
  const { server, url } = await startServer();
  t.after(restore);
  t.after(() => closeServer(server));

  const response = await postJson(url, { topic: 'Biology', count: 1 });

  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /could not be saved/);
});

test('generation endpoint returns JSON 400 for malformed request bodies', async t => {
  const restore = stubDependencies({
    createCards: async () => [],
    insertMany: async () => [],
  });
  const { server, url } = await startServer();
  t.after(restore);
  t.after(() => closeServer(server));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: '{',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Request body must be valid JSON.' });
});
