// Forecast API tests using node:test and fetch against an ephemeral-port server.
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
  cookie = await registerCookie('tutor-forecast@example.com');
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

// Local calendar date n days from today as YYYY-MM-DD.
function isoIn(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Creates a student and an invoice due in 10 days; returns the invoice.
async function makeInvoice(c) {
  const studentRes = await sendAs(c, 'POST', '/api/students', {
    student_name: 'Asha',
    parent_name: 'Ravi',
    parent_mobile: '9876543210',
    fee_amount: 3000,
    fee_frequency: 'monthly',
  });
  assert.equal(studentRes.status, 201);
  const studentBody = await studentRes.json();
  const student = studentBody.student ?? studentBody;

  const invRes = await sendAs(c, 'POST', '/api/invoices', {
    student_id: student.id,
    invoice_type: 'custom',
    billing_period: 'Forecast test',
    issue_date: isoIn(0),
    due_date: isoIn(10),
    base_amount: 3000,
  });
  assert.equal(invRes.status, 201);
  return (await invRes.json()).invoice;
}

test('GET /api/forecast returns days and summary_by_horizon for 30, 60 and 90', async () => {
  const res = await send('GET', '/api/forecast?horizon=30');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.horizon, 30);
  assert.equal(body.days.length, 30);
  assert.deepEqual(Object.keys(body.summary_by_horizon).sort(), ['30', '60', '90']);
});

test('PUT /api/forecast/assumptions refuses a collection rate above 1', async () => {
  const res = await send('PUT', '/api/forecast/assumptions', { collection_rate: 2 });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.collection_rate);
});

test('PUT /api/forecast/assumptions stores a valid opening cash balance', async () => {
  const res = await send('PUT', '/api/forecast/assumptions', { opening_cash: 5000, collection_rate: 0.9 });
  assert.equal(res.status, 200);
  const { assumptions } = await res.json();
  assert.equal(assumptions.opening_cash, 5000);
  assert.equal(assumptions.collection_rate, 0.9);
});

test('simulating a delayed invoice does not lower the minimum if it moves later, and leaves the invoice unchanged', async () => {
  const invoice = await makeInvoice(cookie);
  const before = await (await send('GET', `/api/invoices/${invoice.id}`)).json();

  const res = await send('POST', '/api/forecast/simulate', {
    horizon: 30,
    scenarios: [{ type: 'delay_invoice', invoice_id: invoice.id, days: 15 }],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.difference.min_balance <= 0);
  assert.equal(body.explanation.length, 1);
  assert.ok(Array.isArray(body.shortage_before));
  assert.ok(typeof body.recommendation === 'string');

  const after = await (await send('GET', `/api/invoices/${invoice.id}`)).json();
  assert.equal(after.invoice.due_date, before.invoice.due_date);
});

test('a scenario naming another user\'s invoice is refused with 404', async () => {
  const invoice = await makeInvoice(cookie);
  const other = await registerCookie('other-forecast@example.com');
  const res = await sendAs(other, 'POST', '/api/forecast/simulate', {
    scenarios: [{ type: 'delay_invoice', invoice_id: invoice.id, days: 5 }],
  });
  assert.equal(res.status, 404);
});
