// Smart alerts: derived from invoices, bills and the cash forecast on each read, then stored so that
// read state survives. Mounted at /api/alerts behind requireAuth, so req.userId is the tutor.
import { Router } from 'express';
import { getDb } from '../db.js';
import { invoiceView } from './invoices.js';
import { billStatusFor, addDays } from '../billLogic.js';
import { todayIso } from '../invoiceLogic.js';
import { buildAlerts } from '../alertLogic.js';
import { forecastFor } from './reports.js';

const router = Router();
const NOT_FOUND = { message: 'Alert not found' };

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Inputs for buildAlerts, read from the same tables the priority, bills and forecast routes use.
function alertInputs(db, userId, today) {
  const tomorrow = addDays(today, 1);
  const names = new Map(
    db.prepare('SELECT id, student_name FROM students WHERE user_id = ?').all(userId).map((s) => [s.id, s.student_name]),
  );

  const invoices = db
    .prepare("SELECT * FROM invoices WHERE user_id = ? AND status != 'draft'")
    .all(userId)
    .map((row) => invoiceView(db, row))
    .filter((inv) => inv.status !== 'cancelled');

  const overdueItems = invoices
    .filter((inv) => inv.status === 'overdue' && inv.remaining_balance > 0)
    .map((inv) => ({
      invoice_id: inv.id,
      student_name: names.get(inv.student_id) ?? null,
      remaining_balance: inv.remaining_balance,
      days_overdue: dayNumber(today) - dayNumber(inv.due_date),
    }));

  const dueTomorrowCount = invoices.filter((inv) => inv.remaining_balance > 0 && inv.due_date === tomorrow).length;

  const bills = db
    .prepare("SELECT * FROM bills WHERE user_id = ? AND status = 'upcoming'")
    .all(userId)
    .map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.amount,
      due_date: b.due_date,
      bill_status: billStatusFor({ status: b.status, dueDate: b.due_date, today }),
    }));

  const forecast = forecastFor(db, userId, today);
  return { today, overdueItems, dueTomorrowCount, bills, forecast };
}

// Stores or refreshes one alert. read_at is never touched on update. Only a newly inserted alert
// gets its in-app delivery row. Returns the alert id.
function upsertAlert(db, userId, a) {
  const existing = db.prepare('SELECT id FROM alerts WHERE user_id = ? AND alert_key = ?').get(userId, a.alert_key);
  db.prepare(`
    INSERT INTO alerts (user_id, alert_key, priority, message, action_label, action_path)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, alert_key) DO UPDATE SET
      priority = excluded.priority,
      message = excluded.message,
      action_label = excluded.action_label,
      action_path = excluded.action_path
  `).run(userId, a.alert_key, a.priority, a.message, a.action_label, a.action_path);

  const { id } = db.prepare('SELECT id FROM alerts WHERE user_id = ? AND alert_key = ?').get(userId, a.alert_key);
  if (!existing) {
    db.prepare("INSERT INTO alert_deliveries (alert_id, channel, status, detail) VALUES (?, 'in_app', 'delivered', 'Shown in the app')")
      .run(id);
  }
  return id;
}

// The alert as the API returns it, with its delivery attempts.
function alertView(db, row) {
  const delivery = db
    .prepare('SELECT channel, status, detail FROM alert_deliveries WHERE alert_id = ? ORDER BY id')
    .all(row.id);
  return {
    id: row.id,
    alert_key: row.alert_key,
    priority: row.priority,
    message: row.message,
    action_label: row.action_label,
    action_path: row.action_path,
    read: row.read_at !== null,
    read_at: row.read_at,
    delivery,
  };
}

// GET /api/alerts: current alerts, newest first, with the unread count.
router.get('/', (req, res) => {
  const db = getDb();
  const current = buildAlerts(alertInputs(db, req.userId, todayIso()));

  const ids = db.transaction(() => current.map((a) => upsertAlert(db, req.userId, a)))();
  const rows = ids.length
    ? db
        .prepare(`SELECT * FROM alerts WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`)
        .all(req.userId, ...ids)
    : [];

  const alerts = rows.map((row) => alertView(db, row));
  const unread_count = alerts.filter((a) => !a.read).length;
  return res.json({ alerts, unread_count });
});

// POST /api/alerts/read-all
router.post('/read-all', (req, res) => {
  const info = getDb()
    .prepare("UPDATE alerts SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(req.userId);
  return res.json({ updated: info.changes });
});

// POST /api/alerts/:id/read
router.post('/:id/read', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM alerts WHERE id = ? AND user_id = ?').get(id, req.userId)
    : undefined;
  if (!row) return res.status(404).json(NOT_FOUND);

  db.prepare("UPDATE alerts SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?")
    .run(id, req.userId);
  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  return res.json({ alert: alertView(db, updated) });
});

// POST /api/alerts/:id/unread
router.post('/:id/unread', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM alerts WHERE id = ? AND user_id = ?').get(id, req.userId)
    : undefined;
  if (!row) return res.status(404).json(NOT_FOUND);

  db.prepare('UPDATE alerts SET read_at = NULL WHERE id = ? AND user_id = ?')
    .run(id, req.userId);
  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  return res.json({ alert: alertView(db, updated) });
});

export default router;
