// Pure alert rules: turns today's figures into prioritized alerts. No database access.
const RANK = { high: 0, medium: 1, low: 2 };
const OVERDUE_ALERT_DAYS = 7;

const money = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// overdueItems: { invoice_id, student_name, remaining_balance, days_overdue }
// bills: { id, name, amount, bill_status }
// forecast: { summary: { shortage_days } }
export function buildAlerts({ today, overdueItems = [], dueTomorrowCount = 0, bills = [], forecast = null }) {
  const alerts = [];

  for (const item of overdueItems) {
    if (item.days_overdue < OVERDUE_ALERT_DAYS) continue;
    const amount = item.remaining_balance ?? item.amount;
    alerts.push({
      alert_key: `overdue:${item.invoice_id}`,
      priority: 'high',
      message: `${item.student_name ?? 'A student'}'s ₹${money(amount)} tuition fee is ${item.days_overdue} days overdue.`,
      action_label: 'Generate reminder',
      action_path: '/priority',
    });
  }

  if (dueTomorrowCount > 0) {
    const noun = dueTomorrowCount === 1 ? 'fee is' : 'fees are';
    alerts.push({
      alert_key: `due_tomorrow:${today}`,
      priority: 'medium',
      message: `${dueTomorrowCount} tuition ${noun} due tomorrow.`,
      action_label: 'View pending fees',
      action_path: '/invoices',
    });
  }

  for (const bill of bills) {
    if (bill.bill_status === 'due_soon') {
      const due = bill.due_date ? `due on ${bill.due_date}` : 'due soon';
      alerts.push({
        alert_key: `bill_due_soon:${bill.id}:${today}`,
        priority: 'medium',
        message: `${bill.name} of ₹${money(bill.amount)} is ${due}.`,
        action_label: 'View bill',
        action_path: '/bills',
      });
      continue;
    }
    if (bill.bill_status !== 'overdue' && bill.bill_status !== 'due_today') continue;
    const when = bill.bill_status === 'overdue' ? 'overdue' : 'due today';
    alerts.push({
      alert_key: `bill:${bill.id}:${today}`,
      priority: 'high',
      message: `${bill.name} of ₹${money(bill.amount)} is ${when}.`,
      action_label: 'View bill',
      action_path: '/bills',
    });
  }

  const shortage = forecast?.summary?.shortage_days ?? [];
  if (shortage.length > 0) {
    alerts.push({
      alert_key: `shortage:${shortage[0]}`,
      priority: 'high',
      message: `Projected cash may become negative on ${shortage[0]}.`,
      action_label: 'Open cash forecast',
      action_path: '/forecast',
    });
  }

  return alerts.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}
