// Cash forecast routes: GET forecast, PUT assumptions, POST simulate. Reads are user-scoped.
// Simulation runs on in-memory copies; nothing is written to invoices, payments, bills, expenses or students.
import { Router } from 'express';
import { getDb } from '../db.js';
import { buildForecast, summarize } from '../forecastLogic.js';
import { todayIso } from '../invoiceLogic.js';
import { addDays } from '../billLogic.js';
import { isIsoDate, toNumber } from './invoices.js';
import { CATEGORIES } from './expenses.js';

const router = Router();
const MAX_HORIZON = 90;
const HORIZONS = [30, 60, 90];
const SCENARIO_TYPES = ['delay_invoice', 'delay_invoices', 'remove_student', 'expense_increase', 'bill_earlier'];

// Raised while applying a scenario; the route turns it into a JSON response.
class ScenarioError extends Error {
  constructor(status, body) {
    super(body.message || 'Invalid scenario');
    this.status = status;
    this.body = body;
  }
}

const invalid = (message) => new ScenarioError(400, { error: 'Validation failed', errors: { scenarios: message } });

// Horizon from a query or body value: 30, 60 or 90 (default 90). Returns null when invalid.
function parseHorizon(raw) {
  if (raw === undefined) return 90;
  const n = Number(raw);
  return HORIZONS.includes(n) ? n : null;
}

// Stored opening cash: cash_settings first, then the onboarding profile value, else 0.
function openingCash(db, userId) {
  const row = db.prepare('SELECT opening_cash FROM cash_settings WHERE user_id = ?').get(userId);
  if (row) return { amount: row.opening_cash, source: 'cash_settings' };
  const profile = db.prepare('SELECT opening_cash_balance FROM tutor_profiles WHERE user_id = ?').get(userId);
  if (profile) return { amount: profile.opening_cash_balance, source: 'onboarding' };
  return { amount: 0, source: 'default' };
}

function assumptionsFor(db, userId) {
  const row = db.prepare('SELECT collection_rate, expense_factor FROM cash_assumptions WHERE user_id = ?').get(userId);
  return { collection_rate: row?.collection_rate ?? 1, expense_factor: row?.expense_factor ?? 1 };
}

// The tutor's rows that feed the forecast.
function loadInputs(db, userId) {
  return {
    invoices: db.prepare('SELECT * FROM invoices WHERE user_id = ?').all(userId),
    payments: db.prepare('SELECT * FROM payments WHERE user_id = ?').all(userId),
    bills: db.prepare('SELECT * FROM bills WHERE user_id = ?').all(userId),
    expenses: db.prepare('SELECT * FROM expenses WHERE user_id = ?').all(userId),
    students: db.prepare('SELECT * FROM students WHERE user_id = ?').all(userId),
  };
}

function runForecast(inputs, { today, cash, assumptions }) {
  return buildForecast({ today, horizonDays: MAX_HORIZON, openingCash: cash, ...inputs, assumptions });
}

// Summaries for 30, 60 and 90 days, all taken from the same day rows.
function summaryByHorizon(days) {
  return Object.fromEntries(HORIZONS.map((h) => [h, summarize(days.slice(0, h))]));
}

// GET /api/forecast?horizon=30|60|90
router.get('/', (req, res) => {
  const horizon = parseHorizon(req.query.horizon);
  if (!horizon) {
    return res.status(400).json({ error: 'Validation failed', errors: { horizon: 'Horizon must be 30, 60 or 90' } });
  }

  const db = getDb();
  const today = todayIso();
  const cash = openingCash(db, req.userId);
  const assumptions = assumptionsFor(db, req.userId);
  const full = runForecast(loadInputs(db, req.userId), { today, cash: cash.amount, assumptions });
  const days = full.days.slice(0, horizon);

  return res.json({
    horizon,
    assumptions_used: { ...assumptions, opening_cash_source: cash.source },
    opening_cash: cash.amount,
    days,
    summary: summarize(days),
    summary_by_horizon: summaryByHorizon(full.days),
    received_to_date: full.received_to_date,
    labels: full.labels,
  });
});

// PUT /api/forecast/assumptions  body: { opening_cash?, collection_rate?, expense_factor? }
router.put('/assumptions', (req, res) => {
  const body = req.body || {};
  const errors = {};
  const rate = (field, max, label) => {
    if (body[field] === undefined) return null;
    const v = toNumber(body[field]);
    if (!Number.isFinite(v) || v < 0 || v > max) errors[field] = `${label} must be between 0 and ${max}`;
    return v;
  };

  let openingValue = null;
  if (body.opening_cash !== undefined) {
    openingValue = toNumber(body.opening_cash);
    if (!Number.isFinite(openingValue) || openingValue < 0) {
      errors.opening_cash = 'Opening cash must be a number of 0 or more';
    }
  }
  const collection = rate('collection_rate', 1, 'Collection rate');
  const expense = rate('expense_factor', 1.5, 'Expense factor');
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const current = assumptionsFor(db, req.userId);
  db.transaction(() => {
    if (openingValue !== null) {
      db.prepare(`
        INSERT INTO cash_settings (user_id, opening_cash, opening_cash_date, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          opening_cash = excluded.opening_cash,
          opening_cash_date = excluded.opening_cash_date,
          updated_at = excluded.updated_at
      `).run(req.userId, openingValue, todayIso());
    }
    if (collection !== null || expense !== null) {
      const next = {
        collection_rate: collection ?? current.collection_rate,
        expense_factor: expense ?? current.expense_factor,
      };
      db.prepare(`
        INSERT INTO cash_assumptions (user_id, collection_rate, expense_factor, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          collection_rate = excluded.collection_rate,
          expense_factor = excluded.expense_factor,
          updated_at = excluded.updated_at
      `).run(req.userId, next.collection_rate, next.expense_factor);
    }
  })();

  const stored = assumptionsFor(db, req.userId);
  return res.json({
    assumptions: { opening_cash: openingCash(db, req.userId).amount, ...stored },
  });
});

// Looks up an id in a user-scoped list; 404 when it is missing or belongs to someone else.
function findScoped(list, rawId, notFound) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw invalid('Ids must be positive integers');
  const row = list.find((r) => r.id === id);
  if (!row) throw new ScenarioError(404, { message: notFound });
  return row;
}

const wholeDays = (raw) => {
  const n = toNumber(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw invalid('days must be a whole number from 1 to 365');
  return n;
};

const requireDate = (raw, field) => {
  if (!isIsoDate(String(raw ?? ''))) throw invalid(`${field} must be in YYYY-MM-DD format`);
  return String(raw);
};

// Applies one scenario to the copies in `sim` and returns its plain-language sentence.
function applyScenario(s, sim) {
  if (!s || typeof s !== 'object') throw invalid('Each scenario must be an object');
  switch (s.type) {
    case 'delay_invoice': {
      const inv = findScoped(sim.invoices, s.invoice_id, 'Invoice not found');
      const days = wholeDays(s.days);
      inv.due_date = addDays(inv.due_date, days);
      return `Invoice ${inv.invoice_number} moves ${days} days later, to ${inv.due_date}.`;
    }
    case 'delay_invoices': {
      if (!Array.isArray(s.invoice_ids) || s.invoice_ids.length === 0) throw invalid('invoice_ids must be a non-empty list');
      const days = wholeDays(s.days);
      for (const id of s.invoice_ids) {
        const inv = findScoped(sim.invoices, id, 'Invoice not found');
        inv.due_date = addDays(inv.due_date, days);
      }
      return `${s.invoice_ids.length} invoices move ${days} days later.`;
    }
    case 'remove_student': {
      const student = findScoped(sim.students, s.student_id, 'Student not found');
      const from = requireDate(s.from_date, 'from_date');
      student.removed_from = from;
      for (const inv of sim.invoices) {
        if (inv.student_id === student.id && inv.due_date >= from) inv.status = 'cancelled';
      }
      return `${student.student_name} is removed from ${from}: their fee income from that date stops.`;
    }
    case 'expense_increase': {
      const category = s.category ?? null;
      if (category !== null && !CATEGORIES.includes(category)) throw invalid(`Category must be one of ${CATEGORIES.join(', ')}`);
      const percent = toNumber(s.percent);
      if (!Number.isFinite(percent) || percent < -100 || percent > 500) {
        throw invalid('percent must be a number from -100 to 500');
      }
      const from = requireDate(s.from_date, 'from_date');
      sim.adjustments.push({ category, multiplier: 1 + percent / 100, from_date: from });
      const label = category ? category.replace(/_/g, ' ') : 'All';
      const verb = percent < 0 ? 'fall' : 'rise';
      return `${label} expenses ${verb} ${Math.abs(percent)}% from ${from}.`;
    }
    case 'bill_earlier': {
      const bill = findScoped(sim.bills, s.bill_id, 'Bill not found');
      const to = requireDate(s.new_due_date, 'new_due_date');
      if (bill.status !== 'upcoming') throw invalid('Only upcoming bills can be moved');
      if (to >= bill.due_date) throw invalid('new_due_date must be earlier than the current due date');
      const from = bill.due_date;
      bill.due_date = to;
      return `${bill.name} is paid on ${to} instead of ${from}.`;
    }
    default:
      throw invalid(`Scenario type must be one of ${SCENARIO_TYPES.join(', ')}`);
  }
}

function recommendationFor(before, after) {
  if (after.shortage_days.length > 0) {
    return `Cash goes negative on ${after.shortage_days.length} day(s) in this scenario, first on ${after.shortage_days[0]}. Plan to cover it before that date.`;
  }
  if (before.shortage_days.length > 0) {
    return `This scenario clears the shortage; the lowest balance is ${after.min_balance} on ${after.min_balance_date}.`;
  }
  return `No shortage in either case; the lowest projected balance is ${after.min_balance} on ${after.min_balance_date}.`;
}

// POST /api/forecast/simulate  body: { horizon?, scenarios: [...] }
router.post('/simulate', (req, res) => {
  try {
    const body = req.body || {};
    const horizon = parseHorizon(body.horizon);
    if (!horizon) throw invalid('Horizon must be 30, 60 or 90');
    if (!Array.isArray(body.scenarios) || body.scenarios.length === 0 || body.scenarios.length > 20) {
      throw invalid('Provide between 1 and 20 scenarios');
    }

    const db = getDb();
    const today = todayIso();
    const inputs = loadInputs(db, req.userId);
    const cash = openingCash(db, req.userId);
    const assumptions = assumptionsFor(db, req.userId);

    // Copies only; the originals in `inputs` are never changed.
    const sim = {
      invoices: inputs.invoices.map((r) => ({ ...r })),
      students: inputs.students.map((r) => ({ ...r })),
      bills: inputs.bills.map((r) => ({ ...r })),
      adjustments: [],
    };
    const explanation = body.scenarios.map((s) => applyScenario(s, sim));

    const original = runForecast(inputs, { today, cash: cash.amount, assumptions });
    const simulated = runForecast(
      { ...inputs, invoices: sim.invoices, students: sim.students, bills: sim.bills },
      { today, cash: cash.amount, assumptions: { ...assumptions, expense_adjustments: sim.adjustments } },
    );

    const origH = summarize(original.days.slice(0, horizon));
    const simH = summarize(simulated.days.slice(0, horizon));
    const origByH = summaryByHorizon(original.days);
    const simByH = summaryByHorizon(simulated.days);

    return res.json({
      horizon,
      original: { summary_by_horizon: origByH, days: original.days.slice(0, horizon) },
      simulated: { summary_by_horizon: simByH, days: simulated.days.slice(0, horizon) },
      difference: {
        closing_30: round(simByH[30].closing_end - origByH[30].closing_end),
        closing_60: round(simByH[60].closing_end - origByH[60].closing_end),
        closing_90: round(simByH[90].closing_end - origByH[90].closing_end),
        min_balance: round(simH.min_balance - origH.min_balance),
      },
      shortage_before: origH.shortage_days,
      shortage_after: simH.shortage_days,
      explanation,
      recommendation: recommendationFor(origH, simH),
    });
  } catch (err) {
    if (err instanceof ScenarioError) return res.status(err.status).json(err.body);
    throw err;
  }
});

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export default router;
