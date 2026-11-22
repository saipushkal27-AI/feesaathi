// Auth routes: register, login, logout, password reset and session lookup.
import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db.js';
import { hashPassword, verifyPassword, setAuthCookie, clearAuthCookie, requireAuth } from '../auth.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MS = 30 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
const GENERIC_RESET_MSG = 'If an account exists for that email, password reset instructions have been sent.';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

export function toProfile(row) {
  if (!row) return null;
  return {
    businessName: row.business_name,
    mobile: row.mobile,
    cityOrArea: row.city_or_area,
    currency: row.currency,
    openingCashBalance: row.opening_cash_balance,
    feeCycle: row.fee_cycle,
    email: row.email,
    onboarded: !!row.onboarded,
    updatedAt: row.updated_at,
  };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const name = str(req.body?.name);
  const email = str(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const errors = {};
  if (!name) errors.name = 'Name is required';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({
      error: 'An account with this email already exists',
      errors: { email: 'An account with this email already exists' },
    });
  }

  const passwordHash = hashPassword(password);
  // Create the user and an empty profile atomically.
  const createUser = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, passwordHash);
    db.prepare('INSERT INTO tutor_profiles (user_id, email) VALUES (?, ?)').run(info.lastInsertRowid, email);
    return info.lastInsertRowid;
  });

  let userId;
  try {
    userId = createUser();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        error: 'An account with this email already exists',
        errors: { email: 'An account with this email already exists' },
      });
    }
    throw err;
  }

  setAuthCookie(res, userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return res.status(201).json({ user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const email = str(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const db = getDb();
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  setAuthCookie(res, user.id);
  return res.json({ user: publicUser(user) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/forgot-password
// Always answers generically so the endpoint does not reveal which emails exist.
router.post('/forgot-password', (req, res) => {
  const email = str(req.body?.email).toLowerCase();
  const db = getDb();
  const user = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email) : undefined;
  const body = { message: GENERIC_RESET_MSG };

  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(user.id, sha256(token), Date.now() + RESET_TTL_MS);

    // NOTE: no email provider is configured yet. In non-production builds the
    // token is returned in the response and logged so the flow can be tested.
    if (!IS_PROD) {
      body.resetToken = token;
      console.log(`[dev] Password reset token for ${email}: ${token} (expires in 30 min)`);
    }
  }
  return res.json(body);
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const token = str(req.body?.token);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  const errors = {};
  if (!token) errors.token = 'Reset token is required';
  if (newPassword.length < 8) errors.newPassword = 'Password must be at least 8 characters';
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used = 0')
    .get(sha256(token));
  if (!row || row.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.user_id);
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?').run(row.user_id);
  })();

  return res.json({ message: 'Password updated. You can now sign in.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const profile = db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(user.id);
  return res.json({ user: publicUser(user), profile: toProfile(profile) });
});

export default router;
