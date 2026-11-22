// Pure tests for the FeeSaathi AI helpers (no database, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, answerFor, buildPhrasingPrompt } from '../src/aiLogic.js';

test('detectIntent maps "who has not paid" to overdue', () => {
  assert.equal(detectIntent('who has not paid'), 'overdue');
});

test('detectIntent maps a collection question to collected_month', () => {
  assert.equal(detectIntent('how much did I collect this month'), 'collected_month');
});

test('detectIntent maps a cash question to forecast', () => {
  assert.equal(detectIntent('will I have enough money next month'), 'forecast');
});

test('detectIntent returns unclear for an empty question', () => {
  assert.equal(detectIntent(''), 'unclear');
});

test('answerFor overdue names both students and gives the total in rupees', () => {
  const facts = {
    overdue_count: 2,
    overdue_total: 4500,
    overdue_items: [
      { student_name: 'Asha', remaining_balance: 3000, days_overdue: 12 },
      { student_name: 'Ravi', remaining_balance: 1500, days_overdue: 5 },
    ],
  };
  const answer = answerFor('overdue', facts);
  assert.ok(answer.includes('Asha'));
  assert.ok(answer.includes('Ravi'));
  assert.ok(answer.includes('₹4,500'));
});

test('buildPhrasingPrompt includes the answer text', () => {
  const answer = 'You have collected ₹3,000 this month.';
  const prompt = buildPhrasingPrompt(answer, { received_this_month: 3000 });
  assert.ok(prompt.user.includes(answer));
  assert.equal(typeof prompt.system, 'string');
});
