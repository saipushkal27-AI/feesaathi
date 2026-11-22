// Pure reminder rules: which kind of reminder an invoice needs and the draft message text. No database access.

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_DAYS = 3;
const SKIP_STATUSES = ['cancelled', 'paid', 'draft'];

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// YYYY-MM-DD to a UTC day number, so date differences are whole days.
const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

// Returns 'overdue', 'partial', 'upcoming' or null (no reminder needed).
export function chooseReminderKind({ status, dueDate, today, remainingBalance, paidAmount }) {
  if (status === 'overdue') return 'overdue';
  if (SKIP_STATUSES.includes(status)) return null;
  if (paidAmount > 0 && remainingBalance > 0) return 'partial';
  const daysUntilDue = dayNumber(dueDate) - dayNumber(today);
  if (daysUntilDue >= 0 && daysUntilDue <= UPCOMING_WINDOW_DAYS) return 'upcoming';
  return null;
}

// Message text for a reminder of the given kind.
export function draftReminder({ kind, studentName, billingPeriod, dueDate, remainingBalance }) {
  const rupees = money.format(remainingBalance);
  switch (kind) {
    case 'upcoming':
      return `Hello! This is a gentle reminder that ${studentName}'s tuition fee for ${billingPeriod} is due on ${dueDate}. Kindly arrange the payment at your convenience. Thank you!`;
    case 'overdue':
      return `Hello! We would like to remind you that ${studentName}'s tuition fee of ${rupees} is still pending. Kindly let us know when we can expect the payment. Thank you for your cooperation.`;
    case 'partial':
      return `Hello! Thank you for the payment received. The remaining tuition fee balance for ${studentName} is ${rupees}. Kindly arrange the remaining payment when convenient.`;
    default:
      throw new Error(`Unknown reminder kind: ${kind}`);
  }
}
