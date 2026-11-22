// Alerts API tests using node:test and fetch against an ephemeral-port server. Same harness as ai.test.js.
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
  cookie = await registerCookie('tutor-alerts@example.com');
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

// Local YYYY-MM-DD, matching the server's "today".
const localToday = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A bill due today, so the tutor always has at least one alert.
async function createBillDueToday(c) {
  const res = await sendAs(c, 'POST', '/api/bills', {
    name: 'Internet bill',
    amount: 1200,
    due_date: localToday(),
    category: 'internet',
    recurrence: 'one_time',
  });
  assert.equal(res.status, 201);
  return (await res.json()).bill.id;
}

test('GET /api/alerts returns 200 with alerts and unread_count', async () => {
  await createBillDueToday(cookie);
  const res = await sendAs(cookie, 'GET', '/api/alerts');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.alerts));
  assert.ok(body.alerts.length >= 1);
  assert.equal(typeof body.unread_count, 'number');
  assert.ok(body.unread_count >= 1);
});

test('POST /api/alerts/:id/read marks the alert read and lowers unread_count', async () => {
  const before = await (await sendAs(cookie, 'GET', '/api/alerts')).json();
  const target = before.alerts.find((a) => !a.read);
  assert.ok(target, 'expected an unread alert');

  const res = await sendAs(cookie, 'POST', `/api/alerts/${target.id}/read`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).alert.read, true);

  const after = await (await sendAs(cookie, 'GET', '/api/alerts')).json();
  assert.equal(after.unread_count, before.unread_count - 1);
  assert.equal(after.alerts.find((a) => a.id === target.id).read, true);
});

test('POST /api/alerts/:id/unread marks a read alert unread again', async () => {
  const before = await (await sendAs(cookie, 'GET', '/api/alerts')).json();
  const target = before.alerts[0];
  assert.ok(target, 'expected at least one alert');

  const readRes = await sendAs(cookie, 'POST', `/api/alerts/${target.id}/read`);
  assert.equal(readRes.status, 200);

  const res = await sendAs(cookie, 'POST', `/api/alerts/${target.id}/unread`);
  assert.equal(res.ok, true);

  const after = await (await sendAs(cookie, 'GET', '/api/alerts')).json();
  assert.equal(after.alerts.find((a) => a.id === target.id).read, false);
});


test('another user cannot mark my alert read (404)', async () => {
  const mine = await (await sendAs(cookie, 'GET', '/api/alerts')).json();
  const otherCookie = await registerCookie('tutor-alerts-other@example.com');
  const res = await sendAs(otherCookie, 'POST', `/api/alerts/${mine.alerts[0].id}/read`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Alert not found');
});
