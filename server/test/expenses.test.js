// Expenses API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');
const { todayIso } = await import('../src/invoiceLogic.js');

let server;
let base;
let cookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-exp@example.com');
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

const send = (method, path, body) => sendAs(cookie, method, path, body);

const validExpense = (overrides = {}) => ({
  title: 'Whiteboard markers',
  amount: 250,
  category: 'teaching_materials',
  expense_date: todayIso(),
  payment_method: 'cash',
  ...overrides,
});

test('create a valid expense returns 201', async () => {
  const res = await send('POST', '/api/expenses', validExpense());
  assert.equal(res.status, 201);
  const { expense } = await res.json();
  assert.equal(expense.amount, 250);
  assert.equal(expense.status, 'active');
});

test('an invalid amount returns 400 with errors.amount', async () => {
  const res = await send('POST', '/api/expenses', validExpense({ amount: 0 }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.amount);
});

test('summary reports today_total and month_total including a new expense', async () => {
  const before = await (await send('GET', '/api/expenses/summary')).json();

  const res = await send('POST', '/api/expenses', validExpense({ amount: 100 }));
  assert.equal(res.status, 201);

  const after = await (await send('GET', '/api/expenses/summary')).json();
  assert.equal(after.today_total, before.today_total + 100);
  assert.equal(after.month_total, before.month_total + 100);
  assert.equal(after.total, before.total + 100);
});

test('soft delete hides the expense from the list', async () => {
  const created = await send('POST', '/api/expenses', validExpense({ title: 'To delete', amount: 40 }));
  const { expense } = await created.json();

  const deleted = await send('DELETE', `/api/expenses/${expense.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).expense.status, 'deleted');

  const { expenses } = await (await send('GET', '/api/expenses')).json();
  assert.ok(!expenses.some((e) => e.id === expense.id));
});

test('another user cannot update an expense', async () => {
  const created = await send('POST', '/api/expenses', validExpense({ title: 'Mine' }));
  const { expense } = await created.json();

  const other = await registerCookie('other-exp@example.com');
  const res = await sendAs(other, 'PUT', `/api/expenses/${expense.id}`, { title: 'Hijack' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Expense not found');
});
