// Expenses: money the tutor spends. Expenses are soft-deleted. Rows created by a bill payment
// (bill_payment_id set) are changed through the bill, not here. Mounted behind requireAuth, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { round2, todayIso } from '../invoiceLogic.js';
import { isIsoDate, text, toNumber } from './invoices.js';

const router = Router();
export const CATEGORIES = [
  'teaching_materials', 'books_stationery', 'internet', 'electricity',
  'transportation', 'rent', 'equipment', 'staff', 'other',
];
export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'other'];
const NOT_FOUND = { message: 'Expense not found' };
const LINKED = { message: 'This expense comes from a bill payment; edit the bill instead' };

// Optional text: '' becomes null, otherwise must fit within max length.
function optionalText(value, max, field, errors) {
  const s = text(value);
  if (!s) return null;
  if (s.length > max) errors[field] = `${field} must be ${max} characters or fewer`;
  return s;
}

// Validates an expense in snake_case. `base` supplies values for fields not in the input
// (PUT passes the stored row so a partial update is checked as a whole). Returns { errors, values }.
export function validateExpense(input, base = {}) {
  const b = { ...base };
  for (const key of Object.keys(input)) {
    if (input[key] !== undefined) b[key] = input[key];
  }

  const errors = {};
  const values = {};

  const title = text(b.title);
  if (!title) errors.title = 'Title is required';
  else if (title.length > 100) errors.title = 'Title must be 100 characters or fewer';
  values.title = title;

  const amount = toNumber(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0';
  values.amount = round2(amount);

  if (!CATEGORIES.includes(b.category)) errors.category = `Category must be one of ${CATEGORIES.join(', ')}`;
  values.category = b.category;

  // Missing date defaults to the local today.
  const expenseDate = text(b.expense_date) || todayIso();
  if (!isIsoDate(expenseDate)) errors.expense_date = 'Expense date must be in YYYY-MM-DD format';
  values.expense_date = expenseDate;

  if (!PAYMENT_METHODS.includes(b.payment_method)) {
    errors.payment_method = `Payment method must be one of ${PAYMENT_METHODS.join(', ')}`;
  }
  values.payment_method = b.payment_method;

  values.description = optionalText(b.description, 500, 'description', errors);
  values.receipt_name = optionalText(b.receipt_name, 200, 'receipt_name', errors);

  return { errors, values };
}

// Parses :id; returns the active expense only if it belongs to the current user.
function findOwned(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db
    .prepare("SELECT * FROM expenses WHERE id = ? AND user_id = ? AND status = 'active'")
    .get(id, userId);
}

// GET /api/expenses?from=&to=&category=
router.get('/', (req, res) => {
  const errors = {};
  const from = text(req.query.from);
  const to = text(req.query.to);
  const category = text(req.query.category);
  if (from && !isIsoDate(from)) errors.from = 'From must be in YYYY-MM-DD format';
  if (to && !isIsoDate(to)) errors.to = 'To must be in YYYY-MM-DD format';
  if (category && !CATEGORIES.includes(category)) {
    errors.category = `Category must be one of ${CATEGORIES.join(', ')}`;
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const where = ['user_id = ?', "status = 'active'"];
  const params = [req.userId];
  if (from) {
    where.push('expense_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('expense_date <= ?');
    params.push(to);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const clause = where.join(' AND ');

  const db = getDb();
  const expenses = db
    .prepare(`SELECT * FROM expenses WHERE ${clause} ORDER BY expense_date DESC, id DESC`)
    .all(...params);
  const totalRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${clause}`)
    .get(...params);
  const byCategory = db
    .prepare(`SELECT category, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${clause} GROUP BY category ORDER BY total DESC`)
    .all(...params);

  return res.json({
    expenses,
    total: round2(totalRow.total),
    by_category: byCategory.map((r) => ({ category: r.category, total: round2(r.total) })),
  });
});

// GET /api/expenses/summary?date=  today_total is the local today; month_total is the month of `date`.
router.get('/summary', (req, res) => {
  const date = text(req.query.date) || todayIso();
  if (!isIsoDate(date)) {
    return res.status(400).json({ error: 'Validation failed', errors: { date: 'Date must be in YYYY-MM-DD format' } });
  }

  const db = getDb();
  const today = todayIso();
  const month = date.slice(0, 7);
  const sum = (sql, ...args) =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE user_id = ? AND status = 'active' AND ${sql}`)
      .get(req.userId, ...args).s;

  return res.json({
    today_total: round2(sum('expense_date = ?', today)),
    month_total: round2(sum('substr(expense_date, 1, 7) = ?', month)),
    total: round2(sum('1 = 1')),
  });
});

// POST /api/expenses
router.post('/', (req, res) => {
  const { errors, values } = validateExpense(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const info = db.prepare(`
    INSERT INTO expenses
      (user_id, title, amount, category, expense_date, payment_method, description, receipt_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(
    req.userId,
    values.title,
    values.amount,
    values.category,
    values.expense_date,
    values.payment_method,
    values.description,
    values.receipt_name,
  );

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ expense });
});

// PUT /api/expenses/:id  (fields optional; any field given must be valid)
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = findOwned(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.bill_payment_id != null) return res.status(409).json(LINKED);

  const { errors, values } = validateExpense(req.body || {}, existing);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  db.prepare(`
    UPDATE expenses SET
      title = ?, amount = ?, category = ?, expense_date = ?, payment_method = ?,
      description = ?, receipt_name = ?
    WHERE id = ? AND user_id = ?
  `).run(
    values.title,
    values.amount,
    values.category,
    values.expense_date,
    values.payment_method,
    values.description,
    values.receipt_name,
    existing.id,
    req.userId,
  );

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(existing.id);
  return res.json({ expense });
});

// DELETE /api/expenses/:id  soft delete
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = findOwned(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.bill_payment_id != null) return res.status(409).json(LINKED);

  db.prepare("UPDATE expenses SET status = 'deleted' WHERE id = ? AND user_id = ?").run(existing.id, req.userId);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(existing.id);
  return res.json({ expense });
});

export default router;
