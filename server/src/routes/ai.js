// FeeSaathi AI chat: answers come from backend calculations. The model, when configured, only rephrases them.
// The key is read from process.env only and is never returned. Mounted at /api/ai behind requireAuth.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { round2, todayIso } from '../invoiceLogic.js';
import { billStatusFor, addDays } from '../billLogic.js';
import { buildForecast, summarize } from '../forecastLogic.js';
import { invoiceView } from './invoices.js';
import { detectIntent, answerFor, factsUsedFor, buildPhrasingPrompt, numbersMatch } from '../aiLogic.js';

const router = Router();
router.use(requireAuth);

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const TOP_OVERDUE = 5;

const aiKey = () => process.env.FEESAATHI_AI_KEY?.trim() || '';

// Whole UTC days for a YYYY-MM-DD string (same approach as priority.js).
const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Facts the answers may use. Built from the same rules as the dashboard, bills, expenses and forecast routes.
function loadFacts(db, userId, today) {
  const month = today.slice(0, 7);
  const weekEnd = addDays(today, 6);
  const todayDay = dayNumber(today);

  const received = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE user_id = ? AND status = 'active' AND substr(payment_date, 1, 7) = ?
    `)
    .get(userId, month).total;

  const students = new Map(
    db.prepare('SELECT id, student_name FROM students WHERE user_id = ?').all(userId).map((s) => [s.id, s]),
  );

  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let upcoming = 0;
  const overdueItems = [];
  for (const row of db.prepare('SELECT * FROM invoices WHERE user_id = ?').all(userId)) {
    const inv = invoiceView(db, row);
    if (inv.status === 'cancelled') continue;
    if (row.status !== 'draft') outstanding += inv.remaining_balance;
    if (inv.status === 'overdue') overdue += inv.remaining_balance;
    if (inv.remaining_balance > 0 && inv.due_date >= today && inv.due_date <= weekEnd) upcoming += 1;
    if (inv.remaining_balance > 0 && inv.status === 'overdue') {
      overdueCount += 1;
      overdueItems.push({
        student_name: students.get(inv.student_id)?.student_name ?? null,
        remaining_balance: round2(inv.remaining_balance),
        days_overdue: todayDay - dayNumber(inv.due_date),
      });
    }
  }
  overdueItems.sort((a, b) => b.days_overdue - a.days_overdue || b.remaining_balance - a.remaining_balance);

  const bills = { due_today: 0, overdue: 0, due_soon: 0, upcoming_total: 0 };
  const horizon = addDays(today, 30);
  for (const bill of db.prepare("SELECT * FROM bills WHERE user_id = ? AND status = 'upcoming'").all(userId)) {
    const derived = billStatusFor({ status: bill.status, dueDate: bill.due_date, today });
    if (derived === 'due_today') bills.due_today += 1;
    else if (derived === 'overdue') bills.overdue += 1;
    else if (derived === 'due_soon') bills.due_soon += 1;
    if (bill.due_date >= today && bill.due_date <= horizon) bills.upcoming_total += bill.amount;
  }
  bills.upcoming_total = round2(bills.upcoming_total);

  const expensesMonth = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
      WHERE user_id = ? AND status = 'active' AND substr(expense_date, 1, 7) = ?
    `)
    .get(userId, month).total;

  // Forecast inputs, mirroring forecast.js (openingCash, assumptionsFor, loadInputs).
  const cashRow = db.prepare('SELECT opening_cash FROM cash_settings WHERE user_id = ?').get(userId);
  const profile = db.prepare('SELECT opening_cash_balance FROM tutor_profiles WHERE user_id = ?').get(userId);
  const opening = cashRow ? cashRow.opening_cash : (profile ? profile.opening_cash_balance : 0);
  const assumptionRow = db
    .prepare('SELECT collection_rate, expense_factor FROM cash_assumptions WHERE user_id = ?')
    .get(userId);
  const assumptions = {
    collection_rate: assumptionRow?.collection_rate ?? 1,
    expense_factor: assumptionRow?.expense_factor ?? 1,
  };
  const full = buildForecast({
    today,
    horizonDays: 90,
    openingCash: opening,
    invoices: db.prepare('SELECT * FROM invoices WHERE user_id = ?').all(userId),
    payments: db.prepare('SELECT * FROM payments WHERE user_id = ?').all(userId),
    bills: db.prepare('SELECT * FROM bills WHERE user_id = ?').all(userId),
    expenses: db.prepare('SELECT * FROM expenses WHERE user_id = ?').all(userId),
    students: db.prepare('SELECT * FROM students WHERE user_id = ?').all(userId),
    assumptions,
  });
  const next30 = summarize(full.days.slice(0, 30));

  return {
    received_this_month: round2(received),
    outstanding_total: round2(outstanding),
    overdue_total: round2(overdue),
    overdue_count: overdueCount,
    overdue_items: overdueItems.slice(0, TOP_OVERDUE),
    upcoming_due_count: upcoming,
    bills,
    expenses_month_total: round2(expensesMonth),
    forecast: {
      closing_30: round2(next30.closing_end),
      min_balance: round2(next30.min_balance),
      min_balance_date: next30.min_balance_date,
      shortage_days_count: next30.shortage_days.length,
    },
  };
}

// Asks the model to rephrase. Returns the text, or null on any failure (the caller then falls back).
async function phrase(key, answer, facts) {
  try {
    const { system, user } = buildPhrasingPrompt(answer, facts);
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.FEESAATHI_AI_MODEL || DEFAULT_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

// Sends a plain prompt to the model and returns the trimmed text, or null on any failure.
export async function phraseText(key, prompt) {
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.FEESAATHI_AI_MODEL || DEFAULT_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

export { numbersMatch };


// GET /api/ai/status
router.get('/status', (req, res) => res.json({ ai_available: aiKey() !== '' }));

// POST /api/ai/chat  body: { question }  (3 to 500 characters)
router.post('/chat', async (req, res, next) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (question.length < 3 || question.length > 500) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: { question: 'Question must be between 3 and 500 characters' },
      });
    }

    const intent = detectIntent(question);
    const facts = loadFacts(getDb(), req.userId, todayIso());
    const calculated = answerFor(intent, facts);

    let answer = calculated;
    let source = 'calculated';
    const key = aiKey();
    if (key) {
      const phrased = await phrase(key, calculated, facts);
      if (phrased && numbersMatch(calculated, phrased)) {
        answer = phrased;
        source = 'ai';
      }
    }

    return res.json({
      answer,
      intent,
      source,
      facts_used: factsUsedFor(intent),
      ai_available: key !== '',
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
