// Priority list and dashboard summary: derived from invoices, payments and reminders on every read.
// Mounted at /api behind requireAuth in app.js, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { invoiceView } from './invoices.js';
import { round2, todayIso } from '../invoiceLogic.js';

const router = Router();

// Whole UTC days for a YYYY-MM-DD string, so differences are not shifted by DST.
const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// YYYY-MM-DD for `days` after an ISO date.
const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const suggestedAction = (daysOverdue) => {
  if (daysOverdue >= 14) return 'Send payment reminder today';
  if (daysOverdue >= 7) return 'Follow up with parent';
  return 'Send a gentle reminder';
};

// Each invoice with its stored row (for the stored status) and its derived view.
function loadInvoices(db, userId) {
  return db
    .prepare('SELECT * FROM invoices WHERE user_id = ?')
    .all(userId)
    .map((row) => ({ row, inv: invoiceView(db, row) }));
}

// GET /api/priority: overdue invoices with a balance, most overdue first.
router.get('/priority', (req, res) => {
  const db = getDb();
  const todayDay = dayNumber(todayIso());

  const students = new Map(
    db.prepare('SELECT id, student_name, parent_name, parent_mobile FROM students WHERE user_id = ?')
      .all(req.userId)
      .map((s) => [s.id, s]),
  );
  const lastReminders = new Map(
    db.prepare('SELECT invoice_id, MAX(created_at) AS last_at FROM reminders WHERE user_id = ? GROUP BY invoice_id')
      .all(req.userId)
      .map((r) => [r.invoice_id, r.last_at]),
  );

  const items = loadInvoices(db, req.userId)
    .map(({ inv }) => inv)
    .filter((inv) => inv.remaining_balance > 0 && inv.status === 'overdue')
    .map((inv) => {
      const student = students.get(inv.student_id);
      const daysOverdue = todayDay - dayNumber(inv.due_date);
      return {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        student_id: inv.student_id,
        student_name: student?.student_name ?? null,
        parent_name: student?.parent_name ?? null,
        parent_mobile: student?.parent_mobile ?? null,
        billing_period: inv.billing_period,
        due_date: inv.due_date,
        remaining_balance: inv.remaining_balance,
        days_overdue: daysOverdue,
        last_reminder_at: lastReminders.get(inv.id) ?? null,
        suggested_action: suggestedAction(daysOverdue),
      };
    })
    .sort((a, b) => b.days_overdue - a.days_overdue || b.remaining_balance - a.remaining_balance);

  const total_outstanding_overdue = round2(items.reduce((sum, item) => sum + item.remaining_balance, 0));
  return res.json({ items, total_outstanding_overdue });
});

// GET /api/dashboard/summary
router.get('/dashboard/summary', (req, res) => {
  const db = getDb();
  const today = todayIso();
  const month = today.slice(0, 7);
  const weekEnd = addDays(today, 6); // the next 7 days, today included

  const { total: received } = db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE user_id = ? AND status = 'active' AND substr(payment_date, 1, 7) = ?
    `)
    .get(req.userId, month);

  let expected = 0;
  let outstanding = 0;
  let overdue = 0;
  let upcoming = 0;
  for (const { row, inv } of loadInvoices(db, req.userId)) {
    if (inv.status === 'cancelled') continue;
    if (row.status !== 'draft') {
      outstanding += inv.remaining_balance;
      if (inv.due_date.slice(0, 7) === month) expected += inv.total_amount;
    }
    if (inv.status === 'overdue') overdue += inv.remaining_balance;
    if (inv.remaining_balance > 0 && inv.due_date >= today && inv.due_date <= weekEnd) upcoming += 1;
  }

  return res.json({
    received_this_month: round2(received),
    expected_this_month: round2(expected),
    outstanding_total: round2(outstanding),
    overdue_total: round2(overdue),
    upcoming_due_count: upcoming,
    today,
  });
});

export default router;
