// Payments: money received against an invoice. Payments are never deleted; corrections and
// reversals are recorded in payment_audit. Mounted behind requireAuth, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { remainingBalance, round2, todayIso } from '../invoiceLogic.js';
import { findOwnedInvoice, invoiceView, isIsoDate, text, toNumber } from './invoices.js';

const router = Router();
const METHODS = ['cash', 'upi', 'bank_transfer', 'other'];
const NOT_FOUND = { message: 'Payment not found' };
const DUPLICATE_WINDOW = "-10 minutes";

// Parses :id; returns the payment row only if it belongs to the current user.
function findOwnedPayment(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(id, userId);
}

// POST /api/payments
router.post('/', (req, res) => {
  const body = req.body || {};
  const db = getDb();
  const errors = {};

  const invoiceId = Number(body.invoice_id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) errors.invoice_id = 'Invoice is required';

  const amount = toNumber(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0';

  const rawDate = text(body.payment_date);
  const paymentDate = rawDate || todayIso();
  if (!isIsoDate(paymentDate)) errors.payment_date = 'Payment date must be in YYYY-MM-DD format';

  if (!METHODS.includes(body.method)) errors.method = `Method must be one of ${METHODS.join(', ')}`;

  const reference = text(body.reference);
  if (reference.length > 100) errors.reference = 'Reference must be 100 characters or fewer';
  const notes = text(body.notes);
  if (notes.length > 500) errors.notes = 'Notes must be 500 characters or fewer';

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const invoice = findOwnedInvoice(db, req.userId, invoiceId);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  // Checks use the stored status: a past-due draft still shows as 'overdue' when derived.
  if (invoice.status === 'cancelled') errors.invoice_id = 'Invoice is cancelled';
  else if (invoice.status === 'draft') errors.invoice_id = 'Send the invoice before recording payments';

  const roundedAmount = round2(amount);
  if (!errors.invoice_id && roundedAmount > invoiceView(db, invoice).remaining_balance) {
    errors.amount = 'Amount exceeds remaining balance';
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  // Same invoice, amount, date and method within the last 10 minutes is probably a double submit.
  if (body.allow_duplicate !== true) {
    const dup = db.prepare(`
      SELECT id FROM payments
      WHERE invoice_id = ? AND user_id = ? AND status = 'active'
        AND amount = ? AND payment_date = ? AND method = ?
        AND created_at >= datetime('now', ?)
      LIMIT 1
    `).get(invoice.id, req.userId, roundedAmount, paymentDate, body.method, DUPLICATE_WINDOW);
    if (dup) return res.status(409).json({ message: 'Possible duplicate payment' });
  }

  const id = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO payments
        (user_id, student_id, invoice_id, amount, payment_date, method, reference, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      req.userId,
      invoice.student_id,
      invoice.id,
      roundedAmount,
      paymentDate,
      body.method,
      reference || null,
      notes || null,
    );
    db.prepare(`
      INSERT INTO payment_audit (payment_id, action, old_amount, new_amount, reason)
      VALUES (?, 'created', NULL, ?, NULL)
    `).run(info.lastInsertRowid, roundedAmount);
    return info.lastInsertRowid;
  })();

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  return res.status(201).json({ payment, invoice: invoiceView(db, row) });
});

// GET /api/payments?invoiceId=&studentId=  (active and reversed, each with its audit count)
router.get('/', (req, res) => {
  const errors = {};
  const idFilter = (name) => {
    const raw = req.query[name];
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      errors[name] = `${name} must be a positive integer`;
      return null;
    }
    return n;
  };
  const invoiceId = idFilter('invoiceId');
  const studentId = idFilter('studentId');
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const params = [req.userId];
  let sql = `
    SELECT p.*, (SELECT COUNT(*) FROM payment_audit a WHERE a.payment_id = p.id) AS audit_count
    FROM payments p WHERE p.user_id = ?
  `;
  if (invoiceId !== null) {
    sql += ' AND p.invoice_id = ?';
    params.push(invoiceId);
  }
  if (studentId !== null) {
    sql += ' AND p.student_id = ?';
    params.push(studentId);
  }
  sql += ' ORDER BY p.payment_date DESC, p.id DESC';

  const payments = getDb().prepare(sql).all(...params);
  return res.json({ payments });
});

// GET /api/payments/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const payment = findOwnedPayment(db, req.userId, req.params.id);
  if (!payment) return res.status(404).json(NOT_FOUND);
  const audit = db.prepare('SELECT * FROM payment_audit WHERE payment_id = ? ORDER BY id').all(payment.id);
  return res.json({ payment, audit });
});

// Returns the payment's invoice as a fresh view after a change.
function respondWithInvoice(db, res, payment, status = 200) {
  const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
  return res.status(status).json({ payment: updated, invoice: invoiceView(db, row) });
}

// POST /api/payments/:id/correct  body: { amount, reason }
router.post('/:id/correct', (req, res) => {
  const db = getDb();
  const payment = findOwnedPayment(db, req.userId, req.params.id);
  if (!payment) return res.status(404).json(NOT_FOUND);
  if (payment.status === 'reversed') {
    return res.status(409).json({ message: 'Reversed payments cannot be corrected' });
  }

  const body = req.body || {};
  const errors = {};
  const amount = toNumber(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0';

  const reason = text(body.reason);
  if (reason.length < 3) errors.reason = 'Reason must be at least 3 characters';

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
  if (!errors.amount) {
    // The corrected amount may use the invoice total minus every other active payment.
    const others = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE invoice_id = ? AND status = 'active' AND id != ?")
      .get(invoice.id, payment.id).s;
    if (round2(amount) > remainingBalance(invoice.total_amount, others)) {
      errors.amount = 'Amount exceeds remaining balance';
    }
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const newAmount = round2(amount);
  db.transaction(() => {
    db.prepare('UPDATE payments SET amount = ? WHERE id = ? AND user_id = ?')
      .run(newAmount, payment.id, req.userId);
    db.prepare(`
      INSERT INTO payment_audit (payment_id, action, old_amount, new_amount, reason)
      VALUES (?, 'corrected', ?, ?, ?)
    `).run(payment.id, payment.amount, newAmount, reason);
  })();

  return respondWithInvoice(db, res, payment);
});

// POST /api/payments/:id/reverse  body: { reason }
router.post('/:id/reverse', (req, res) => {
  const db = getDb();
  const payment = findOwnedPayment(db, req.userId, req.params.id);
  if (!payment) return res.status(404).json(NOT_FOUND);
  if (payment.status === 'reversed') {
    return res.status(409).json({ message: 'Payment is already reversed' });
  }

  const reason = text((req.body || {}).reason);
  if (!reason) {
    return res.status(400).json({ error: 'Validation failed', errors: { reason: 'Reason is required' } });
  }

  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'reversed' WHERE id = ? AND user_id = ?")
      .run(payment.id, req.userId);
    db.prepare(`
      INSERT INTO payment_audit (payment_id, action, old_amount, new_amount, reason)
      VALUES (?, 'reversed', ?, NULL, ?)
    `).run(payment.id, payment.amount, reason);
  })();

  return respondWithInvoice(db, res, payment);
});

export default router;
