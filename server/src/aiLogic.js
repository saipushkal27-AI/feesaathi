// FeeSaathi AI helpers: intent detection, plain-English answers and phrasing prompts.
// Pure: no database and no network. Every figure comes from the `facts` object built by the route.

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
export const money = (n) => inr.format(Number(n) || 0);

// Order matters: the first rule with a matching keyword wins.
const RULES = [
  ['overdue', ['overdue', 'late', 'pending fees', 'who owes', 'unpaid', 'not paid']],
  ['expenses', ['spent', 'expense', 'materials']],
  ['bills_week', ['bills', 'rent', 'electricity', 'pay this week']],
  ['collected_month', ['collect', 'received', 'this month']],
  ['pending_total', ['pending', 'outstanding', 'owes me the most']],
  ['forecast', ['cash', 'balance', 'next month', '30 days', 'enough money', 'projected']],
  ['contact_today', ['contact', 'follow up', 'today', 'call']],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Start-of-word match, so 'rent' does not match 'current' and 'expense' matches 'expenses'.
export function detectIntent(question) {
  const q = typeof question === 'string' ? question.trim().toLowerCase() : '';
  if (q.length < 3) return 'unclear';
  const hit = RULES.find(([, words]) => words.some((w) => new RegExp(`\\b${escapeRe(w)}`).test(q)));
  return hit ? hit[0] : 'help';
}

// Fact keys each intent reads, so the route can report what an answer was based on.
const FACTS_USED = {
  overdue: ['overdue_count', 'overdue_total', 'overdue_items'],
  expenses: ['expenses_month_total'],
  bills_week: ['bills'],
  collected_month: ['received_this_month'],
  pending_total: ['outstanding_total', 'overdue_total'],
  forecast: ['forecast'],
  contact_today: ['upcoming_due_count', 'overdue_count'],
  help: [],
  unclear: [],
};
export const factsUsedFor = (intent) => FACTS_USED[intent] ?? [];

const EXAMPLES = [
  'Who has not paid?',
  'How much did I collect this month?',
  'What is still pending?',
  'Which bills are due this week?',
  'Will I have enough money next month?',
  'Who should I contact today?',
  'How much did I spend on expenses this month?',
];

const ACTIONS = {
  overdue: ['Send reminders to the families with the oldest overdue fees.', 'Open the priority list to see each balance.'],
  expenses: ['Review this month\'s expenses by category.', 'Record any expenses that are not logged yet.'],
  bills_week: ['Pay the bills due today first.', 'Check the bills list for anything coming up soon.'],
  collected_month: ['Check the pending list for fees still to collect.'],
  pending_total: ['Start with the overdue list, which holds the oldest balances.'],
  forecast: ['Open the cash forecast to test a delay or an expense change.', 'Collect overdue fees before the lowest day.'],
  contact_today: ['Contact the parents on the priority list, most overdue first.'],
  help: ['Ask one of the example questions.'],
  unclear: ['Ask one of the example questions.'],
};

const withActions = (intent, text) => `${text} Next steps: ${ACTIONS[intent].join(' ')}`;

// Plain-English answer for an intent, built only from `facts`. Each answer ends with 1 to 3 next steps.
export function answerFor(intent, facts) {
  const f = facts || {};
  switch (intent) {
    case 'overdue': {
      if (!f.overdue_count) return withActions(intent, 'No fees are overdue right now.');
      const lines = (f.overdue_items ?? []).map(
        (i) => `${i.student_name} owes ${money(i.remaining_balance)}, ${i.days_overdue} days overdue`,
      );
      const list = lines.length ? ` Most overdue: ${lines.join('; ')}.` : '';
      return withActions(intent, `${f.overdue_count} overdue fee(s) total ${money(f.overdue_total)}.${list}`);
    }
    case 'expenses':
      return withActions(intent, `You have spent ${money(f.expenses_month_total)} on expenses this month.`);
    case 'bills_week': {
      const b = f.bills ?? {};
      return withActions(
        intent,
        `${b.due_today ?? 0} bill(s) are due today, ${b.overdue ?? 0} overdue, and ${b.due_soon ?? 0} due soon. `
          + `Upcoming bills total ${money(b.upcoming_total)} in the next month.`,
      );
    }
    case 'collected_month':
      return withActions(intent, `You have collected ${money(f.received_this_month)} this month.`);
    case 'pending_total':
      return withActions(
        intent,
        `Fees still outstanding total ${money(f.outstanding_total)}, of which ${money(f.overdue_total)} is overdue.`,
      );
    case 'forecast': {
      const c = f.forecast ?? {};
      const outlook = c.shortage_days_count > 0
        ? `Cash is projected to go negative on ${c.shortage_days_count} day(s) in the next month.`
        : 'Cash stays positive for the next month.';
      return withActions(
        intent,
        `Your projected cash balance in 30 days is ${money(c.closing_30)}. The lowest point is ${money(c.min_balance)} on ${c.min_balance_date ?? 'n/a'}. ${outlook}`,
      );
    }
    case 'contact_today':
      return withActions(
        intent,
        `${f.upcoming_due_count ?? 0} invoice(s) fall due in the coming week, and ${f.overdue_count ?? 0} are overdue.`,
      );
    case 'unclear':
      return withActions(intent, `Sorry, I did not catch that. Try one of these: ${EXAMPLES.join(' ')}`);
    default:
      return withActions('help', `I can answer questions such as: ${EXAMPLES.join(' ')}`);
  }
}

// System and user prompts that ask the model to reword the answer without changing any figure.
export function buildPhrasingPrompt(answer, facts) {
  const system = 'You rephrase short financial answers for a private tutor in India. '
    + 'Use friendly, plain English. Keep every number exactly as written, including the rupee symbol and dates. '
    + 'Do not add any new figure, name or claim. Do not drop any figure. Reply with the rephrased answer only.';
  const user = `Answer to rephrase:\n"""${answer}"""\n\n`
    + `Facts (context only; do not add figures from here that are not in the answer):\n${JSON.stringify(facts ?? {})}`;
  return { system, user };
}

// Numbers in a text, with thousands separators removed (so "₹1,23,456" becomes "123456").
export function numbersIn(text) {
  return (String(text).match(/\d[\d,]*\d|\d/g) || []).map((t) => t.replace(/,/g, ''));
}

// True only when the phrased text uses exactly the same set of numbers as the calculated answer.
export function numbersMatch(calculated, phrased) {
  const want = new Set(numbersIn(calculated));
  const got = new Set(numbersIn(phrased));
  if (want.size !== got.size) return false;
  return [...want].every((n) => got.has(n));
}
