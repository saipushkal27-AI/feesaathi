// Priority list and dashboard summary tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let overdue15Id;
let overdue5Id;
let paidId;
let cancelledId;
let draftId;

// Local calendar date `days` from today as YYYY-MM-DD (negative = past).
function daysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-pri@example.com');

  const student = await send('POST', '/api/students', {
    student_name: 'Diya Rao',
    parent_name: 'Meera Rao',
    parent_mobile: '9123456781',
    fee_amount: 1000,
    fee_frequency: 'monthly',
  });
  assert.equal(student.status, 201);
  const studentId = (await student.json()).student.id;

  const createInvoice = async (fields) => {
    const res = await send('POST', '/api/invoices', {
      student_id: studentId,
      invoice_type: 'monthly',
      billing_period: 'Test period',
      ...fields,
    });
    assert.equal(res.status, 201);
    return (await res.json()).invoice.id;
  };

  // 15 days overdue, 2000 unpaid.
  overdue15Id = await createInvoice({ base_amount: 2000, issue_date: daysFromToday(-45), due_date: daysFromToday(-15) });
  // 5 days overdue, 1000 unpaid.
  overdue5Id = await createInvoice({ base_amount: 1000, issue_date: daysFromToday(-35), due_date: daysFromToday(-5) });
  // Overdue on its due date but fully paid: not listed.
  paidId = await createInvoice({ base_amount: 500, issue_date: daysFromToday(-40), due_date: daysFromToday(-20) });
  const pay = await send('POST', '/api/payments', {
    invoice_id: paidId,
    amount: 500,
    method: 'cash',
    payment_date: daysFromToday(0),
  });
  assert.ok(pay.ok);
  // Past due but cancelled: excluded from every money total.
  cancelledId = await createInvoice({ base_amount: 300, issue_date: daysFromToday(-20), due_date: daysFromToday(-10) });
  const cancel = await send('POST', `/api/invoices/${cancelledId}/cancel`);
  assert.equal(cancel.status, 200);
  // Stored as a draft and not yet due: excluded from outstanding_total.
  draftId = await createInvoice({ base_amount: 700, status: 'draft', issue_date: daysFromToday(0), due_date: daysFromToday(3) });
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

test('priority lists overdue invoices most overdue first, with suggested actions', async () => {
  const res = await send('GET', '/api/priority');
  assert.equal(res.status, 200);
  const { items, total_outstanding_overdue } = await res.json();
  assert.deepEqual(items.map((i) => i.invoice_id), [overdue15Id, overdue5Id]);

  assert.equal(items[0].days_overdue, 15);
  assert.equal(items[0].remaining_balance, 2000);
  assert.equal(items[0].suggested_action, 'Send payment reminder today');
  assert.equal(items[0].last_reminder_at, null);
  assert.equal(items[0].student_name, 'Diya Rao');

  assert.equal(items[1].days_overdue, 5);
  assert.equal(items[1].remaining_balance, 1000);
  assert.equal(items[1].suggested_action, 'Send a gentle reminder');

  assert.equal(total_outstanding_overdue, 3000);
});

test('priority does not list paid, cancelled or draft invoices', async () => {
  const { items } = await (await send('GET', '/api/priority')).json();
  const ids = items.map((i) => i.invoice_id);
  assert.ok(!ids.includes(paidId));
  assert.ok(!ids.includes(cancelledId));
  assert.ok(!ids.includes(draftId));
});

test('dashboard outstanding_total equals the remaining balances of non-cancelled, non-draft invoices', async () => {
  const res = await send('GET', '/api/dashboard/summary');
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.equal(summary.today, daysFromToday(0));

  const { invoices } = await (await send('GET', '/api/invoices')).json();
  const expected = invoices
    .filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
    .reduce((sum, i) => sum + i.remaining_balance, 0);
  assert.equal(summary.outstanding_total, expected);
  assert.equal(summary.outstanding_total, 3000);
});

test('a cancelled invoice is excluded from outstanding_total and overdue_total', async () => {
  const summary = await (await send('GET', '/api/dashboard/summary')).json();
  assert.equal(summary.outstanding_total, 3000);
  assert.equal(summary.overdue_total, 3000);
});
