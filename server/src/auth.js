// Password hashing, JWT session cookies and the requireAuth middleware.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const COOKIE_NAME = 'fs_token';
const DEV_SECRET = 'dev-only-insecure-secret';
const SECRET = process.env.JWT_SECRET || DEV_SECRET;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set. Using a dev-only insecure fallback secret. Do NOT use in production.');
}

const baseCookie = { httpOnly: true, sameSite: 'lax', path: '/' };

export const hashPassword = (password) => bcrypt.hashSync(password, 10);
export const verifyPassword = (password, hash) => bcrypt.compareSync(password, hash);

export function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, { ...baseCookie, maxAge: SESSION_TTL_MS });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, baseCookie);
}

// Reads the session cookie, verifies it and sets req.userId. Responds 401 otherwise.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = Number(payload.sub);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session is invalid or expired' });
  }
}
