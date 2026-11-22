// Students: a tutor's pupils, with fee details. Archiving hides a student but never deletes it.
// Mounted behind requireAuth in app.js, so req.userId is the signed-in tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { invoiceView } from './invoices.js';
import { round2 } from '../invoiceLogic.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FEE_FREQUENCIES = ['monthly', 'weekly', 'per_class', 'custom'];
const STATUSES = ['active', 'archived', 'all'];

// Trim a value to a string; null/undefined become ''.
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Optional text field: '' becomes null, otherwise must fit within max length.
function optionalText(value, max, field, errors) {
  const s = text(value);
  if (!s) return null;
  if (s.length > max) errors[field] = `${field} must be ${max} characters or fewer`;
  return s;
}

// Accepts "9876543210", "98765 43210", "98765-43210" or "+91 98765 43210"; returns bare digits.
function normalizeMobile(raw) {
  let s = text(raw).replace(/[\s-]+/g, '');
  if (s.startsWith('+91')) s = s.slice(3);
  return s;
}

// Validates a student record in snake_case. `base` supplies values for fields not
// present in the input (used by PUT so partial updates are checked as a whole record).
// Returns { errors, values }.
function validate(input, base = {}) {
  const b = { ...base };
  for (const key of Object.keys(input)) {
    if (input[key] !== undefined) b[key] = input[key];
  }

  const errors = {};
  const values = {};

  const studentName = text(b.student_name);
  if (!studentName) errors.student_name = 'Student name is required';
  else if (studentName.length > 100) errors.student_name = 'Student name must be 100 characters or fewer';
  values.student_name = studentName;

  const parentName = text(b.parent_name);
  if (!parentName) errors.parent_name = 'Parent name is required';
  else if (parentName.length > 100) errors.parent_name = 'Parent name must be 100 characters or fewer';
  values.parent_name = parentName;

  // Store only the cleaned 10 digits.
  const mobile = normalizeMobile(b.parent_mobile);
  if (!mobile) errors.parent_mobile = 'Parent mobile is required';
  else if (!/^\d{10}$/.test(mobile)) errors.parent_mobile = 'Enter a valid 10-digit mobile number';
  values.parent_mobile = mobile;

  // Optional email, but if given it must look valid.
  const email = text(b.email).toLowerCase();
  if (!email) values.email = null;
  else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address';
    values.email = email;
  } else values.email = email;

  values.class_grade = optionalText(b.class_grade, 50, 'class_grade', errors);
  values.subject = optionalText(b.subject, 100, 'subject', errors);

  // Optional joining date in YYYY-MM-DD form.
  const joining = text(b.joining_date);
  if (!joining) values.joining_date = null;
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(joining) || Number.isNaN(Date.parse(joining))) {
    errors.joining_date = 'Joining date must be in YYYY-MM-DD format';
    values.joining_date = joining;
  } else values.joining_date = joining;

  values.address = optionalText(b.address, 300, 'address', errors);
  values.notes = optionalText(b.notes, 1000, 'notes', errors);

  // Fee amount: a number of 0 or more (numeric strings are accepted too).
  const rawFee = b.fee_amount;
  const feeAmount =
    typeof rawFee === 'number' || (typeof rawFee === 'string' && rawFee.trim() !== '')
      ? Number(rawFee)
      : NaN;
  if (!Number.isFinite(feeAmount) || feeAmount < 0) errors.fee_amount = 'Fee amount must be a number of 0 or more';
  values.fee_amount = feeAmount;

  if (!FEE_FREQUENCIES.includes(b.fee_frequency)) {
    errors.fee_frequency = `Fee frequency must be one of ${FEE_FREQUENCIES.join(', ')}`;
  }
  values.fee_frequency = b.fee_frequency;

  return { errors, values };
}

// Parses :id; returns the student row only if it belongs to the current user.
function findOwned(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(id, userId);
}

const NOT_FOUND = { message: 'Student not found' };

// GET /api/students?status=active|archived|all&q=search
router.get('/', (req, res) => {
  const status = req.query.status === undefined ? 'active' : String(req.query.status);
  if (!STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: { status: `Status must be one of ${STATUSES.join(', ')}` },
    });
  }

  const params = [req.userId];
  let sql = 'SELECT * FROM students WHERE user_id = ?';
  if (status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }

  // Case-insensitive LIKE search on student or parent name. '!' escapes wildcards in the term.
  const q = text(req.query.q);
  if (q) {
    const pattern = `%${q.replace(/[!%_]/g, (c) => `!${c}`)}%`;
    sql += " AND (student_name LIKE ? ESCAPE '!' OR parent_name LIKE ? ESCAPE '!')";
    params.push(pattern, pattern);
  }

  sql += ' ORDER BY student_name COLLATE NOCASE, id';
  const students = getDb().prepare(sql).all(...params);
  return res.json({ students });
});

// Inserts validated values for a user and returns the stored row.
function insertStudent(db, userId, values) {
  const info = db.prepare(`
    INSERT INTO students
      (user_id, student_name, parent_name, parent_mobile, email, class_grade, subject,
       joining_date, address, notes, fee_amount, fee_frequency, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
  `).run(
    userId,
    values.student_name,
    values.parent_name,
    values.parent_mobile,
    values.email,
    values.class_grade,
    values.subject,
    values.joining_date,
    values.address,
    values.notes,
    values.fee_amount,
    values.fee_frequency,
  );

  return db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
}

// POST /api/students
router.post('/', (req, res) => {
  const { errors, values } = validate(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const student = insertStudent(getDb(), req.userId, values);
  return res.status(201).json({ student });
});

const IMPORT_MAX_ROWS = 500;

// POST /api/students/import  { rows: [...] }
// Inserts valid rows in one transaction and reports the rest. Rows matching an active
// student (same name, ignoring case, and same mobile) are not inserted again.
router.post('/import', (req, res) => {
  const rows = (req.body || {}).rows;
  if (!Array.isArray(rows)) return res.status(400).json({ message: 'rows must be an array' });
  if (rows.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ message: `Import is limited to ${IMPORT_MAX_ROWS} rows at a time` });
  }

  const db = getDb();
  const findDuplicate = db.prepare(`
    SELECT id FROM students
    WHERE user_id = ? AND status = 'active' AND student_name = ? COLLATE NOCASE AND parent_mobile = ?
  `);

  let imported = 0;
  const failed = [];
  db.exec('BEGIN');
  try {
    rows.forEach((row, index) => {
      const { errors, values } = validate(row && typeof row === 'object' ? row : {});
      if (!Object.keys(errors).length && findDuplicate.get(req.userId, values.student_name, values.parent_mobile)) {
        errors.student_name = 'Already exists';
      }
      if (Object.keys(errors).length) {
        failed.push({ row: index + 1, errors });
        return;
      }
      insertStudent(db, req.userId, values);
      imported += 1;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return res.json({ imported, failed });
});

// GET /api/students/:id
router.get('/:id', (req, res) => {
  const student = findOwned(getDb(), req.userId, req.params.id);
  if (!student) return res.status(404).json(NOT_FOUND);
  return res.json({ student });
});

// PUT /api/students/:id  (fields are optional; any field given must be valid)
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = findOwned(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(NOT_FOUND);

  // Validate the full merged record so a partial update still produces a valid row.
  const { errors, values } = validate(req.body || {}, existing);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  db.prepare(`
    UPDATE students SET
      student_name = ?, parent_name = ?, parent_mobile = ?, email = ?, class_grade = ?,
      subject = ?, joining_date = ?, address = ?, notes = ?, fee_amount = ?,
      fee_frequency = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    values.student_name,
    values.parent_name,
    values.parent_mobile,
    values.email,
    values.class_grade,
    values.subject,
    values.joining_date,
    values.address,
    values.notes,
    values.fee_amount,
    values.fee_frequency,
    existing.id,
    req.userId,
  );

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(existing.id);
  return res.json({ student });
});

// Sets status on an owned student. Nothing is deleted.
function setStatus(status) {
  return (req, res) => {
    const db = getDb();
    const existing = findOwned(db, req.userId, req.params.id);
    if (!existing) return res.status(404).json(NOT_FOUND);

    db.prepare(`UPDATE students SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(status, existing.id, req.userId);

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(existing.id);
    return res.json({ student });
  };
}

// POST /api/students/:id/archive and /restore
router.post('/:id/archive', setStatus('archived'));
router.post('/:id/restore', setStatus('active'));

// GET /api/students/:id/profile: the student, a money summary, invoices (with derived status) and payments.
router.get('/:id/profile', (req, res) => {
  const db = getDb();
  const student = findOwned(db, req.userId, req.params.id);
  if (!student) return res.status(404).json(NOT_FOUND);

  const rows = db
    .prepare('SELECT * FROM invoices WHERE student_id = ? AND user_id = ? ORDER BY issue_date DESC, id DESC')
    .all(student.id, req.userId);
  const payments = db
    .prepare('SELECT * FROM payments WHERE student_id = ? AND user_id = ? ORDER BY payment_date DESC, id DESC')
    .all(student.id, req.userId);

  let totalInvoiced = 0;
  let totalPaid = 0;
  let pendingBalance = 0;
  let overdueBalance = 0;
  let nextDueDate = null;
  const invoices = rows.map((row) => {
    const view = invoiceView(db, row);
    // Cancelled invoices are excluded everywhere; drafts (stored status) are not yet owed.
    if (view.status === 'cancelled') return view;
    totalInvoiced += row.total_amount;
    totalPaid += view.paid_amount;
    const remaining = Math.max(0, view.remaining_balance);
    if (remaining > 0 && (nextDueDate === null || row.due_date < nextDueDate)) nextDueDate = row.due_date;
    if (row.status !== 'draft') {
      pendingBalance += remaining;
      if (view.status === 'overdue') overdueBalance += remaining;
    }
    return view;
  });

  // Payments are newest first, so the first active one has the latest date.
  const lastPayment = payments.find((p) => p.status === 'active');
  const summary = {
    total_invoiced: round2(totalInvoiced),
    total_paid: round2(totalPaid),
    pending_balance: round2(pendingBalance),
    overdue_balance: round2(overdueBalance),
    last_payment_date: lastPayment ? lastPayment.payment_date : null,
    next_due_date: nextDueDate,
  };
  return res.json({ student, summary, invoices, payments });
});

export default router;
