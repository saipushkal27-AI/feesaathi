// Pure invoice rules: totals, derived status, numbering and balances. No database access.

// Rounds to 2 decimal places (money).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// total = base + additional - discount. Returns { total } or { error }.
export function computeTotal({ base_amount, additional_charges = 0, discount = 0 }) {
  const subtotal = round2(Number(base_amount) + Number(additional_charges));
  const disc = round2(Number(discount));
  if (disc > subtotal) return { error: 'Discount cannot exceed base plus additional charges' };
  const total = round2(subtotal - disc);
  if (total < 0) return { error: 'Total cannot be negative' };
  return { total };
}

// Derives the status shown to the user. Dates are YYYY-MM-DD strings.
export function computeStatus({ total, paid, dueDate, cancelled, today, storedStatus }) {
  if (cancelled) return 'cancelled';
  const remaining = round2(total - paid);
  if (remaining <= 0) return 'paid';
  if (today > dueDate) return 'overdue';
  if (paid > 0) return 'partially_paid';
  if (storedStatus === 'draft') return 'draft';
  if (storedStatus === 'sent') return 'sent';
  return 'pending';
}

// FS-YYYY-NNNN, where NNNN is the sequence after the highest existing one.
export function nextInvoiceNumber(existingMaxSeq, year) {
  return `FS-${year}-${String(existingMaxSeq + 1).padStart(4, '0')}`;
}

export function remainingBalance(total, paid) {
  return round2(total - paid);
}

// Local calendar date as YYYY-MM-DD (the host's timezone, not UTC).
export function todayIso(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
