// Pure invoice rules: no server or database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotal, computeStatus, nextInvoiceNumber, remainingBalance, todayIso } from '../src/invoiceLogic.js';

const FUTURE = '2099-01-01';
const PAST = '2000-01-10';
const TODAY = '2025-06-15';

test('total adds additional charges and subtracts discount', () => {
  assert.deepEqual(computeTotal({ base_amount: 1000, additional_charges: 200, discount: 100 }), { total: 1100 });
});

test('total is rounded to 2 decimal places', () => {
  assert.deepEqual(computeTotal({ base_amount: 0.1, additional_charges: 0.2, discount: 0 }), { total: 0.3 });
});

test('discount larger than base plus additional is rejected', () => {
  const result = computeTotal({ base_amount: 500, additional_charges: 0, discount: 600 });
  assert.equal(typeof result.error, 'string');
  assert.equal(result.total, undefined);
});

test('cancelled wins over every other status', () => {
  const status = computeStatus({ total: 100, paid: 0, dueDate: PAST, cancelled: true, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'cancelled');
});

test('fully paid is paid even when past due', () => {
  const status = computeStatus({ total: 100, paid: 100, dueDate: PAST, cancelled: false, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'paid');
});

test('past due with balance remaining is overdue, even after a partial payment', () => {
  const status = computeStatus({ total: 100, paid: 40, dueDate: PAST, cancelled: false, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'overdue');
});

test('unpaid and past due is overdue', () => {
  const status = computeStatus({ total: 100, paid: 0, dueDate: PAST, cancelled: false, today: TODAY, storedStatus: 'sent' });
  assert.equal(status, 'overdue');
});

test('due today is not overdue', () => {
  const status = computeStatus({ total: 100, paid: 0, dueDate: TODAY, cancelled: false, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'pending');
});

test('partial payment before the due date is partially_paid', () => {
  const status = computeStatus({ total: 100, paid: 40, dueDate: FUTURE, cancelled: false, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'partially_paid');
});

test('stored draft and sent are kept when nothing is paid and not yet due', () => {
  assert.equal(computeStatus({ total: 100, paid: 0, dueDate: FUTURE, cancelled: false, today: TODAY, storedStatus: 'draft' }), 'draft');
  assert.equal(computeStatus({ total: 100, paid: 0, dueDate: FUTURE, cancelled: false, today: TODAY, storedStatus: 'sent' }), 'sent');
});

test('otherwise an unpaid invoice is pending', () => {
  const status = computeStatus({ total: 100, paid: 0, dueDate: FUTURE, cancelled: false, today: TODAY, storedStatus: 'pending' });
  assert.equal(status, 'pending');
});

test('invoice numbers are FS-YYYY-NNNN and follow the existing sequence', () => {
  assert.equal(nextInvoiceNumber(0, 2025), 'FS-2025-0001');
  assert.equal(nextInvoiceNumber(1, 2025), 'FS-2025-0002');
  assert.equal(nextInvoiceNumber(41, '2026'), 'FS-2026-0042');
});

test('remaining balance is total minus paid, rounded to 2 decimal places', () => {
  assert.equal(remainingBalance(100.1, 0.1), 100);
  assert.equal(remainingBalance(1100, 300), 800);
});

test('todayIso formats the local calendar date as YYYY-MM-DD', () => {
  assert.equal(todayIso(new Date(2025, 10, 3, 9, 30)), '2025-11-03');
});
