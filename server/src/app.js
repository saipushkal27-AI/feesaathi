// Express app factory. Kept separate from index.js so tests can mount it on an ephemeral port.
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import onboardingRouter from './routes/onboarding.js';
import studentsRouter from './routes/students.js';
import invoicesRouter from './routes/invoices.js';
import paymentsRouter from './routes/payments.js';
import remindersRouter from './routes/reminders.js';
import priorityRouter from './routes/priority.js';
import expensesRouter from './routes/expenses.js';
import billsRouter from './routes/bills.js';
import forecastRouter from './routes/forecast.js';
import aiRouter from './routes/ai.js';
import alertsRouter from './routes/alerts.js';
import reportsRouter from './routes/reports.js';
import { requireAuth } from './auth.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(cookieParser());

  // Public routes
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);

  // Protected routes
  app.use('/api/onboarding', requireAuth, onboardingRouter);
  app.use('/api/students', requireAuth, studentsRouter);
  app.use('/api/invoices', requireAuth, invoicesRouter);
  app.use('/api/payments', requireAuth, paymentsRouter);
  app.use('/api/reminders', requireAuth, remindersRouter);
  app.use('/api/expenses', requireAuth, expensesRouter);
  app.use('/api/bills', requireAuth, billsRouter);
  app.use('/api/forecast', requireAuth, forecastRouter);
  app.use('/api/ai', requireAuth, aiRouter);
  app.use('/api/alerts', requireAuth, alertsRouter);
  app.use('/api/reports', requireAuth, reportsRouter);
  app.use('/api', requireAuth, priorityRouter); // defines /priority and /dashboard/summary

  // JSON 404 for any other /api route
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    // Single-page app fallback: any GET that is not under /api returns index.html so client routes work on refresh.
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // JSON error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = err.status || err.statusCode || 500;
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') status = 409;
    if (status >= 500) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(status).json({ error: err.message });
  });

  return app;
}
