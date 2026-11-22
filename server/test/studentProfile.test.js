// Student profile summary tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let studentId;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-profile@example.com');

  const res = await send('POST', '/api/students', {
    student_name: 'Riya Sharma',
    parent_name: 'Anita Sharma',
    parent_mobile: '9876543210',
    fee_amount: 1000,
    fee_frequency: 'monthly',
  });
  assert.equal(res.status, 201);
  studentId = (await res.json()).student.id;
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

const validInvoice = (overrides = {}) => ({
  student_id: studentId,
  invoice_type: 'monthly',
  billing_period: 'November 2099',
  issue_date: '2099-03-01',
  due_date: '2099-03-31',
  base_amount: 1000,
  ...overrides,
});

let paidInvoiceId;
let overdueInvoiceId;

test('summary totals: one paid invoice and one partially paid overdue invoice', async () => {
  const paid = await send('POST', '/api/invoices', validInvoice({ base_amount: 2000 }));
  assert.equal(paid.status, 201);
  paidInvoiceId = (await paid.json()).invoice.id;
  const paidPay = await send('POST', '/api/payments', {
    invoice_id: paidInvoiceId,
    amount: 2000,
    method: 'upi',
    payment_date: '2024-06-15',
  });
  assert.equal(paidPay.status, 201);

  const overdue = await send('POST', '/api/invoices', validInvoice({
    issue_date: '2000-01-01',
    due_date: '2000-01-10',
    base_amount: 1500,
  }));
  assert.equal(overdue.status, 201);
  overdueInvoiceId = (await overdue.json()).invoice.id;
  const partPay = await send('POST', '/api/payments', {
    invoice_id: overdueInvoiceId,
    amount: 500,
    method: 'cash',
    payment_date: '2024-05-01',
  });
  assert.equal(partPay.status, 201);

  const res = await send('GET', `/api/students/${studentId}/profile`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.student.id, studentId);
  assert.equal(body.summary.total_invoiced, 3500);
  assert.equal(body.summary.total_paid, 2500);
  assert.equal(body.summary.pending_balance, 1000);
  assert.equal(body.summary.overdue_balance, 1000);
  assert.equal(body.summary.last_payment_date, '2024-06-15');
  assert.equal(body.summary.next_due_date, '2000-01-10');
  assert.equal(body.invoices.length, 2);
  assert.equal(body.payments.length, 2);
  assert.equal(body.payments[0].payment_date, '2024-06-15');
});

test('a cancelled invoice is excluded from total_invoiced', async () => {
  const created = await send('POST', '/api/invoices', validInvoice({ base_amount: 700 }));
  const toCancel = (await created.json()).invoice;
  const cancelled = await send('POST', `/api/invoices/${toCancel.id}/cancel`);
  assert.equal(cancelled.status, 200);

  const body = await (await send('GET', `/api/students/${studentId}/profile`)).json();
  assert.equal(body.summary.total_invoiced, 3500);
  assert.equal(body.summary.pending_balance, 1000);
});

test('a reversed payment is excluded from total_paid but still listed', async () => {
  const pay = await send('POST', '/api/payments', {
    invoice_id: overdueInvoiceId,
    amount: 100,
    method: 'cash',
    payment_date: '2024-05-02',
  });
  assert.equal(pay.status, 201);
  const paymentId = (await pay.json()).payment.id;

  const reversed = await send('POST', `/api/payments/${paymentId}/reverse`, { reason: 'Entered twice' });
  assert.equal(reversed.status, 200);

  const body = await (await send('GET', `/api/students/${studentId}/profile`)).json();
  assert.equal(body.summary.total_paid, 2500);
  assert.equal(body.summary.pending_balance, 1000);
  assert.equal(body.summary.overdue_balance, 1000);
  const listed = body.payments.find((p) => p.id === paymentId);
  assert.ok(listed);
  assert.equal(listed.status, 'reversed');
});

test('unknown student returns 404 Student not found', async () => {
  const res = await send('GET', '/api/students/999999/profile');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Student not found');
});

test('another user cannot read a student profile', async () => {
  const other = await registerCookie('other-profile@example.com');
  const res = await sendAs(other, 'GET', `/api/students/${studentId}/profile`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Student not found');
});
