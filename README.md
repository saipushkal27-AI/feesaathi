# FeeSaathi

Your Teaching Business, Financially in Control.

FeeSaathi helps home tutors and small coaching owners track student fees, payments, expenses, bills and cash flow in one place. It is built for independent tutors and small coaching businesses in India who manage fees by hand or in scattered notes.

## Tech stack

- Client: React with Vite (dev server on port 5173)
- Server: Express with SQLite through better-sqlite3 (port 4000 by default)
- npm workspaces: `client` and `server`, managed from the repo root

## Prerequisites

- Node.js and npm (a current LTS release is recommended)
- Check the install:
  - Windows PowerShell: `node -v` and `npm -v`
  - macOS/Linux: the same commands

## Setup

From the repo root, install all workspace dependencies once:

```
npm install
```

The SQLite database file is created automatically on first run, in `server/data/` (the folder is created if missing).

## Run

Start the client and the server together from the repo root:

```
npm run dev
```

- Client: http://localhost:5173
- Server API: http://localhost:4000
- The Vite dev server proxies every `/api` request to `http://localhost:4000`, so the browser only talks to the client port.

To run each part separately, use two terminals:

```
npm run dev -w server
npm run dev -w client
```

To start the server without file watching:

```
npm start
```

## Test

Server tests (Node's built-in test runner):

```
npm test -w server
```

Client production build:

```
npm run build -w client
```

## Environment variables

Set these in the shell before starting the server. In Windows PowerShell, use `$env:NAME="value"` for the current session. Example:

```
$env:FEESAATHI_AI_KEY="your-key-here"
npm run dev
```

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FEESAATHI_DB` | No | `server/data/feesaathi.db` | Path to the SQLite database file. Tests use `:memory:`. |
| `PORT` | No | `4000` | Port the Express server listens on. |
| `FEESAATHI_AI_KEY` | No | none | API key for the AI model. Read by the server only; never sent to the browser. If unset, FeeSaathi AI answers with calculated text only. |
| `FEESAATHI_AI_MODEL` | No | `claude-sonnet-4-5` | Model name used when `FEESAATHI_AI_KEY` is set. |

## Main screens

- Home: received, pending, overdue, upcoming and today's actions
- Students: add, edit, search, filter, archive; CSV student import
- Invoices: create, edit, share by copy or WhatsApp link
- Payments: recorded from invoice detail
- Priority recovery: overdue fees in order, reminders one by one
- Expenses: categories, receipts, daily and monthly totals
- Bills: recurring and one-time bills, due soon, due today and overdue
- Cash forecast and What-If simulator: 30/60/90-day balance, shortage days, delay and expense scenarios
- FeeSaathi AI: plain-English answers to questions about fees, bills, expenses and cash
- Alerts: in-app smart alerts with read and unread state
- Reports: monthly collection, outstanding, overdue, expenses, bills and forecast, with date filters and CSV download
- Settings: built; details are not listed here

## Known limits

- Push notifications are not implemented. Alerts appear in the app only.
- Reminder messages are drafted from templates. Nothing is sent automatically.
- WhatsApp sharing opens WhatsApp with the message text. It does not pre-fill a phone number.
- Invoice PDF export is not implemented. Reports export CSV only.
- Browser testing has not been completed. Responsive checks on phone, tablet and desktop are still open.
- FeeSaathi AI answers fall back to calculated text when no `FEESAATHI_AI_KEY` is set. The AI chat has not yet been tested in a browser with a real key.
