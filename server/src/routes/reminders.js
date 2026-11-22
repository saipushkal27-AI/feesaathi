// Reminders: drafted messages about an invoice balance. Nothing is sent externally; marking one sent
// only records that the tutor shared it. Mounted behind requireAuth in app.js, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { findOwnedInvoice, invoiceView } from './invoices.js';
import { chooseReminderKind, draftReminder } from '../reminderLogic.js';
import { todayIso } from '../invoiceLogic.js';
import { phraseText } from './ai.js';
import { numbersMatch } from '../aiLogic.js';

const router = Router();
const KINDS = ['upcoming', 'overdue', 'partial'];
const INVOICE_NOT_FOUND = { message: 'Invoice not found' };
const REMINDER_NOT_FOUND = { message: 'Reminder not found' };

// Optional positive integer query value: null when absent, NaN when invalid.
const optionalId = (raw) => {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

// Parses :id; returns the reminder row only if it belongs to the current user.
function findOwnedReminder(db, userId, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, userId);
}

// POST /api/reminders/draft  { invoice_id, kind?, force? }
router.post('/draft', async (req, res, next) => {
  const body = req.body || {};
  const db = getDb();
  const row = findOwnedInvoice(db, req.userId, body.invoice_id);
  if (!row) return res.status(404).json(INVOICE_NOT_FOUND);
  const invoice = invoiceView(db, row);

  const override = body.kind === undefined || body.kind === null ? null : body.kind;
  if (override !== null && !KINDS.includes(override)) {
    return res.status(400).json({ message: `kind must be one of ${KINDS.join(', ')}` });
  }
  const kind = override ?? chooseReminderKind({
    status: invoice.status,
    dueDate: invoice.due_date,
    today: todayIso(),
    remainingBalance: invoice.remaining_balance,
    paidAmount: invoice.paid_amount,
  });
  if (!kind) return res.status(400).json({ message: 'No reminder is needed for this invoice' });

  // Avoid repeat reminders within 24 hours unless the tutor forces one. created_at is UTC text.
  if (body.force !== true) {
    const recent = db.prepare(`
      SELECT id FROM reminders
      WHERE invoice_id = ? AND user_id = ? AND created_at >= datetime('now', '-1 day')
      LIMIT 1
    `).get(invoice.id, req.userId);
    if (recent) {
      return res.status(409).json({ message: 'A reminder for this invoice was created in the last 24 hours' });
    }
  }

  try {
    const student = db.prepare('SELECT student_name FROM students WHERE id = ?').get(invoice.student_id);
    const template = draftReminder({
      kind,
      studentName: student.student_name,
      billingPeriod: invoice.billing_period,
      dueDate: invoice.due_date,
      remainingBalance: invoice.remaining_balance,
    });

    // Optional AI rephrase; the template is kept unless the model's text keeps every number.
    let message = template;
    let source = 'template';
    const key = process.env.FEESAATHI_AI_KEY?.trim() || '';
    if (key) {
      const prompt = [
        'Rewrite the following fee reminder message for a parent, as a polite WhatsApp-friendly message.',
        'Keep every amount, date and student name exactly as written. Do not add any new numbers.',
        'Return only the message text, nothing else.',
        '',
        `Message: ${template}`,
      ].join('\n');
      const phrased = await phraseText(key, prompt);
      if (phrased && numbersMatch(template, phrased)) {
        message = phrased;
        source = 'ai';
      }
    }

    const info = db.prepare(`
      INSERT INTO reminders (user_id, invoice_id, student_id, kind, message, status)
      VALUES (?, ?, ?, ?, ?, 'drafted')
    `).run(req.userId, invoice.id, invoice.student_id, kind, message);
    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(info.lastInsertRowid);
    return res.status(201).json({ reminder, source });
  } catch (err) {
    return next(err);
  }
});

// GET /api/reminders?invoiceId=&studentId=  (newest first)
router.get('/', (req, res) => {
  const invoiceId = optionalId(req.query.invoiceId);
  const studentId = optionalId(req.query.studentId);
  if (Number.isNaN(invoiceId) || Number.isNaN(studentId)) {
    return res.status(400).json({ message: 'invoiceId and studentId must be positive integers' });
  }

  const params = [req.userId];
  let sql = 'SELECT * FROM reminders WHERE user_id = ?';
  if (invoiceId !== null) {
    sql += ' AND invoice_id = ?';
    params.push(invoiceId);
  }
  if (studentId !== null) {
    sql += ' AND student_id = ?';
    params.push(studentId);
  }
  sql += ' ORDER BY created_at DESC, id DESC';

  const reminders = getDb().prepare(sql).all(...params);
  return res.json({ reminders });
});

// POST /api/reminders/:id/sent  (records that the tutor shared the drafted message)
router.post('/:id/sent', (req, res) => {
  const db = getDb();
  const existing = findOwnedReminder(db, req.userId, req.params.id);
  if (!existing) return res.status(404).json(REMINDER_NOT_FOUND);

  db.prepare("UPDATE reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(existing.id, req.userId);
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(existing.id);
  return res.json({ reminder });
});

export default router;
