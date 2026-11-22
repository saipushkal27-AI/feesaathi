// Invoices: fee bills raised against a student. Totals are stored; paid amounts and statuses are
// derived from the payments table on every read. Mounted behind requireAuth, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { computeTotal, computeStatus, nextInvoiceNumber, remainingBalance, round2, todayIso } from '../invoiceLogic.js';

const router = Router();
const INVOICE_TYPES = ['monthly', 'weekly', 'per_class', 'custom', 'additional'];
const STATUSES = ['draft', 'sent', 'pending', 'partially_paid', 'paid', 'overdue', 'cancelled'];
const OUTSTANDING = ['pending', 'sent', 'partially_paid', 'overdue'];
const NOT_FOUND = { message: 'Invoice not found' };

export const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Number from a number or numeric string; NaN otherwise.
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

// True for a real calendar date in YYYY-MM-DD form.
export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates an invoice in snake_case. `base` supplies values for fields not in the input
// (PUT passes the stored invoice so a partial update is checked as a whole).
// additional_charges is a list of { label, amount }. Returns { errors, values }.
function validate(input, base) {
  const b = { ...base };
  for (const key of Object.keys(input)) {
    if (input[key] !== undefined) b[key] = input[key];
  }

  const errors = {};
  const values = {};

  values.invoice_type = b.invoice_type;
  if (!INVOICE_TYPES.includes(b.invoice_type)) {
    errors.invoice_type = `Invoice type must be one of ${INVOICE_TYPES.join(', ')}`;
  }

  const period = text(b.billing_period);
  if (!period) errors.billing_period = 'Billing period is required';
  else if (period.length > 100) errors.billing_period = 'Billing period must be 100 characters or fewer';
  values.billing_period = period;

  const description = text(b.description);
  if (description.length > 500) errors.description = 'Description must be 500 characters or fewer';
  values.description = description || null;

  const issue = text(b.issue_date);
  if (!isIsoDate(issue)) errors.issue_date = 'Issue date must be in YYYY-MM-DD format';
  values.issue_date = issue;

  const due = text(b.due_date);
  if (!due) errors.due_date = 'Due date is required';
  else if (!isIsoDate(due)) errors.due_date = 'Due date must be in YYYY-MM-DD format';
  else if (isIsoDate(issue) && due < issue) errors.due_date = 'Due date cannot be before issue date';
  values.due_date = due;

  const baseAmount = toNumber(b.base_amount);
  if (!Number.isFinite(baseAmount) || baseAmount < 0) {
    errors.base_amount = 'Base amount must be a number of 0 or more';
  }
  values.base_amount = baseAmount;

  // Additional charges: a list of { label, amount }. Omitted or null means none.
  const rawItems = b.additional_charges ?? [];
  const items = [];
  if (!Array.isArray(rawItems)) {
    errors.additional_charges = 'Additional charges must be a list';
  } else {
    for (const item of rawItems) {
      const label = text(item?.label);
      const amount = toNumber(item?.amount);
      if (!label) {
        errors.additional_charges = 'Each additional charge needs a label';
        break;
      }
      if (label.length > 100) {
        errors.additional_charges = 'Additional charge labels must be 100 characters or fewer';
        break;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        errors.additional_charges = 'Each additional charge needs an amount of 0 or more';
        break;
      }
      items.push({ label, amount });
    }
  }
  values.items = items;
  values.additional_total = round2(items.reduce((sum, item) => sum + item.amount, 0));

  const discount = b.discount === undefined || b.discount === null || b.discount === '' ? 0 : toNumber(b.discount);
  if (!Number.isFinite(discount) || discount < 0) errors.discount = 'Discount must be a number of 0 or more';
  values.discount = discount;

  // Total is only meaningful when the amounts themselves are valid.
  if (!errors.base_amount && !errors.additional_charges && !errors.discount) {
    const result = computeTotal({
      base_amount: baseAmount,
      additional_charges: values.additional_total,
      discount,
    });
    if (result.error) errors.discount = result.error;
    else values.total = result.total;
  }

  return { errors, values };
}

// Parses :id; returns the invoice row only if it belongs to the current user.
export function findOwnedInvoice(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, userId);
}

// Sum of active (not reversed) payments on an invoice.
export function paidAmount(db, invoiceId) {
  return db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ? AND status = 'active'")
    .get(invoiceId).paid;
}

// The invoice as the API returns it: stored fields plus paid_amount, remaining_balance and derived status.
export function invoiceView(db, row) {
  const paid = paidAmount(db, row.id);
  return {
    ...row,
    paid_amount: round2(paid),
    remaining_balance: remainingBalance(row.total_amount, paid),
    status: computeStatus({
      total: row.total_amount,
      paid,
      dueDate: row.due_date,
      cancelled: row.status === 'cancelled' || row.cancelled_at != null,
      today: todayIso(),
      storedStatus: row.status,
    }),
  };
}

// Replaces the base and additional line items of an invoice.
function replaceItems(db, invoiceId, values) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const add = db.prepare('INSERT INTO invoice_items (invoice_id, kind, label, amount) VALUES (?, ?, ?, ?)');
  add.run(invoiceId, 'base', 'Base fee', values.base_amount);
  for (const item of values.items) add.run(invoiceId, 'additional', item.label, item.amount);
}

// GET /api/invoices?status=&studentId=
router.get('/', (req, res) => {
  const errors = {};
  const status = req.query.status === undefined || req.query.status === '' ? null : String(req.query.status);
  if (status && !STATUSES.includes(status)) errors.status = `Status must be one of ${STATUSES.join(', ')}`;

  let studentId = null;
  if (req.query.studentId !== undefined && req.query.studentId !== '') {
    studentId = Number(req.query.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) errors.studentId = 'Student id must be a positive integer';
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const params = [req.userId];
  let sql = 'SELECT * FROM invoices WHERE user_id = ?';
  if (studentId !== null) {
    sql += ' AND student_id = ?';
    params.push(studentId);
  }
  sql += ' ORDER BY issue_date DESC, id DESC';

  const all = db.prepare(sql).all(...params).map((row) => invoiceView(db, row));
  const invoices = status ? all.filter((inv) => inv.status === status) : all;
  const outstanding_total = round2(
    invoices.filter((inv) => OUTSTANDING.includes(inv.status)).reduce((sum, inv) => sum + inv.remaining_balance, 0),
  );
  return res.json({ invoices, outstanding_total });
});

// POST /api/invoices
router.post('/', (req, res) => {
  const body = req.body || {};
  const db = getDb();

  const { errors, values } = validate(body, {
    issue_date: todayIso(),
    additional_charges: [],
    discount: 0,
  });

  const studentId = Number(body.student_id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    errors.student_id = 'Student is required';
  } else {
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, req.userId);
    if (!student) errors.student_id = 'Student not found';
    else if (student.status !== 'active') errors.student_id = 'Student is archived';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const initialStatus = body.status === 'draft' ? 'draft' : 'pending';
  const id = db.transaction(() => {
    const year = values.issue_date.slice(0, 4);
    const { maxSeq } = db
      .prepare(`
        SELECT COALESCE(MAX(CAST(SUBSTR(invoice_number, 9) AS INTEGER)), 0) AS maxSeq
        FROM invoices WHERE user_id = ? AND invoice_number LIKE ?
      `)
      .get(req.userId, `FS-${year}-%`);

    const info = db.prepare(`
      INSERT INTO invoices
        (user_id, student_id, invoice_number, billing_period, invoice_type, description, issue_date,
         due_date, base_amount, additional_charges, discount, total_amount, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      req.userId,
      studentId,
      nextInvoiceNumber(maxSeq, year),
      values.billing_period,
      values.invoice_type,
      values.description,
      values.issue_date,
      values.due_date,
      values.base_amount,
      values.additional_total,
      values.discount,
      values.total,
      initialStatus,
    );
    replaceItems(db, info.lastInsertRowid, values);
    return info.lastInsertRowid;
  })();

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return res.status(201).json({ invoice: invoiceView(db, invoice) });
});

// GET /api/invoices/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = findOwnedInvoice(db, req.userId, req.params.id);
  if (!row) return res.status(404).json(NOT_FOUND);

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(row.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id').all(row.id);
  return res.json({ invoice: invoiceView(db, row), items, payments });
});

// PUT /api/invoices/:id  (only drafts, or invoices with no payments yet)
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = findOwnedInvoice(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.status === 'cancelled') {
    return res.status(409).json({ message: 'Cancelled invoices cannot be edited' });
  }

  const hasPayments = db.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(existing.id).n > 0;
  if (existing.status !== 'draft' && hasPayments) {
    return res.status(409).json({ message: 'Invoice has payments; create a correction instead' });
  }

  const existingItems = db
    .prepare("SELECT label, amount FROM invoice_items WHERE invoice_id = ? AND kind = 'additional' ORDER BY id")
    .all(existing.id);
  const { errors, values } = validate(req.body || {}, { ...existing, additional_charges: existingItems });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE invoices SET
        invoice_type = ?, billing_period = ?, description = ?, issue_date = ?, due_date = ?,
        base_amount = ?, additional_charges = ?, discount = ?, total_amount = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      values.invoice_type,
      values.billing_period,
      values.description,
      values.issue_date,
      values.due_date,
      values.base_amount,
      values.additional_total,
      values.discount,
      values.total,
      existing.id,
      req.userId,
    );
    replaceItems(db, existing.id, values);
  })();

  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(existing.id);
  return res.json({ invoice: invoiceView(db, row) });
});

// POST /api/invoices/:id/send  (draft -> sent)
router.post('/:id/send', (req, res) => {
  const db = getDb();
  const existing = findOwnedInvoice(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.status !== 'draft') {
    return res.status(409).json({ message: 'Only draft invoices can be sent' });
  }

  db.prepare("UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(existing.id, req.userId);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(existing.id);
  return res.json({ invoice: invoiceView(db, row) });
});

// POST /api/invoices/:id/cancel  (kept in the database, excluded from outstanding totals)
router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const existing = findOwnedInvoice(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);
  if (existing.status === 'cancelled') {
    return res.status(409).json({ message: 'Invoice is already cancelled' });
  }

  const active = db
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND status = 'active'")
    .get(existing.id).n;
  if (active > 0) return res.status(409).json({ message: 'Reverse payments before cancelling' });

  db.prepare(`
    UPDATE invoices SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(existing.id, req.userId);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(existing.id);
  return res.json({ invoice: invoiceView(db, row) });
});

export default router;
