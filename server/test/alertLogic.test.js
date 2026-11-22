// Pure alert rules: thresholds, wording and ordering. No database or HTTP involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts } from '../src/alertLogic.js';

const TODAY = '2025-06-15';

test('a 15-day overdue Rs 2000 fee gives a high alert to /priority with the amount formatted', () => {
  const alerts = buildAlerts({
    today: TODAY,
    overdueItems: [{ invoice_id: 7, student_name: 'Asha', remaining_balance: 2000, days_overdue: 15 }],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].priority, 'high');
  assert.equal(alerts[0].action_path, '/priority');
  assert.equal(alerts[0].alert_key, 'overdue:7');
  assert.ok(alerts[0].message.includes('2,000'));
});

test('a 3-day overdue fee produces no alert', () => {
  const alerts = buildAlerts({
    today: TODAY,
    overdueItems: [{ invoice_id: 8, student_name: 'Ravi', remaining_balance: 900, days_overdue: 3 }],
  });
  assert.deepEqual(alerts, []);
});

test('three fees due tomorrow produce a medium alert pointing to pending fees', () => {
  const alerts = buildAlerts({ today: TODAY, dueTomorrowCount: 3 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].priority, 'medium');
  assert.equal(alerts[0].action_label, 'View pending fees');
  assert.equal(alerts[0].action_path, '/invoices');
});

test('high alerts come before medium alerts', () => {
  const alerts = buildAlerts({
    today: TODAY,
    dueTomorrowCount: 2,
    overdueItems: [{ invoice_id: 9, student_name: 'Meera', remaining_balance: 500, days_overdue: 30 }],
  });
  assert.deepEqual(alerts.map((a) => a.priority), ['high', 'medium']);
});

test('a bill due today and a forecast shortage each give a high alert', () => {
  const alerts = buildAlerts({
    today: TODAY,
    bills: [{ id: 4, name: 'Internet', amount: 1200, bill_status: 'due_today' }],
    forecast: { summary: { shortage_days: ['2025-06-20', '2025-06-21'] } },
  });
  const keys = alerts.map((a) => a.alert_key);
  assert.ok(keys.includes(`bill:4:${TODAY}`));
  assert.ok(keys.includes('shortage:2025-06-20'));
  assert.ok(alerts.every((a) => a.priority === 'high'));
});

test('a bill due soon gives a medium alert pointing to /bills', () => {
  const alerts = buildAlerts({
    today: TODAY,
    bills: [{ id: 5, name: 'Electricity', amount: 800, bill_status: 'due_soon' }],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alert_key, `bill_due_soon:5:${TODAY}`);
  assert.equal(alerts[0].priority, 'medium');
  assert.equal(alerts[0].action_path, '/bills');
  assert.ok(alerts[0].message.includes('Electricity'));
  assert.ok(alerts[0].message.includes('800'));
});

test('an upcoming bill produces no alert', () => {
  const alerts = buildAlerts({
    today: TODAY,
    bills: [{ id: 6, name: 'Water', amount: 300, bill_status: 'upcoming' }],
  });
  assert.deepEqual(alerts, []);
});

