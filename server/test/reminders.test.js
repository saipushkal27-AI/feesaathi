// Reminders API tests using node:test and fetch against an ephemeral-port server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set env before the app (and therefore db.js) is loaded.
process.env.FEESAATHI_DB = ':memory:';
process.env.JWT_SECRET ??= 'test-secret';

const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie;
let overdueInvoiceId;
let firstReminderId;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await registerCookie('tutor-rem@example.com');

  const student = await send('POST', '/api/students', {
    student_name: 'Arjun Mehta',
    parent_name: 'Kiran Mehta',
    parent_mobile: '9123456780',
    fee_amount: 1000,
    fee_frequency: 'monthly',
  });
  assert.equal(student.status, 201);
  const studentId = (await student.json()).student.id;

  // A past-due invoice, so it is overdue today.
  const invoice = await send('POST', '/api/invoices', {
    student_id: studentId,
    invoice_type: 'monthly',
    billing_period: 'January 2000',
    issue_date: '2000-01-01',
    due_date: '2000-01-10',
    base_amount: 1200,
  });
  assert.equal(invoice.status, 201);
  overdueInvoiceId = (await invoice.json()).invoice.id;
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

test('drafting a reminder for an overdue invoice returns 201 with kind overdue', async () => {
  const res = await send('POST', '/api/reminders/draft', { invoice_id: overdueInvoiceId });
  assert.equal(res.status, 201);
  const { reminder } = await res.json();
  assert.equal(reminder.kind, 'overdue');
  assert.equal(reminder.status, 'drafted');
  assert.equal(reminder.invoice_id, overdueInvoiceId);
  assert.ok(reminder.message.includes('₹1,200'));
  firstReminderId = reminder.id;
});

test('a second draft within 24 hours is refused with 409', async () => {
  const res = await send('POST', '/api/reminders/draft', { invoice_id: overdueInvoiceId });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).message, 'A reminder for this invoice was created in the last 24 hours');
});

test('force:true creates another reminder despite the 24-hour window', async () => {
  const res = await send('POST', '/api/reminders/draft', { invoice_id: overdueInvoiceId, force: true });
  assert.equal(res.status, 201);
});

test('the list is scoped to the invoice and returns the reminders newest first', async () => {
  const res = await send('GET', `/api/reminders?invoiceId=${overdueInvoiceId}`);
  assert.equal(res.status, 200);
  const { reminders } = await res.json();
  assert.equal(reminders.length, 2);
  assert.ok(reminders[0].id > reminders[1].id);
});

test('marking a reminder sent sets status sent and sent_at', async () => {
  const res = await send('POST', `/api/reminders/${firstReminderId}/sent`);
  assert.equal(res.status, 200);
  const { reminder } = await res.json();
  assert.equal(reminder.status, 'sent');
  assert.ok(reminder.sent_at);
});

test('another user cannot draft a reminder for or mark a reminder of someone else', async () => {
  const other = await registerCookie('other-rem@example.com');
  const draft = await sendAs(other, 'POST', '/api/reminders/draft', { invoice_id: overdueInvoiceId });
  assert.equal(draft.status, 404);
  assert.equal((await draft.json()).message, 'Invoice not found');

  const sent = await sendAs(other, 'POST', `/api/reminders/${firstReminderId}/sent`);
  assert.equal(sent.status, 404);
  assert.equal((await sent.json()).message, 'Reminder not found');
});

// AI draft path. fetch is mocked only for the Anthropic URL; local requests from send() still go to the real fetch.
const realFetch = globalThis.fetch;
const ANTHROPIC_PREFIX = 'https://api.anthropic.com/';
const SAME_NUMBERS = "Dear parent, we kindly remind you that Arjun Mehta's fee of ₹1,200 is still pending. Please let us know when payment is possible.";
const CHANGED_NUMBER = "Dear parent, we kindly remind you that Arjun Mehta's fee of ₹1,500 is still pending. Please let us know when payment is possible.";

const anthropicReply = (text) => new Response(
  JSON.stringify({ content: [{ type: 'text', text }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

// Drafts a forced reminder with FEESAATHI_AI_KEY set to key (or unset when undefined). Restores env and fetch in finally.
async function draftWithAi(key, mock) {
  const prevKey = process.env.FEESAATHI_AI_KEY;
  const calls = [];
  if (key === undefined) delete process.env.FEESAATHI_AI_KEY;
  else process.env.FEESAATHI_AI_KEY = key;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(ANTHROPIC_PREFIX)) {
      calls.push({ url: String(url), init });
      return mock();
    }
    return realFetch(url, init);
  };
  try {
    const res = await send('POST', '/api/reminders/draft', { invoice_id: overdueInvoiceId, force: true });
    const body = res.status === 201 ? await res.json() : null;
    return { status: res.status, body, calls };
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.FEESAATHI_AI_KEY;
    else process.env.FEESAATHI_AI_KEY = prevKey;
  }
}

test('without FEESAATHI_AI_KEY the draft uses the template and does not call the model', async () => {
  const { status, body, calls } = await draftWithAi(undefined, () => {
    throw new Error('fetch must not be called without a key');
  });
  assert.equal(status, 201);
  assert.equal(body.source, 'template');
  assert.equal(calls.length, 0);
  assert.ok(body.reminder.message.includes('₹1,200'));
});

test('with a key and numbers kept, the AI text is used as the reminder message', async () => {
  const { status, body, calls } = await draftWithAi('test-key', () => anthropicReply(SAME_NUMBERS));
  assert.equal(status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-api-key'], 'test-key');
  assert.equal(body.source, 'ai');
  assert.equal(body.reminder.message, SAME_NUMBERS);
});

test('with a key but a changed amount, the numbers guard keeps the template', async () => {
  const { status, body, calls } = await draftWithAi('test-key', () => anthropicReply(CHANGED_NUMBER));
  assert.equal(status, 201);
  assert.equal(calls.length, 1);
  assert.equal(body.source, 'template');
  assert.ok(body.reminder.message.includes('₹1,200'));
  assert.ok(!body.reminder.message.includes('1,500'));
});

test('with a key and a failing model call, the draft falls back to the template and still succeeds', async () => {
  const { status, body, calls } = await draftWithAi('test-key', () => {
    throw new Error('network down');
  });
  assert.equal(status, 201);
  assert.equal(calls.length, 1);
  assert.equal(body.source, 'template');
  assert.ok(body.reminder.message.includes('₹1,200'));
});

