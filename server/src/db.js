// SQLite access via better-sqlite3. The connection is opened lazily on first
// use so tests can set FEESAATHI_DB (e.g. ':memory:') before anything runs.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_FILE = path.resolve(here, '../data/feesaathi.db');

let db = null;

function migrate(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tutor_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT,
      mobile TEXT,
      city_or_area TEXT,
      currency TEXT NOT NULL DEFAULT 'INR',
      opening_cash_balance REAL NOT NULL DEFAULT 0,
      fee_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (fee_cycle IN ('monthly','weekly','per_class','custom')),
      email TEXT,
      onboarded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,          -- epoch milliseconds
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens(token_hash);

    -- Students belong to a tutor (users row). Archiving sets status; rows are never deleted.
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      student_name TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      parent_mobile TEXT NOT NULL,
      email TEXT,
      class_grade TEXT,
      subject TEXT,
      joining_date TEXT,
      address TEXT,
      notes TEXT,
      fee_amount REAL NOT NULL CHECK (fee_amount >= 0),
      fee_frequency TEXT NOT NULL
        CHECK (fee_frequency IN ('monthly','weekly','per_class','custom')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);

    -- Invoices are never hard-deleted. Paid amounts are derived from payments, not stored.
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      invoice_number TEXT NOT NULL,
      billing_period TEXT NOT NULL,
      invoice_type TEXT NOT NULL
        CHECK (invoice_type IN ('monthly','weekly','per_class','custom','additional')),
      description TEXT,
      issue_date TEXT NOT NULL,                 -- YYYY-MM-DD
      due_date TEXT NOT NULL,                   -- YYYY-MM-DD
      base_amount REAL NOT NULL CHECK (base_amount >= 0),
      additional_charges REAL NOT NULL DEFAULT 0 CHECK (additional_charges >= 0),
      discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('draft','sent','pending','partially_paid','paid','overdue','cancelled')),
      cancelled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, invoice_number)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_user_student ON invoices(user_id, student_id);

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      kind TEXT NOT NULL CHECK (kind IN ('base','additional')),
      label TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0)
    );

    -- Payments are never hard-deleted; corrections and reversals are recorded in payment_audit.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL REFERENCES students(id),
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL,               -- YYYY-MM-DD
      method TEXT NOT NULL CHECK (method IN ('cash','upi','bank_transfer','other')),
      reference TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

    CREATE TABLE IF NOT EXISTS payment_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      action TEXT NOT NULL CHECK (action IN ('created','corrected','reversed')),
      old_amount REAL,
      new_amount REAL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Reminder drafts for an invoice. Nothing is sent externally; 'sent' only records that the tutor shared it.
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      kind TEXT NOT NULL CHECK (kind IN ('upcoming','overdue','partial')),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','sent')),
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON reminders(invoice_id);

    -- Bills are recurring or one-time payables. Each bill payment writes exactly one expense row.
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      vendor TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      due_date TEXT NOT NULL,                   -- YYYY-MM-DD (next due date for recurring bills)
      category TEXT NOT NULL
        CHECK (category IN ('teaching_materials','books_stationery','internet','electricity','transportation','rent','equipment','staff','other')),
      recurrence TEXT NOT NULL
        CHECK (recurrence IN ('one_time','weekly','monthly','quarterly','yearly','custom')),
      recurrence_interval_days INTEGER,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','paid','cancelled')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bills_user_due ON bills(user_id, due_date);

    CREATE TABLE IF NOT EXISTS bill_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      paid_on TEXT NOT NULL,                    -- YYYY-MM-DD
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','upi','bank_transfer','other')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

    -- Expenses are soft-deleted (status = 'deleted'). Rows with bill_payment_id come from a bill payment.
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      category TEXT NOT NULL
        CHECK (category IN ('teaching_materials','books_stationery','internet','electricity','transportation','rent','equipment','staff','other')),
      expense_date TEXT NOT NULL,               -- YYYY-MM-DD
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','upi','bank_transfer','other')),
      description TEXT,
      receipt_name TEXT,
      bill_payment_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);

    -- Forecast inputs. Without a cash_settings row, the onboarding opening balance is used.
    CREATE TABLE IF NOT EXISTS cash_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      opening_cash REAL NOT NULL DEFAULT 0,
      opening_cash_date TEXT NOT NULL DEFAULT (date('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cash_assumptions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      collection_rate REAL NOT NULL DEFAULT 1,
      expense_factor REAL NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Smart alerts per user, keyed by alert_key. read_at is kept across re-computation.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      alert_key TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
      message TEXT NOT NULL,
      action_label TEXT NOT NULL,
      action_path TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, alert_key)
    );

    -- Delivery attempts per alert. No push service is configured, so only in_app rows are written.
    CREATE TABLE IF NOT EXISTS alert_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id),
      channel TEXT NOT NULL CHECK (channel IN ('in_app','push')),
      status TEXT NOT NULL CHECK (status IN ('delivered','not_attempted','unsupported')),
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function getDb() {
  if (db) return db;
  const file = process.env.FEESAATHI_DB || DEFAULT_DB_FILE;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = new Database(file);
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
