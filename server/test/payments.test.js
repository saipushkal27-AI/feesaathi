// Payments API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let invoiceId;
let firstPaymentId;
let secondPaymentId;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-pay@example.com');

  const student = await send('POST', '/api/students', {
    student_name: 'Riya Sharma',
    parent_name: 'Anita Sharma',
    parent_mobile: '9876543210',
    fee_amount: 1000,
    fee_frequency: 'monthly',
  });
  const studentId = (await student.json()).student.id;

  const invoice = await send('POST', '/api/invoices', {
    student_id: studentId,
    invoice_type: 'monthly',
    billing_period: 'November 2099',
    issue_date: '2099-03-01',
    due_date: '2099-03-31',
    base_amount: 1000,
  });
  assert.equal(invoice.status, 201);
  invoiceId = (await invoice.json()).invoice.id;
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

test('a payment above the remaining balance returns 400 with errors.amount', async () => {
  const res = await send('POST', '/api/payments', { invoice_id: invoiceId, amount: 1500, method: 'cash' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errors.amount, 'Amount exceeds remaining balance');
});

test('a payment within the balance is recorded with a created audit row', async () => {
  const res = await send('POST', '/api/payments', {
    invoice_id: invoiceId,
    amount: 400,
    method: 'upi',
    reference: 'UPI-1',
  });
  assert.equal(res.status, 201);
  const { payment, invoice } = await res.json();
  assert.equal(payment.status, 'active');
  assert.equal(invoice.remaining_balance, 600);
  assert.equal(invoice.status, 'partially_paid');
  firstPaymentId = payment.id;

  const detail = await (await send('GET', `/api/payments/${firstPaymentId}`)).json();
  assert.equal(detail.audit.length, 1);
  assert.equal(detail.audit[0].action, 'created');
  assert.equal(detail.audit[0].new_amount, 400);
});

test('the same invoice, amount, date and method within 10 minutes is a duplicate', async () => {
  const res = await send('POST', '/api/payments', { invoice_id: invoiceId, amount: 400, method: 'upi' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'Possible duplicate payment');
});

test('allow_duplicate true records the same payment again', async () => {
  const res = await send('POST', '/api/payments', {
    invoice_id: invoiceId,
    amount: 400,
    method: 'upi',
    allow_duplicate: true,
  });
  assert.equal(res.status, 201);
  const { payment, invoice } = await res.json();
  secondPaymentId = payment.id;
  assert.equal(invoice.remaining_balance, 200);
});

test('a correction updates the amount and writes an audit row with old and new amounts', async () => {
  const res = await send('POST', `/api/payments/${secondPaymentId}/correct`, {
    amount: 300,
    reason: 'Receipt typo',
  });
  assert.equal(res.status, 200);
  const { payment, invoice } = await res.json();
  assert.equal(payment.amount, 300);
  assert.equal(invoice.remaining_balance, 300);

  const detail = await (await send('GET', `/api/payments/${secondPaymentId}`)).json();
  const corrected = detail.audit.find((a) => a.action === 'corrected');
  assert.ok(corrected);
  assert.equal(corrected.old_amount, 400);
  assert.equal(corrected.new_amount, 300);
  assert.equal(corrected.reason, 'Receipt typo');
});

test('a correction above the invoice total minus other active payments is refused', async () => {
  const res = await send('POST', `/api/payments/${secondPaymentId}/correct`, {
    amount: 700,
    reason: 'Too high',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errors.amount, 'Amount exceeds remaining balance');
});

test('a reversed payment no longer counts toward paid', async () => {
  const res = await send('POST', `/api/payments/${secondPaymentId}/reverse`, { reason: 'Bounced' });
  assert.equal(res.status, 200);
  const { payment, invoice } = await res.json();
  assert.equal(payment.status, 'reversed');
  assert.equal(invoice.paid_amount, 400);
  assert.equal(invoice.remaining_balance, 600);
  assert.equal(invoice.status, 'partially_paid');
});

test('reversing an already reversed payment returns 409', async () => {
  const res = await send('POST', `/api/payments/${secondPaymentId}/reverse`, { reason: 'Again' });
  assert.equal(res.status, 409);
});

test('the reversal is recorded in the audit trail with the old amount', async () => {
  const detail = await (await send('GET', `/api/payments/${secondPaymentId}`)).json();
  const reversed = detail.audit.find((a) => a.action === 'reversed');
  assert.ok(reversed);
  assert.equal(reversed.old_amount, 300);
});

test('cancel is refused while the invoice has an active payment', async () => {
  const res = await send('POST', `/api/invoices/${invoiceId}/cancel`);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'Reverse payments before cancelling');
});

test('a payment on another user\'s invoice returns 404', async () => {
  const other = await registerCookie('other-pay@example.com');
  const res = await sendAs(other, 'POST', '/api/payments', { invoice_id: invoiceId, amount: 100, method: 'cash' });
  assert.equal(res.status, 404);
});

test('a payment on a draft invoice is refused', async () => {
  const studentRes = await send('POST', '/api/students', {
    student_name: 'Draft Student',
    parent_name: 'Parent',
    parent_mobile: '9876500000',
    fee_amount: 500,
    fee_frequency: 'monthly',
  });
  const studentId = (await studentRes.json()).student.id;
  const draftRes = await send('POST', '/api/invoices', {
    student_id: studentId,
    invoice_type: 'monthly',
    billing_period: 'December 2099',
    issue_date: '2099-04-01',
    due_date: '2099-04-30',
    base_amount: 500,
    status: 'draft',
  });
  const draftId = (await draftRes.json()).invoice.id;

  const res = await send('POST', '/api/payments', { invoice_id: draftId, amount: 100, method: 'cash' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.invoice_id);
});

test('listing payments by invoice includes reversed payments with an audit count', async () => {
  const res = await send('GET', `/api/payments?invoiceId=${invoiceId}`);
  assert.equal(res.status, 200);
  const { payments } = await res.json();
  assert.equal(payments.length, 2);
  const reversed = payments.find((p) => p.id === secondPaymentId);
  assert.equal(reversed.status, 'reversed');
  assert.ok(reversed.audit_count >= 3);
});
