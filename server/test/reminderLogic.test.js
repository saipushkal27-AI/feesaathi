// Pure reminder rules: kind selection and draft text. No database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseReminderKind, draftReminder } from '../src/reminderLogic.js';

const base = { dueDate: '2099-03-31', today: '2099-03-28', remainingBalance: 500, paidAmount: 0 };

test('an overdue invoice needs an overdue reminder', () => {
  assert.equal(chooseReminderKind({ ...base, status: 'overdue' }), 'overdue');
});

test('a part-paid invoice with a balance needs a partial reminder', () => {
  assert.equal(
    chooseReminderKind({ ...base, status: 'partially_paid', paidAmount: 300, remainingBalance: 700 }),
    'partial',
  );
});

test('an invoice due within 3 days needs an upcoming reminder', () => {
  assert.equal(chooseReminderKind({ ...base, status: 'pending' }), 'upcoming');
  assert.equal(chooseReminderKind({ ...base, status: 'pending', today: '2099-03-31' }), 'upcoming');
});

test('an invoice due more than 3 days away needs no reminder', () => {
  assert.equal(chooseReminderKind({ ...base, status: 'pending', today: '2099-03-27' }), null);
});

test('paid, cancelled and draft invoices need no reminder', () => {
  assert.equal(chooseReminderKind({ ...base, status: 'paid', remainingBalance: 0, paidAmount: 1000 }), null);
  assert.equal(chooseReminderKind({ ...base, status: 'cancelled' }), null);
  assert.equal(chooseReminderKind({ ...base, status: 'draft' }), null);
});

test('an overdue draft message contains the rupee amount remaining', () => {
  const text = draftReminder({
    kind: 'overdue',
    studentName: 'Riya Sharma',
    billingPeriod: 'November 2099',
    dueDate: '2099-03-31',
    remainingBalance: 1500,
  });
  assert.ok(text.includes('₹1,500'), text);
  assert.ok(text.includes("Riya Sharma's"));
});
