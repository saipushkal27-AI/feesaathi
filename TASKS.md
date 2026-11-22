# FeeSaathi — Milestone Tracker

Source: FeeSaathi Master Development Prompt (CodeBenders Hackathon 2026, Problem Statement 1). Stack: React (Vite) + Express + SQLite.

Status key: [ ] not started, [~] in progress, [x] done.

Last verified: npm test -w server 146/146 passing (includes reminder AI draft tests and bill due-soon alert test); npm run build -w client 60 modules. Not browser-tested.

## Milestone 1 — Foundation, Auth and Onboarding (complete; browser end-to-end check of register/onboarding/logout not verified)
- [x] Monorepo setup (root workspaces, server, client)
- [x] Server: SQLite schema, register/login/logout, password reset, /me
- [x] Server: onboarding validation and save (business setup form)
- [x] Server tests for auth and onboarding (9 passing)
- [x] Client: global styles and app shell with bottom navigation
- [x] Client: Login, Register, Forgot/Reset Password pages
- [x] Client: Onboarding screen (3 steps)
- [x] Client: route guards (signed-out, not onboarded, onboarded)
- [x] Client build passes

## Milestone 2 — Students and Fee Invoices
- [x] Student module: add/edit/search/filter/archive, parent details, fee and frequency
- [x] Student profile: invoices, payments, pending and overdue balances done; reminder history not started
- [x] Invoice generation: server and screens done (types, discounts, auto FS-YYYY-NNNN numbers, create, edit); PDF not done, see share item
- [x] Invoice statuses: server and invoice screens done
- [~] Invoice share done (copy message, WhatsApp link); invoice PDF via the browser print dialog on the invoice page (Save as PDF), no generated PDF file yet
- [x] Quick Add Student and Quick Create Invoice workflows, CSV student import

## Milestone 3 — Payments, Follow-ups and Priority Recovery
- [x] Record payments (full, partial, multiple per invoice, method, reference) with audit trail for corrections
- [x] Duplicate payment prevention
- [x] AI-drafted reminder messages (upcoming, overdue, partial), edit/copy/share, mark as sent, reminder history (AI phrasing when FEESAATHI_AI_KEY is set, template fallback)
- [x] Priority Fee Recovery action centre (overdue ordering, one-by-one reminders)
- [x] Home dashboard: received, pending, overdue, upcoming, today's actions, student follow-up list

## Milestone 4 — Expenses and Bills
- [x] Expense tracker: categories, receipt attachment, today/monthly totals, category breakdown
- [x] Bills module: recurrence (one-time, weekly, monthly, quarterly, yearly, custom), due soon/today/overdue
- [x] Bill payment records a single cash outflow (no double counting with expenses)
- [x] Bill due alerts

## Milestone 5 — Cash Flow Forecast and What-If Simulator (mandatory)
- [x] 30/60/90-day forecast from invoices, due dates, bills, recurring expenses, opening cash
- [x] Separate confirmed, expected, estimated and bill amounts; labelled assumptions
- [x] Projected balance chart and shortage-day detection
- [x] What-If simulator: late payment, multiple delays, student leaves, expense increase, early bill payment (does not change real records)

## Milestone 6 — AI Assistant, Alerts, Reports and Polish (mandatory items)
- [x] FeeSaathi AI chat answering from backend calculations; fallback when AI is unavailable; API key kept on server
- [x] Smart alerts with priority, action buttons, read/unread, notification history, real delivery status (in-app alerts built; no push; not browser-tested)
- [~] Reports: monthly collection, outstanding, overdue, student-wise, monthly expenses, upcoming bills, 30–90 day forecast; date filters; CSV/PDF export (server and screens built with CSV; PDF via browser print (Save as PDF) added; no generated PDF file)
- [x] Settings page, More section (Settings built)
- [~] Responsive QA on phone/tablet/desktop (responsive QA: phone media query added, not browser-tested)
- [x] README with setup and run instructions
