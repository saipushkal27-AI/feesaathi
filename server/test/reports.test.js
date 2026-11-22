// Reports API tests using node:test and fetch against an ephemeral-port server. Same harness as ai.test.js.
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
let otherCookie;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-reports@example.com');
  otherCookie = await registerCookie('tutor-reports-other@example.com');
  await recordPayment(cookie, 'Lakshmi, Jr', 2000);
  await recordPayment(otherCookie, 'Other Student', 3500);
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

const localToday = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Creates a student, an invoice for them and one active payment, all for one tutor.
async function recordPayment(c, studentName, amount) {
  const today = localToday();
  const s = await sendAs(c, 'POST', '/api/students', {
    student_name: studentName,
    parent_name: 'Parent',
    parent_mobile: '9876543210',
    fee_amount: amount,
    fee_frequency: 'monthly',
  });
  assert.equal(s.status, 201);
  const studentId = (await s.json()).student.id;

  const inv = await sendAs(c, 'POST', '/api/invoices', {
    student_id: studentId,
    invoice_type: 'monthly',
    billing_period: 'June 2025',
    issue_date: today,
    due_date: today,
    base_amount: amount,
  });
  assert.equal(inv.status, 201);
  const invoiceId = (await inv.json()).invoice.id;

  const pay = await sendAs(c, 'POST', '/api/payments', {
    invoice_id: invoiceId,
    amount,
    payment_date: today,
    method: 'upi',
  });
  assert.equal(pay.status, 201);
}

const WIDE = 'from=2000-01-01&to=2100-12-31';

test('GET /api/reports/collection?format=json returns rows and total', async () => {
  const res = await sendAs(cookie, 'GET', `/api/reports/collection?${WIDE}&format=json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.rows));
  assert.equal(body.rows.length, 1);
  assert.equal(body.total, 2000);
});

test('GET /api/reports/collection?format=csv returns CSV with the expected header line', async () => {
  const res = await sendAs(cookie, 'GET', `/api/reports/collection?${WIDE}&format=csv`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').startsWith('text/csv'));
  const text = await res.text();
  assert.equal(text.split('\n')[0].replace(/\r$/, ''), 'payment_date,student_name,invoice_number,amount,method');
});

test('a student name containing a comma is quoted in the CSV', async () => {
  const res = await sendAs(cookie, 'GET', `/api/reports/collection?${WIDE}&format=csv`);
  const text = await res.text();
  assert.ok(text.includes('"Lakshmi, Jr"'));
});

test('from later than to gives 400 with errors.from', async () => {
  const res = await sendAs(cookie, 'GET', '/api/reports/collection?from=2025-06-10&to=2025-06-01');
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.from);
});

test("another tutor's payments do not appear in my report", async () => {
  const res = await sendAs(cookie, 'GET', `/api/reports/collection?${WIDE}&format=json`);
  const body = await res.json();
  assert.ok(!body.rows.some((r) => r.student_name === 'Other Student'));
  assert.equal(body.total, 2000);
});
