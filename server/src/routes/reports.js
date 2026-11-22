// Reports: read-only, user-scoped exports (JSON or CSV). Mounted at /api/reports behind requireAuth,
// so req.userId is the tutor. Nothing is written here.
import { Router } from 'express';
import { getDb } from '../db.js';
import { buildForecast, summarize } from '../forecastLogic.js';
import { computeStatus, round2, todayIso } from '../invoiceLogic.js';
import { invoiceView, isIsoDate } from './invoices.js';

const router = Router();
const FAR_FUTURE = '9999-12-31';

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Stored opening cash: cash_settings first, then the onboarding profile value, else 0.
function openingCash(db, userId) {
  const row = db.prepare('SELECT opening_cash FROM cash_settings WHERE user_id = ?').get(userId);
  if (row) return row.opening_cash;
  const profile = db.prepare('SELECT opening_cash_balance FROM tutor_profiles WHERE user_id = ?').get(userId);
  return profile ? profile.opening_cash_balance : 0;
}

function assumptionsFor(db, userId) {
  const row = db.prepare('SELECT collection_rate, expense_factor FROM cash_assumptions WHERE user_id = ?').get(userId);
  return { collection_rate: row?.collection_rate ?? 1, expense_factor: row?.expense_factor ?? 1 };
}

// Same forecast the /api/forecast route builds (90 days, full window). Shared with alerts.
export function forecastFor(db, userId, today) {
  const q = (sql) => db.prepare(sql).all(userId);
  return buildForecast({
    today,
    horizonDays: 90,
    openingCash: openingCash(db, userId),
    invoices: q('SELECT * FROM invoices WHERE user_id = ?'),
    payments: q('SELECT * FROM payments WHERE user_id = ?'),
    bills: q('SELECT * FROM bills WHERE user_id = ?'),
    expenses: q('SELECT * FROM expenses WHERE user_id = ?'),
    students: q('SELECT * FROM students WHERE user_id = ?'),
    assumptions: assumptionsFor(db, userId),
  });
}

// Invoices that count as real fees: not drafts, not cancelled.
function liveInvoices(db, userId) {
  return db
    .prepare("SELECT * FROM invoices WHERE user_id = ? AND status NOT IN ('draft','cancelled') AND cancelled_at IS NULL")
    .all(userId);
}

// Sum of active payments per invoice, counting only payments dated on or before asOf.
function paidByInvoice(db, userId, asOf = FAR_FUTURE) {
  const rows = db
    .prepare(`
      SELECT invoice_id, SUM(amount) AS paid FROM payments
      WHERE user_id = ? AND status = 'active' AND payment_date <= ?
      GROUP BY invoice_id
    `)
    .all(userId, asOf);
  return new Map(rows.map((r) => [r.invoice_id, r.paid]));
}

function studentNames(db, userId) {
  return new Map(
    db.prepare('SELECT id, student_name FROM students WHERE user_id = ?').all(userId).map((s) => [s.id, s.student_name]),
  );
}

const monthStart = (today) => `${today.slice(0, 8)}01`;
const monthEnd = (today) => {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Shared query checks: from/to (default current calendar month) and format (json or csv).
function params(req, { dated = true } = {}) {
  const today = todayIso();
  const errors = {};
  const p = { today, format: 'json', errors };
  if (dated) {
    p.from = req.query.from === undefined || req.query.from === '' ? monthStart(today) : String(req.query.from);
    p.to = req.query.to === undefined || req.query.to === '' ? monthEnd(today) : String(req.query.to);
    if (!isIsoDate(p.from)) errors.from = 'From must be in YYYY-MM-DD format';
    if (!isIsoDate(p.to)) errors.to = 'To must be in YYYY-MM-DD format';
    else if (isIsoDate(p.from) && p.from > p.to) errors.from = 'From must be on or before To';
  }
  const format = req.query.format === undefined ? 'json' : String(req.query.format);
  if (format !== 'json' && format !== 'csv') errors.format = 'Format must be json or csv';
  p.format = format;
  return p;
}

// Rejects with 400 when any query check failed; returns true if it already responded.
function rejected(res, p) {
  if (Object.keys(p.errors).length === 0) return false;
  res.status(400).json({ error: 'Validation failed', errors: p.errors });
  return true;
}

// RFC 4180: fields with a comma, quote or line break are wrapped in quotes; inner quotes doubled.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(columns, rows, totalRow) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  if (totalRow) lines.push(columns.map((c) => cell(totalRow[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// Sends the report as JSON (body) or as a CSV download.
function respond(res, p, { name, columns, rows, totalRow, body }) {
  if (p.format === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename=${name}-${p.from ?? p.today}.csv`);
    return res.send(toCsv(columns, rows, totalRow));
  }
  return res.json(body);
}

// GET /api/reports/collection?from&to&format
router.get('/collection', (req, res) => {
  const p = params(req);
  if (rejected(res, p)) return undefined;
  const rows = getDb()
    .prepare(`
      SELECT p.payment_date, s.student_name, i.invoice_number, p.amount, p.method
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
      LEFT JOIN students s ON s.id = p.student_id AND s.user_id = p.user_id
      WHERE p.user_id = ? AND p.status = 'active' AND p.payment_date BETWEEN ? AND ?
      ORDER BY p.payment_date, p.id
    `)
    .all(req.userId, p.from, p.to);
  const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  return respond(res, p, {
    name: 'collection',
    columns: ['payment_date', 'student_name', 'invoice_number', 'amount', 'method'],
    rows,
    totalRow: { payment_date: 'Total', amount: total },
    body: { from: p.from, to: p.to, rows, total },
  });
});

// GET /api/reports/outstanding?to&format  (balances as of `to`)
router.get('/outstanding', (req, res) => {
  const p = params(req);
  if (rejected(res, p)) return undefined;
  const db = getDb();
  const names = studentNames(db, req.userId);
  const paid = paidByInvoice(db, req.userId, p.to);
  const rows = liveInvoices(db, req.userId)
    .map((inv) => {
      const balance = round2(inv.total_amount - (paid.get(inv.id) ?? 0));
      return {
        invoice_number: inv.invoice_number,
        student_name: names.get(inv.student_id) ?? null,
        due_date: inv.due_date,
        remaining_balance: balance,
        status: computeStatus({
          total: inv.total_amount,
          paid: paid.get(inv.id) ?? 0,
          dueDate: inv.due_date,
          cancelled: false,
          today: p.to,
          storedStatus: inv.status,
        }),
      };
    })
    .filter((r) => r.remaining_balance > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const total = round2(rows.reduce((sum, r) => sum + r.remaining_balance, 0));
  return respond(res, p, {
    name: 'outstanding',
    columns: ['invoice_number', 'student_name', 'due_date', 'remaining_balance', 'status'],
    rows,
    totalRow: { invoice_number: 'Total', remaining_balance: total },
    body: { as_of: p.to, rows, total },
  });
});

// GET /api/reports/overdue?format  (derived overdue status, as of today)
router.get('/overdue', (req, res) => {
  const p = params(req, { dated: false });
  if (rejected(res, p)) return undefined;
  const db = getDb();
  const names = studentNames(db, req.userId);
  const todayDay = dayNumber(p.today);
  const rows = liveInvoices(db, req.userId)
    .map((row) => invoiceView(db, row))
    .filter((inv) => inv.status === 'overdue' && inv.remaining_balance > 0)
    .map((inv) => ({
      invoice_number: inv.invoice_number,
      student_name: names.get(inv.student_id) ?? null,
      due_date: inv.due_date,
      days_overdue: todayDay - dayNumber(inv.due_date),
      remaining_balance: inv.remaining_balance,
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue);
  const total = round2(rows.reduce((sum, r) => sum + r.remaining_balance, 0));
  return respond(res, p, {
    name: 'overdue',
    columns: ['invoice_number', 'student_name', 'due_date', 'days_overdue', 'remaining_balance'],
    rows,
    totalRow: { invoice_number: 'Total', remaining_balance: total },
    body: { as_of: p.today, rows, total },
  });
});

// GET /api/reports/student-wise?from&to&format
router.get('/student-wise', (req, res) => {
  const p = params(req);
  if (rejected(res, p)) return undefined;
  const db = getDb();
  const students = db.prepare('SELECT id, student_name FROM students WHERE user_id = ? ORDER BY student_name, id').all(req.userId);
  const rows = new Map(
    students.map((s) => [s.id, { student_name: s.student_name, invoiced_in_range: 0, paid_in_range: 0, outstanding_now: 0 }]),
  );

  const paidNow = paidByInvoice(db, req.userId, p.today);
  for (const inv of liveInvoices(db, req.userId)) {
    const r = rows.get(inv.student_id);
    if (!r) continue;
    if (inv.issue_date >= p.from && inv.issue_date <= p.to) r.invoiced_in_range += inv.total_amount;
    const balance = round2(inv.total_amount - (paidNow.get(inv.id) ?? 0));
    if (balance > 0) r.outstanding_now += balance;
  }

  const paidRows = db
    .prepare(`
      SELECT p.student_id, SUM(p.amount) AS paid FROM payments p
      WHERE p.user_id = ? AND p.status = 'active' AND p.payment_date BETWEEN ? AND ?
      GROUP BY p.student_id
    `)
    .all(req.userId, p.from, p.to);
  for (const pr of paidRows) {
    const r = rows.get(pr.student_id);
    if (r) r.paid_in_range += pr.paid;
  }

  const list = [...rows.values()].map((r) => ({
    student_name: r.student_name,
    invoiced_in_range: round2(r.invoiced_in_range),
    paid_in_range: round2(r.paid_in_range),
    outstanding_now: round2(r.outstanding_now),
  }));
  const totals = {
    invoiced_in_range: round2(list.reduce((s, r) => s + r.invoiced_in_range, 0)),
    paid_in_range: round2(list.reduce((s, r) => s + r.paid_in_range, 0)),
    outstanding_now: round2(list.reduce((s, r) => s + r.outstanding_now, 0)),
  };
  return respond(res, p, {
    name: 'student-wise',
    columns: ['student_name', 'invoiced_in_range', 'paid_in_range', 'outstanding_now'],
    rows: list,
    totalRow: { student_name: 'Total', ...totals },
    body: { from: p.from, to: p.to, rows: list, totals },
  });
});

// GET /api/reports/expenses?from&to&format
router.get('/expenses', (req, res) => {
  const p = params(req);
  if (rejected(res, p)) return undefined;
  const rows = getDb()
    .prepare(`
      SELECT expense_date, title, category, amount, payment_method FROM expenses
      WHERE user_id = ? AND status = 'active' AND expense_date BETWEEN ? AND ?
      ORDER BY expense_date, id
    `)
    .all(req.userId, p.from, p.to);
  const byCategory = {};
  for (const r of rows) byCategory[r.category] = round2((byCategory[r.category] ?? 0) + r.amount);
  const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  return respond(res, p, {
    name: 'expenses',
    columns: ['expense_date', 'title', 'category', 'amount', 'payment_method'],
    rows,
    totalRow: { expense_date: 'Total', amount: total },
    body: { from: p.from, to: p.to, rows, by_category: byCategory, total },
  });
});

// GET /api/reports/upcoming-bills?from&to&format  (open bills whose next due date is in range)
router.get('/upcoming-bills', (req, res) => {
  const p = params(req);
  if (rejected(res, p)) return undefined;
  const rows = getDb()
    .prepare(`
      SELECT name, vendor, due_date AS next_due_date, amount, category FROM bills
      WHERE user_id = ? AND status = 'upcoming' AND due_date BETWEEN ? AND ?
      ORDER BY due_date, id
    `)
    .all(req.userId, p.from, p.to);
  const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
  return respond(res, p, {
    name: 'upcoming-bills',
    columns: ['name', 'vendor', 'next_due_date', 'amount', 'category'],
    rows,
    totalRow: { name: 'Total', amount: total },
    body: { from: p.from, to: p.to, rows, total },
  });
});

// GET /api/reports/forecast?horizon=30|60|90&format  (as of today)
router.get('/forecast', (req, res) => {
  const p = params(req, { dated: false });
  const horizon = req.query.horizon === undefined ? 90 : Number(req.query.horizon);
  if (![30, 60, 90].includes(horizon)) p.errors.horizon = 'Horizon must be 30, 60 or 90';
  if (rejected(res, p)) return undefined;
  const full = forecastFor(getDb(), req.userId, p.today);
  const rows = full.days.slice(0, horizon).map((d) => ({
    date: d.date,
    incoming_expected: d.incoming_expected,
    incoming_estimated: d.incoming_estimated,
    outflow_bills: d.outflow_bills,
    outflow_expenses: d.outflow_expenses,
    net: d.net,
    closing_balance: d.closing_balance,
  }));
  return respond(res, p, {
    name: 'forecast',
    columns: ['date', 'incoming_expected', 'incoming_estimated', 'outflow_bills', 'outflow_expenses', 'net', 'closing_balance'],
    rows,
    body: { horizon, as_of: p.today, rows, summary: summarize(rows) },
  });
});

export default router;
