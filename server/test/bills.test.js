// Bills API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-bills@example.com');
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

const validBill = (overrides = {}) => ({
  name: 'Centre rent',
  amount: 500,
  due_date: '2099-03-10',
  category: 'rent',
  recurrence: 'monthly',
  ...overrides,
});

// Expenses created by bill payments for a given bill payment id.
async function linkedExpenses(paymentId) {
  const { expenses } = await (await send('GET', '/api/expenses?category=rent')).json();
  return expenses.filter((e) => e.bill_payment_id === paymentId);
}

test('create a monthly bill returns 201 with status upcoming', async () => {
  const res = await send('POST', '/api/bills', validBill());
  assert.equal(res.status, 201);
  const { bill } = await res.json();
  assert.equal(bill.status, 'upcoming');
  assert.equal(bill.recurrence, 'monthly');
});

test('paying a monthly bill writes one bill payment and one linked expense, and advances the due date', async () => {
  const created = (await (await send('POST', '/api/bills', validBill({ name: 'Hall hire' }))).json()).bill;

  const res = await send('POST', `/api/bills/${created.id}/pay`, { payment_method: 'upi' });
  assert.equal(res.status, 200);
  const { bill, payment } = await res.json();
  assert.ok(payment.id);
  assert.equal(payment.bill_id, created.id);
  assert.equal(payment.amount, 500);

  const linked = await linkedExpenses(payment.id);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].title, 'Hall hire');

  assert.equal(bill.due_date, '2099-04-10');
  assert.equal(bill.status, 'upcoming');
});

test('paying a one_time bill marks it paid, and paying it again is refused', async () => {
  const created = (await (await send('POST', '/api/bills', validBill({
    name: 'Projector',
    recurrence: 'one_time',
    due_date: '2099-05-01',
  }))).json()).bill;

  const first = await send('POST', `/api/bills/${created.id}/pay`, { payment_method: 'cash' });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).bill.status, 'paid');

  const again = await send('POST', `/api/bills/${created.id}/pay`, { payment_method: 'cash' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).message, 'Bill is already paid');
});

test('an expense linked to a bill payment cannot be edited', async () => {
  const created = (await (await send('POST', '/api/bills', validBill({ name: 'Broadband' }))).json()).bill;
  const { payment } = await (await send('POST', `/api/bills/${created.id}/pay`, { payment_method: 'bank_transfer' })).json();

  const [linked] = await linkedExpenses(payment.id);
  const res = await send('PUT', `/api/expenses/${linked.id}`, { title: 'Edited' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'This expense comes from a bill payment; edit the bill instead');
});

test('paying a cancelled bill is refused', async () => {
  const created = (await (await send('POST', '/api/bills', validBill({ name: 'Old contract' }))).json()).bill;

  const cancelled = await send('POST', `/api/bills/${created.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).bill.status, 'cancelled');

  const res = await send('POST', `/api/bills/${created.id}/pay`, { payment_method: 'cash' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'Bill is cancelled');
});

test('another user cannot pay a bill', async () => {
  const created = (await (await send('POST', '/api/bills', validBill({ name: 'Private' }))).json()).bill;

  const other = await registerCookie('other-bills@example.com');
  const res = await sendAs(other, 'POST', `/api/bills/${created.id}/pay`, { payment_method: 'cash' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Bill not found');
});
