// AI chat API tests using node:test and fetch against an ephemeral-port server. No AI key is set here,
// so every answer must come from the calculated path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';
delete process.env.FEESAATHI_AI_KEY;

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-ai@example.com');
});

after(() => new Promise((resolve) => server.close(resolve)));

// Registers a tutor and returns the session cookie.
async function registerCookie(email) {
  const reg = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Tutor Test', email, password: 'password123' }),
  });
  assert.equal(reg.status, 201);
  return (reg.headers.get('set-cookie') || '').split(';')[0];
}

const sendAs = (c, method, path, body) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('POST /api/ai/chat answers "who has not paid" from calculations', async () => {
  const res = await sendAs(cookie, 'POST', '/api/ai/chat', { question: 'who has not paid' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'calculated');
  assert.equal(body.intent, 'overdue');
  assert.ok(typeof body.answer === 'string' && body.answer.length > 0);
});

test('POST /api/ai/chat refuses a 1-character question with errors.question', async () => {
  const res = await sendAs(cookie, 'POST', '/api/ai/chat', { question: 'a' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.question);
});

test('GET /api/ai/status reports ai_available false when no key is set', async () => {
  const res = await sendAs(cookie, 'GET', '/api/ai/status');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ai_available, false);
});

test('the AI chat response never contains the key variable name', async () => {
  const res = await sendAs(cookie, 'POST', '/api/ai/chat', { question: 'who has not paid' });
  const text = await res.text();
  assert.ok(!text.includes('FEESAATHI_AI_KEY'));
});
