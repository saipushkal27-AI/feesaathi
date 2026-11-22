// Bills: recurring or one-time payables. Paying a bill records a bill payment and exactly one
// linked expense in one transaction. Mounted behind requireAuth, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { round2, todayIso } from '../invoiceLogic.js';
import { billStatusFor, nextDueDate, addDays } from '../billLogic.js';
import { isIsoDate, text, toNumber } from './invoices.js';
import { CATEGORIES, PAYMENT_METHODS } from './expenses.js';

const router = Router();
const RECURRENCES = ['one_time', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
const STATUSES = ['upcoming', 'paid', 'cancelled'];
const NOT_FOUND = { message: 'Bill not found' };

// Optional text: '' becomes null, otherwise must fit within max length.
function optionalText(value, max, field, errors) {
  const s = text(value);
  if (!s) return null;
  if (s.length > max) errors[field] = `${field} must be ${max} characters or fewer`;
  return s;
}

// Validates a bill in snake_case. `base` supplies values for fields not in the input.
// Returns { errors, values }.
function validateBill(input, base = {}) {
  const b = { ...base };
  for (const key of Object.keys(input)) {
    if (input[key] !== undefined) b[key] = input[key];
  }

  const errors = {};
  const values = {};

  const name = text(b.name);
  if (!name) errors.name = 'Name is required';
  else if (name.length > 100) errors.name = 'Name must be 100 characters or fewer';
  values.name = name;

  values.vendor = optionalText(b.vendor, 100, 'vendor', errors);

  const amount = toNumber(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0';
  values.amount = round2(amount);

  const dueDate = text(b.due_date);
  if (!isIsoDate(dueDate)) errors.due_date = 'Due date must be in YYYY-MM-DD format';
  values.due_date = dueDate;

  if (!CATEGORIES.includes(b.category)) errors.category = `Category must be one of ${CATEGORIES.join(', ')}`;
  values.category = b.category;

  if (!RECURRENCES.includes(b.recurrence)) {
    errors.recurrence = `Recurrence must be one of ${RECURRENCES.join(', ')}`;
  }
  values.recurrence = b.recurrence;

  // Only custom recurrence uses an interval; other recurrences store null.
  if (b.recurrence === 'custom') {
    const days = toNumber(b.recurrence_interval_days);
    if (!Number.isInteger(days) || days <= 0) {
      errors.recurrence_interval_days = 'Interval must be a whole number of days greater than 0';
    }
    values.recurrence_interval_days = days;
  } else {
    values.recurrence_interval_days = null;
  }

  return { errors, values };
}

// Parses :id; returns the bill row only if it belongs to the current user.
function findOwned(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(id, userId);
}

// Adds the derived bill_status and, for recurring bills, the next due date.
function billView(row, today) {
  return {
    ...row,
    bill_status: billStatusFor({ status: row.status, dueDate: row.due_date, today }),
    next_due_date: row.recurrence === 'one_time'
      ? null
      : nextDueDate(row.due_date, row.recurrence, row.recurrence_interval_days),
  };
}

// GET /api/bills?status=upcoming|paid|cancelled
router.get('/', (req, res) => {
  const status = text(req.query.status);
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: { status: `Status must be one of ${STATUSES.join(', ')}` },
    });
  }

  const params = [req.userId];
  let sql = 'SELECT * FROM bills WHERE user_id = ?';
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY due_date ASC, id ASC';

  const today = todayIso();
  const bills = getDb().prepare(sql).all(...params).map((row) => billView(row, today));
  return res.json({ bills });
});

// GET /api/bills/summary
// Counts cover open (upcoming) bills only; upcoming_total covers today through the next 30 days.
router.get('/summary', (req, res) => {
  const today = todayIso();
  const horizon = addDays(today, 30);
  const open = getDb()
    .prepare("SELECT * FROM bills WHERE user_id = ? AND status = 'upcoming'")
    .all(req.userId);

  let dueToday = 0;
  let overdue = 0;
  let dueSoon = 0;
  let upcomingTotal = 0;
  for (const bill of open) {
    const derived = billStatusFor({ status: bill.status, dueDate: bill.due_date, today });
    if (derived === 'due_today') dueToday += 1;
    else if (derived === 'overdue') overdue += 1;
    else if (derived === 'due_soon') dueSoon += 1;
    if (bill.due_date >= today && bill.due_date <= horizon) upcomingTotal += bill.amount;
  }

  return res.json({
    due_today: dueToday,
    overdue,
    due_soon: dueSoon,
    upcoming_total: round2(upcomingTotal),
  });
});

// POST /api/bills
router.post('/', (req, res) => {
  const { errors, values } = validateBill(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const info = db.prepare(`
    INSERT INTO bills
      (user_id, name, vendor, amount, due_date, category, recurrence, recurrence_interval_days, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
  `).run(
    req.userId,
    values.name,
    values.vendor,
    values.amount,
    values.due_date,
    values.category,
    values.recurrence,
    values.recurrence_interval_days,
  );

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ bill: billView(bill, todayIso()) });
});

// PUT /api/bills/:id  (fields optional; any field given must be valid)
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = findOwned(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.status === 'paid') return res.status(409).json({ message: 'Paid bills cannot be edited' });

  const { errors, values } = validateBill(req.body || {}, existing);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  db.prepare(`
    UPDATE bills SET
      name = ?, vendor = ?, amount = ?, due_date = ?, category = ?,
      recurrence = ?, recurrence_interval_days = ?
    WHERE id = ? AND user_id = ?
  `).run(
    values.name,
    values.vendor,
    values.amount,
    values.due_date,
    values.category,
    values.recurrence,
    values.recurrence_interval_days,
    existing.id,
    req.userId,
  );

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(existing.id);
  return res.json({ bill: billView(bill, todayIso()) });
});

// POST /api/bills/:id/pay  body: { amount?, paid_on?, payment_method }
// One transaction: a bill_payments row and exactly one linked expense. One-time bills become paid;
// recurring bills advance their due date and stay upcoming.
router.post('/:id/pay', (req, res) => {
  const db = getDb();
  const bill = findOwned(db, req.userId, req.params.id);
  if (!bill) return res.status(404).json(NOT_FOUND);
  if (bill.status === 'cancelled') return res.status(409).json({ message: 'Bill is cancelled' });
  if (bill.status === 'paid') return res.status(409).json({ message: 'Bill is already paid' });

  const body = req.body || {};
  const errors = {};
  const amount = body.amount === undefined ? bill.amount : toNumber(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0';

  const paidOn = text(body.paid_on) || todayIso();
  if (!isIsoDate(paidOn)) errors.paid_on = 'Paid on must be in YYYY-MM-DD format';

  if (!PAYMENT_METHODS.includes(body.payment_method)) {
    errors.payment_method = `Payment method must be one of ${PAYMENT_METHODS.join(', ')}`;
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const paidAmount = round2(amount);
  const paymentId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO bill_payments (bill_id, user_id, amount, paid_on, payment_method)
      VALUES (?, ?, ?, ?, ?)
    `).run(bill.id, req.userId, paidAmount, paidOn, body.payment_method);

    db.prepare(`
      INSERT INTO expenses
        (user_id, title, amount, category, expense_date, payment_method, bill_payment_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(req.userId, bill.name, paidAmount, bill.category, paidOn, body.payment_method, info.lastInsertRowid);

    if (bill.recurrence === 'one_time') {
      db.prepare("UPDATE bills SET status = 'paid' WHERE id = ? AND user_id = ?").run(bill.id, req.userId);
    } else {
      const next = nextDueDate(bill.due_date, bill.recurrence, bill.recurrence_interval_days);
      db.prepare('UPDATE bills SET due_date = ? WHERE id = ? AND user_id = ?').run(next, bill.id, req.userId);
    }
    return info.lastInsertRowid;
  })();

  const updated = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
  const payment = db.prepare('SELECT * FROM bill_payments WHERE id = ?').get(paymentId);
  return res.json({ bill: billView(updated, todayIso()), payment });
});

// POST /api/bills/:id/cancel
router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const bill = findOwned(db, req.userId, req.params.id);
  if (!bill) return res.status(404).json(NOT_FOUND);
  if (bill.status === 'paid') return res.status(409).json({ message: 'Paid bills cannot be cancelled' });
  if (bill.status === 'cancelled') return res.status(409).json({ message: 'Bill is already cancelled' });

  db.prepare("UPDATE bills SET status = 'cancelled' WHERE id = ? AND user_id = ?").run(bill.id, req.userId);

  const updated = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
  return res.json({ bill: billView(updated, todayIso()) });
});

export default router;
