// Pure forecast tests: no server, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../src/forecastLogic.js';

const TODAY = '2030-01-01';

const bill = (overrides = {}) => ({
  id: 1,
  status: 'upcoming',
  amount: 0,
  due_date: '2030-01-05',
  recurrence: 'one_time',
  recurrence_interval_days: null,
  ...overrides,
});

const invoice = (overrides = {}) => ({
  id: 1,
  student_id: 1,
  total_amount: 0,
  due_date: '2030-01-15',
  status: 'pending',
  cancelled_at: null,
  ...overrides,
});

test('opening cash plus dated income less dated bills gives the expected closing balance', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 10000,
    invoices: [invoice({ total_amount: 15000 })],
    bills: [
      bill({ id: 1, name: 'Rent', amount: 5000, due_date: '2030-01-05', category: 'rent' }),
      bill({ id: 2, name: 'Internet and electricity', amount: 1000, due_date: '2030-01-10', category: 'internet' }),
      bill({ id: 3, name: 'Other', amount: 2000, due_date: '2030-01-20', category: 'other' }),
    ],
  });
  assert.equal(forecast.summary.closing_end, 17000);
  assert.equal(forecast.days.length, 30);
});

test('a rent bill due before income produces a shortage with the lowest balance and its date', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 10000,
    invoices: [invoice({ total_amount: 15000, due_date: '2030-01-20' })],
    bills: [bill({ amount: 20000, due_date: '2030-01-05', category: 'rent' })],
  });
  assert.ok(forecast.summary.shortage_days.includes('2030-01-05'));
  assert.equal(forecast.summary.min_balance, -10000);
  assert.equal(forecast.summary.min_balance_date, '2030-01-05');
});

test('an overdue invoice is placed on today and flagged', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 0,
    invoices: [invoice({ id: 7, total_amount: 3000, due_date: '2029-12-20' })],
  });
  assert.equal(forecast.days[0].incoming_expected, 3000);
  assert.equal(forecast.days[0].closing_balance, 3000);
  assert.deepEqual(forecast.labels.overdue_invoice_ids, [7]);
});

test('estimated fee income is multiplied by the collection rate and labelled estimated', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 0,
    students: [{ id: 1, status: 'active', fee_amount: 1000, fee_frequency: 'monthly' }],
    assumptions: { collection_rate: 0.5 },
  });
  assert.equal(forecast.days[0].incoming_estimated, 500);
  assert.equal(forecast.labels.incoming_estimated, 'estimated');
});

test('a month already invoiced for a student gets no estimated fee', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 0,
    invoices: [invoice({ student_id: 1, total_amount: 1000, due_date: '2030-01-01' })],
    students: [{ id: 1, status: 'active', fee_amount: 1000, fee_frequency: 'monthly' }],
  });
  assert.equal(forecast.days[0].incoming_estimated, 0);
});

test('estimated spend is the 30-day average per category spread over the window', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 1000,
    expenses: [{ id: 1, status: 'active', category: 'internet', amount: 300, expense_date: '2029-12-20', bill_payment_id: null }],
  });
  assert.equal(forecast.summary.closing_end, 700);
  assert.equal(forecast.labels.outflow_expenses, 'estimated');
});

test('paid bills and draft invoices contribute nothing future', () => {
  const forecast = buildForecast({
    today: TODAY,
    horizonDays: 30,
    openingCash: 0,
    invoices: [invoice({ total_amount: 900, status: 'draft' })],
    bills: [bill({ amount: 400, status: 'paid' })],
  });
  assert.equal(forecast.summary.closing_end, 0);
});
