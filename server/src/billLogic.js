// Pure bill rules: next due date and derived status. No database access.
// Dates are YYYY-MM-DD strings; arithmetic uses UTC so the host timezone does not shift days.

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};

const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Adds whole calendar months, clamping the day to the target month's length (Jan 31 + 1 = Feb 28/29).
function addMonths(iso, months) {
  const { y, m, d } = toUtc(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, lastDay));
}

function addDays(iso, days) {
  const { y, m, d } = toUtc(iso);
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Next due date after `dueDate` for a recurring bill; null for one-time bills.
export function nextDueDate(dueDate, recurrence, intervalDays) {
  switch (recurrence) {
    case 'weekly':
      return addDays(dueDate, 7);
    case 'monthly':
      return addMonths(dueDate, 1);
    case 'quarterly':
      return addMonths(dueDate, 3);
    case 'yearly':
      return addMonths(dueDate, 12);
    case 'custom':
      return addDays(dueDate, Number(intervalDays));
    default:
      return null;
  }
}

// Status shown to the user. 'paid' and 'cancelled' are kept as stored.
export function billStatusFor({ status, dueDate, today }) {
  if (status === 'paid' || status === 'cancelled') return status;
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'due_today';
  if (dueDate <= addDays(today, 3)) return 'due_soon';
  return 'upcoming';
}

export { addDays };
