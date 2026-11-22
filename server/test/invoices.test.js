// Invoices API tests using node:test and fetch against an ephemeral-port server.
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
let invoiceId;
let overdueId;
let draftId;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-inv@example.com');

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

test('create with an additional charge and discount computes the total and numbers it FS-YYYY-0001', async () => {
  const res = await send('POST', '/api/invoices', validInvoice({
    additional_charges: [{ label: 'Books', amount: 200 }],
    discount: 100,
  }));
  assert.equal(res.status, 201);
  const { invoice } = await res.json();
  assert.equal(invoice.invoice_number, 'FS-2099-0001');
  assert.equal(invoice.total_amount, 1100);
  assert.equal(invoice.status, 'pending');
  assert.equal(invoice.remaining_balance, 1100);
  assert.equal(invoice.paid_amount, 0);
  invoiceId = invoice.id;

  const detail = await (await send('GET', `/api/invoices/${invoiceId}`)).json();
  assert.deepEqual(detail.items.map((i) => i.kind), ['base', 'additional']);
});

test('discount larger than base plus additional returns 400 with errors.discount', async () => {
  const res = await send('POST', '/api/invoices', validInvoice({ base_amount: 500, discount: 600 }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.discount);
});

test('the next invoice in the same year is FS-YYYY-0002', async () => {
  const res = await send('POST', '/api/invoices', validInvoice());
  assert.equal(res.status, 201);
  assert.equal((await res.json()).invoice.invoice_number, 'FS-2099-0002');
});

test('the sequence is per year and an invoice past its due date with balance is overdue', async () => {
  const res = await send('POST', '/api/invoices', validInvoice({
    issue_date: '2000-01-01',
    due_date: '2000-01-10',
    base_amount: 300,
  }));
  assert.equal(res.status, 201);
  const { invoice } = await res.json();
  assert.equal(invoice.invoice_number, 'FS-2000-0001');
  assert.equal(invoice.status, 'overdue');
  overdueId = invoice.id;
});

test('a draft can be edited and sent once; sending again is refused', async () => {
  const created = await send('POST', '/api/invoices', validInvoice({ status: 'draft', base_amount: 800 }));
  assert.equal(created.status, 201);
  const draft = (await created.json()).invoice;
  assert.equal(draft.status, 'draft');
  draftId = draft.id;

  const edited = await send('PUT', `/api/invoices/${draftId}`, { base_amount: 900 });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).invoice.total_amount, 900);

  const sent = await send('POST', `/api/invoices/${draftId}/send`);
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).invoice.status, 'sent');

  const again = await send('POST', `/api/invoices/${draftId}/send`);
  assert.equal(again.status, 409);
});

test('an overdue invoice stays overdue after a partial payment', async () => {
  const res = await send('POST', '/api/payments', { invoice_id: overdueId, amount: 100, method: 'cash' });
  assert.equal(res.status, 201);
  const { invoice } = await res.json();
  assert.equal(invoice.status, 'overdue');
  assert.equal(invoice.remaining_balance, 200);
});

test('a partial payment gives partially_paid', async () => {
  const res = await send('POST', '/api/payments', { invoice_id: invoiceId, amount: 300, method: 'upi' });
  assert.equal(res.status, 201);
  const { invoice } = await res.json();
  assert.equal(invoice.status, 'partially_paid');
  assert.equal(invoice.remaining_balance, 800);
});

test('paying the remaining balance gives paid', async () => {
  const res = await send('POST', '/api/payments', { invoice_id: invoiceId, amount: 800, method: 'cash' });
  assert.equal(res.status, 201);
  const { invoice } = await res.json();
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.remaining_balance, 0);
});

test('a cancelled invoice is excluded from outstanding totals', async () => {
  const listBefore = await (await send('GET', `/api/invoices?studentId=${studentId}`)).json();
  const outstandingBefore = listBefore.outstanding_total;

  const created = await send('POST', '/api/invoices', validInvoice({ base_amount: 500 }));
  const toCancel = (await created.json()).invoice;
  const withNew = await (await send('GET', `/api/invoices?studentId=${studentId}`)).json();
  assert.equal(withNew.outstanding_total, outstandingBefore + 500);

  const cancelled = await send('POST', `/api/invoices/${toCancel.id}/cancel`);
  assert.equal(cancelled.status, 200);
  const cancelledBody = (await cancelled.json()).invoice;
  assert.equal(cancelledBody.status, 'cancelled');
  assert.ok(cancelledBody.cancelled_at);

  const after = await (await send('GET', `/api/invoices?studentId=${studentId}`)).json();
  assert.equal(after.outstanding_total, outstandingBefore);
});

test('cancel is refused while the invoice has active payments', async () => {
  const res = await send('POST', `/api/invoices/${invoiceId}/cancel`);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'Reverse payments before cancelling');
});

test('PUT is refused once an invoice has payments', async () => {
  const res = await send('PUT', `/api/invoices/${invoiceId}`, { base_amount: 50 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'Invoice has payments; create a correction instead');
});

test('list filters by derived status', async () => {
  const res = await send('GET', '/api/invoices?status=overdue');
  assert.equal(res.status, 200);
  const { invoices } = await res.json();
  assert.ok(invoices.length >= 1);
  assert.ok(invoices.every((i) => i.status === 'overdue'));
  assert.ok(invoices.some((i) => i.id === overdueId));

  const bad = await send('GET', '/api/invoices?status=nonsense');
  assert.equal(bad.status, 400);
});

test('GET of an unknown invoice returns 404', async () => {
  const res = await send('GET', '/api/invoices/999999');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, 'Invoice not found');
});

test('another user cannot read an invoice', async () => {
  const other = await registerCookie('other-inv@example.com');
  const res = await sendAs(other, 'GET', `/api/invoices/${invoiceId}`);
  assert.equal(res.status, 404);
});
