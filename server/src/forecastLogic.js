// Pure cash forecast: no database access. Builds day-by-day money in and out from the rows passed in.
// Day 0 is `today`; the window is exactly `horizonDays` days. Dates are YYYY-MM-DD strings.
import { addDays, nextDueDate } from './billLogic.js';
import { round2 } from './invoiceLogic.js';

const EXPENSE_WINDOW_DAYS = 30;
const MONEY_FIELDS = ['incoming_confirmed', 'incoming_expected', 'incoming_estimated', 'outflow_bills', 'outflow_expenses'];
const pad = (n) => String(n).padStart(2, '0');

// Calendar date for `day` in a year/month, clamped to the month's length (as in billLogic).
function monthDate(year, month, day) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

// Summary of day rows: closing balances at 30/60/90 days, lowest balance and shortage dates.
export function summarize(days) {
  let minBalance = null;
  let minDate = null;
  const shortageDays = [];
  for (const day of days) {
    if (minBalance === null || day.closing_balance < minBalance) {
      minBalance = day.closing_balance;
      minDate = day.date;
    }
    if (day.closing_balance < 0) shortageDays.push(day.date);
  }
  const closingAt = (n) => (days.length >= n ? days[n - 1].closing_balance : null);
  return {
    closing_30: closingAt(30),
    closing_60: closingAt(60),
    closing_90: closingAt(90),
    closing_end: days.length ? days[days.length - 1].closing_balance : null,
    min_balance: minBalance,
    min_balance_date: minDate,
    shortage_days: shortageDays,
  };
}

// assumptions: { collection_rate (0-1), expense_factor, expense_adjustments: [{category|null, multiplier, from_date}] }
// students: { id, status, fee_amount, fee_frequency, removed_from? }
export function buildForecast({
  today,
  horizonDays = 90,
  openingCash = 0,
  invoices = [],
  payments = [],
  bills = [],
  expenses = [],
  students = [],
  assumptions = {},
}) {
  const collectionRate = assumptions.collection_rate ?? 1;
  const expenseFactor = assumptions.expense_factor ?? 1;
  const adjustments = assumptions.expense_adjustments ?? [];
  const end = addDays(today, horizonDays - 1);

  const days = [];
  const byDate = new Map();
  for (let i = 0; i < horizonDays; i += 1) {
    const row = {
      date: addDays(today, i),
      incoming_confirmed: 0,
      incoming_expected: 0,
      incoming_estimated: 0,
      outflow_bills: 0,
      outflow_expenses: 0,
      net: 0,
      closing_balance: 0,
    };
    days.push(row);
    byDate.set(row.date, row);
  }
  // Adds to a day; dates outside the window are ignored.
  const add = (date, field, amount) => {
    const row = byDate.get(date);
    if (row && amount) row[field] += amount;
  };

  // Payments already received are inside openingCash, so they are reported only, never added again.
  const activePayments = payments.filter((p) => p.status === 'active');
  const receivedToDate = round2(
    activePayments.filter((p) => p.payment_date <= today).reduce((sum, p) => sum + Number(p.amount), 0),
  );
  const paidByInvoice = new Map();
  for (const p of activePayments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + Number(p.amount));
  }

  // Drafts and cancelled invoices never produce money.
  const live = invoices.filter((inv) => inv.status !== 'draft' && inv.status !== 'cancelled' && !inv.cancelled_at);

  // Invoice income: remaining balance on its due date; overdue balances land today.
  const overdueInvoiceIds = [];
  for (const inv of live) {
    const remaining = round2(Number(inv.total_amount) - (paidByInvoice.get(inv.id) || 0));
    if (remaining <= 0) continue;
    if (inv.due_date < today) {
      overdueInvoiceIds.push(inv.id);
      add(today, 'incoming_expected', remaining);
    } else {
      add(inv.due_date, 'incoming_expected', remaining);
    }
  }

  // Estimated fees for monthly students, on the day of their latest invoice (or the 1st) in each month
  // that has no invoice for that student yet.
  const latestDue = new Map();
  const invoicedMonths = new Set();
  for (const inv of live) {
    invoicedMonths.add(`${inv.student_id}|${inv.due_date.slice(0, 7)}`);
    if (!latestDue.has(inv.student_id) || inv.due_date > latestDue.get(inv.student_id)) {
      latestDue.set(inv.student_id, inv.due_date);
    }
  }
  const [todayYear, todayMonth] = today.split('-').map(Number);
  for (const st of students) {
    const fee = Number(st.fee_amount);
    if (st.fee_frequency !== 'monthly' || !(fee > 0)) continue;
    const anchor = latestDue.has(st.id) ? Number(latestDue.get(st.id).slice(8, 10)) : 1;
    for (let offset = 0; offset < 4; offset += 1) {
      const total = todayYear * 12 + (todayMonth - 1) + offset;
      const date = monthDate(Math.floor(total / 12), (total % 12) + 1, anchor);
      if (date < today || date > end) continue;
      if (invoicedMonths.has(`${st.id}|${date.slice(0, 7)}`)) continue;
      if (st.status !== 'active' || (st.removed_from && date >= st.removed_from)) continue;
      add(date, 'incoming_estimated', round2(fee * collectionRate));
    }
  }

  // Bills: upcoming bills only. Overdue ones are counted once, today; recurring ones then follow their schedule.
  for (const bill of bills) {
    if (bill.status !== 'upcoming') continue;
    const amount = round2(Number(bill.amount));
    const recurring = bill.recurrence !== 'one_time';
    let due = bill.due_date;
    if (due < today) {
      add(today, 'outflow_bills', amount);
      if (!recurring) continue;
      while (due !== null && due < today) due = nextDueDate(due, bill.recurrence, bill.recurrence_interval_days);
    }
    while (due !== null && due <= end) {
      add(due, 'outflow_bills', amount);
      if (!recurring) break;
      due = nextDueDate(due, bill.recurrence, bill.recurrence_interval_days);
    }
  }

  // Estimated spend: average daily spend per category over the last 30 days, excluding bill-linked rows.
  const windowStart = addDays(today, -EXPENSE_WINDOW_DAYS);
  const spendByCategory = new Map();
  for (const e of expenses) {
    if (e.status !== 'active' || e.bill_payment_id) continue;
    if (e.expense_date <= windowStart || e.expense_date > today) continue;
    spendByCategory.set(e.category, (spendByCategory.get(e.category) || 0) + Number(e.amount));
  }
  for (const row of days) {
    for (const [category, total] of spendByCategory) {
      let multiplier = 1;
      for (const adj of adjustments) {
        if ((adj.category == null || adj.category === category) && row.date >= adj.from_date) {
          multiplier *= adj.multiplier;
        }
      }
      add(row.date, 'outflow_expenses', (total / EXPENSE_WINDOW_DAYS) * expenseFactor * multiplier);
    }
  }

  // Round, then roll the balance forward from opening cash.
  let closing = round2(Number(openingCash));
  for (const row of days) {
    for (const field of MONEY_FIELDS) row[field] = round2(row[field]);
    row.net = round2(
      row.incoming_confirmed + row.incoming_expected + row.incoming_estimated - row.outflow_bills - row.outflow_expenses,
    );
    closing = round2(closing + row.net);
    row.closing_balance = closing;
  }

  return {
    days,
    summary: summarize(days),
    received_to_date: receivedToDate,
    labels: {
      incoming_confirmed: 'confirmed',
      incoming_expected: 'expected',
      incoming_estimated: 'estimated',
      outflow_bills: 'confirmed',
      outflow_expenses: 'estimated',
      overdue_invoice_ids: overdueInvoiceIds,
    },
  };
}
