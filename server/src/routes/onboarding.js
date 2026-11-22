// Tutor onboarding: stores business details and marks the profile as onboarded.
import { Router } from 'express';
import { getDb } from '../db.js';
import { publicUser, toProfile } from './auth.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const FEE_CYCLES = ['monthly', 'weekly', 'per_class', 'custom'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const orDefault = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : v);

// Accepts "9876543210", "98765 43210" or "+91 98765 43210"; returns the bare 10 digits.
function normalizeMobile(raw) {
  let s = str(raw).replace(/\s+/g, '');
  if (s.startsWith('+91')) s = s.slice(3);
  return s;
}

// POST /api/onboarding  (mounted behind requireAuth in app.js)
router.post('/', (req, res) => {
  const b = req.body || {};
  const errors = {};

  const name = str(b.name);
  if (!name) errors.name = 'Your name is required';
  else if (name.length > 100) errors.name = 'Name must be 100 characters or fewer';

  const businessName = str(b.businessName) || null;
  if (businessName && businessName.length > 120) errors.businessName = 'Business name must be 120 characters or fewer';

  const mobile = normalizeMobile(b.mobile);
  if (!mobile) errors.mobile = 'Mobile number is required';
  else if (!/^[6-9]\d{9}$/.test(mobile)) errors.mobile = 'Enter a valid 10-digit mobile number';

  const email = str(b.email).toLowerCase();
  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';

  const cityOrArea = str(b.cityOrArea) || null;

  const currency = orDefault(b.currency, 'INR');
  if (!CURRENCIES.includes(currency)) errors.currency = `Currency must be one of ${CURRENCIES.join(', ')}`;

  let openingCashBalance = 0;
  const rawOpening = orDefault(b.openingCashBalance, 0);
  if (typeof rawOpening === 'number' || typeof rawOpening === 'string') {
    openingCashBalance = Number(rawOpening);
  }
  if (!Number.isFinite(openingCashBalance) || openingCashBalance < 0) {
    errors.openingCashBalance = 'Opening cash balance must be a number of 0 or more';
  }

  const feeCycle = orDefault(b.feeCycle, 'monthly');
  if (!FEE_CYCLES.includes(feeCycle)) errors.feeCycle = `Fee cycle must be one of ${FEE_CYCLES.join(', ')}`;

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const userId = req.userId;

  const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, userId);
  if (clash) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: { email: 'This email is already used by another account' },
    });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, userId);
    db.prepare(`
      INSERT INTO tutor_profiles
        (user_id, business_name, mobile, city_or_area, currency, opening_cash_balance,
         fee_cycle, email, onboarded, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        business_name = excluded.business_name,
        mobile = excluded.mobile,
        city_or_area = excluded.city_or_area,
        currency = excluded.currency,
        opening_cash_balance = excluded.opening_cash_balance,
        fee_cycle = excluded.fee_cycle,
        email = excluded.email,
        onboarded = 1,
        updated_at = excluded.updated_at
    `).run(userId, businessName, mobile, cityOrArea, currency, openingCashBalance, feeCycle, email);
  })();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const profile = db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(userId);
  return res.json({ user: publicUser(user), profile: toProfile(profile) });
});

export default router;
