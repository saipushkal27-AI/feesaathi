// Bill rule tests: pure functions, no server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nextDueDate, billStatusFor } = await import('../src/billLogic.js');

test('monthly from Jan 31 clamps to Feb 28 in a non-leap year', () => {
  assert.equal(nextDueDate('2025-01-31', 'monthly'), '2025-02-28');
});

test('monthly from Jan 31 in a leap year gives Feb 29', () => {
  assert.equal(nextDueDate('2024-01-31', 'monthly'), '2024-02-29');
});

test('weekly adds seven days across a month boundary', () => {
  assert.equal(nextDueDate('2025-01-28', 'weekly'), '2025-02-04');
});

test('quarterly adds three months', () => {
  assert.equal(nextDueDate('2025-01-15', 'quarterly'), '2025-04-15');
});

test('yearly from Feb 29 clamps to Feb 28', () => {
  assert.equal(nextDueDate('2024-02-29', 'yearly'), '2025-02-28');
});

test('custom adds the interval in days', () => {
  assert.equal(nextDueDate('2025-03-01', 'custom', 10), '2025-03-11');
});

test('one_time has no next due date', () => {
  assert.equal(nextDueDate('2025-03-01', 'one_time'), null);
});

test('billStatusFor: overdue, due_today, due_soon and upcoming', () => {
  const today = '2025-05-05';
  assert.equal(billStatusFor({ status: 'upcoming', dueDate: '2025-05-01', today }), 'overdue');
  assert.equal(billStatusFor({ status: 'upcoming', dueDate: '2025-05-05', today }), 'due_today');
  assert.equal(billStatusFor({ status: 'upcoming', dueDate: '2025-05-08', today }), 'due_soon');
  assert.equal(billStatusFor({ status: 'upcoming', dueDate: '2025-05-09', today }), 'upcoming');
});

test('billStatusFor keeps paid and cancelled as stored', () => {
  const today = '2025-05-05';
  assert.equal(billStatusFor({ status: 'paid', dueDate: '2025-05-01', today }), 'paid');
  assert.equal(billStatusFor({ status: 'cancelled', dueDate: '2025-05-05', today }), 'cancelled');
});
