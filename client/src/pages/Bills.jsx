import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORIES = [
  { value: 'teaching_materials', label: 'Teaching materials' },
  { value: 'books_stationery', label: 'Books & stationery' },
  { value: 'internet', label: 'Internet' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'rent', label: 'Rent' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'staff', label: 'Staff' },
  { value: 'other', label: 'Other' },
];

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

const RECURRENCES = [
  { value: 'one_time', label: 'One time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom interval' },
];

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due today' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGES = {
  overdue: { label: 'Overdue', bg: '#fde2e1', fg: '#b42318' },
  due_today: { label: 'Due today', bg: '#fff1e0', fg: '#b45309' },
  due_soon: { label: 'Due soon', bg: '#fff1e0', fg: '#b45309' },
  upcoming: { label: 'Upcoming', bg: '#e2e8f0', fg: '#334155' },
  paid: { label: 'Paid', bg: '#dcfce7', fg: '#166534' },
  cancelled: { label: 'Cancelled', bg: '#e5e7eb', fg: '#6b7280' },
};

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function labelFor(list, value) {
  return list.find((o) => o.value === value)?.label || String(value || '');
}

function recurrenceText(bill) {
  if (bill.recurrence === 'custom' && bill.recurrence_interval_days) {
    return `Every ${bill.recurrence_interval_days} days`;
  }
  return labelFor(RECURRENCES, bill.recurrence);
}

// Accepts either { field: msg } or [{ field, message }] from the server.
function normalizeFieldErrors(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (const item of raw) {
      const key = item.field || item.path;
      if (key && !out[key]) out[key] = item.message || String(item);
    }
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v[0] : String(v);
  return out;
}

function validateBill(v) {
  const errors = {};
  const blank = (s) => String(s ?? '').trim() === '';
  if (blank(v.name)) errors.name = 'This field is required';
  if (blank(v.amount)) errors.amount = 'This field is required';
  else if (!(Number(v.amount) > 0)) errors.amount = 'Enter an amount greater than 0';
  if (blank(v.due_date)) errors.due_date = 'This field is required';
  if (blank(v.category)) errors.category = 'Select a category';
  if (blank(v.recurrence)) errors.recurrence = 'Select a recurrence';
  if (v.recurrence === 'custom') {
    const n = Number(v.recurrence_interval_days);
    if (blank(v.recurrence_interval_days)) errors.recurrence_interval_days = 'Required for a custom recurrence';
    else if (!Number.isInteger(n) || n < 1) errors.recurrence_interval_days = 'Enter a whole number of days, 1 or more';
  }
  return errors;
}

function validatePayment(v) {
  const errors = {};
  const blank = (s) => String(s ?? '').trim() === '';
  if (blank(v.amount)) errors.amount = 'This field is required';
  else if (!(Number(v.amount) > 0)) errors.amount = 'Enter an amount greater than 0';
  if (blank(v.payment_method)) errors.payment_method = 'Select a payment method';
  return errors;
}

// Defined at module level so inputs keep focus across re-renders.
function Field({ prefix = 'bill', name, label, required, value, onChange, disabled, error, type = 'text', as, children, ...rest }) {
  const Tag = as || 'input';
  return (
    <div className="field">
      <label htmlFor={`${prefix}-${name}`}>{label}{required ? ' *' : ''}</label>
      <Tag
        id={`${prefix}-${name}`}
        name={name}
        type={Tag === 'input' ? type : undefined}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        disabled={disabled}
        {...rest}
      >
        {children}
      </Tag>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_BADGES[status] || { label: String(status || ''), bg: '#e5e7eb', fg: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: '0.8rem', fontWeight: 600, background: c.bg, color: c.fg,
    }}>
      {c.label}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: '#555' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function emptyBill() {
  return { name: '', vendor: '', amount: '', due_date: todayISO(), category: '', recurrence: 'one_time', recurrence_interval_days: '' };
}

export default function Bills() {
  const [summary, setSummary] = useState({ due_today: 0, overdue: 0, due_soon: 0, upcoming_total: 0 });
  const [bills, setBills] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState(emptyBill);
  const [localErrors, setLocalErrors] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [payingId, setPayingId] = useState(null);
  const [payValues, setPayValues] = useState({ amount: '', payment_method: '', paid_on: todayISO() });
  const [payErrors, setPayErrors] = useState({});
  const [payError, setPayError] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([api('/api/bills'), api('/api/bills/summary')])
      .then(([list, sum]) => {
        if (cancelled) return;
        setBills(list.bills || []);
        setSummary({
          due_today: Number(sum.due_today) || 0,
          overdue: Number(sum.overdue) || 0,
          due_soon: Number(sum.due_soon) || 0,
          upcoming_total: Number(sum.upcoming_total) || 0,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  function set(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function setPay(name, value) {
    setPayValues((prev) => ({ ...prev, [name]: value }));
  }

  async function save(e) {
    e.preventDefault();
    const errs = validateBill(values);
    setLocalErrors(errs);
    setServerErrors({});
    setFormError('');
    if (Object.keys(errs).length > 0) return;

    const body = {
      name: values.name.trim(),
      amount: Number(values.amount),
      due_date: values.due_date,
      category: values.category,
      recurrence: values.recurrence,
    };
    if (values.vendor.trim() !== '') body.vendor = values.vendor.trim();
    if (values.recurrence === 'custom') body.recurrence_interval_days = Number(values.recurrence_interval_days);

    setSubmitting(true);
    try {
      await api('/api/bills', { method: 'POST', body });
      setValues(emptyBill());
      setLocalErrors({});
      setShowForm(false);
      reload();
    } catch (err) {
      setFormError(err.message);
      setServerErrors(normalizeFieldErrors(err.fieldErrors));
    } finally {
      setSubmitting(false);
    }
  }

  function openPayment(bill) {
    setPayingId(bill.id);
    setPayValues({ amount: String(bill.amount ?? ''), payment_method: '', paid_on: todayISO() });
    setPayErrors({});
    setPayError('');
  }

  async function recordPayment(e, bill) {
    e.preventDefault();
    const errs = validatePayment(payValues);
    setPayErrors(errs);
    setPayError('');
    if (Object.keys(errs).length > 0) return;

    const body = {
      amount: Number(payValues.amount),
      payment_method: payValues.payment_method,
    };
    if (payValues.paid_on) body.paid_on = payValues.paid_on;

    setPaySubmitting(true);
    try {
      await api(`/api/bills/${bill.id}/pay`, { method: 'POST', body });
      setPayingId(null);
      reload();
    } catch (err) {
      // 409 means already paid or cancelled; show the server message.
      setPayError(err.message);
      setPayErrors(normalizeFieldErrors(err.fieldErrors));
    } finally {
      setPaySubmitting(false);
    }
  }

  async function cancelBill(bill) {
    if (!window.confirm(`Cancel bill "${bill.name}"?`)) return;
    setActionError('');
    try {
      await api(`/api/bills/${bill.id}/cancel`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  }

  const errorFor = (name) => localErrors[name] || serverErrors[name];
  const f = (name) => ({ value: values[name], onChange: set, disabled: submitting, error: errorFor(name) });
  const pf = (name) => ({ prefix: `pay-${payingId}`, value: payValues[name], onChange: setPay, disabled: paySubmitting, error: payErrors[name] });

  const visibleBills = filter ? bills.filter((b) => b.bill_status === filter) : bills;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">Bills</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ Add bill'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <Stat label="Due today" value={summary.due_today} />
        <Stat label="Overdue" value={summary.overdue} />
        <Stat label="Due soon" value={summary.due_soon} />
        <Stat label="Upcoming total" value={rupees.format(summary.upcoming_total)} />
      </div>

      {showForm && (
        <form className="card" onSubmit={save} noValidate style={{ marginBottom: 16 }}>
          {formError && <div className="form-error">{formError}</div>}
          <Field name="name" label="Name" required {...f('name')} />
          <Field name="vendor" label="Vendor" {...f('vendor')} />
          <Field name="amount" label="Amount (₹)" required type="number" min="0" step="any" {...f('amount')} />
          <Field name="due_date" label="Due date" required type="date" {...f('due_date')} />
          <Field name="category" label="Category" required as="select" {...f('category')}>
            <option value="">Select a category</option>
            {CATEGORIES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Field>
          <Field name="recurrence" label="Recurrence" required as="select" {...f('recurrence')}>
            {RECURRENCES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Field>
          {values.recurrence === 'custom' && (
            <Field name="recurrence_interval_days" label="Every how many days" required type="number" min="1" step="1" {...f('recurrence_interval_days')} />
          )}
          <div className="inline-field">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save bill'}
            </button>
          </div>
        </form>
      )}

      <div className="field">
        <label htmlFor="bill-filter-status">Show</label>
        <select id="bill-filter-status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && <p>Loading bills...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}
      {actionError && <div className="form-error">{actionError}</div>}

      {!loading && !loadError && visibleBills.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No bills here yet. Use "+ Add bill" to add one.</p>
        </div>
      )}

      {!loading && !loadError && visibleBills.map((b) => {
        const canPay = b.bill_status !== 'paid' && b.bill_status !== 'cancelled';
        const canCancel = b.bill_status !== 'cancelled';
        const due = String(b.next_due_date || b.due_date || '').slice(0, 10);
        return (
          <div key={b.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>{b.name}</h2>
              <StatusBadge status={b.bill_status} />
            </div>
            {b.vendor && <div>Vendor: {b.vendor}</div>}
            <div>Amount: {rupees.format(Number(b.amount) || 0)}</div>
            <div>Due: {due}</div>
            <div>Recurrence: {recurrenceText(b)}</div>

            {payingId === b.id && (
              <form onSubmit={(e) => recordPayment(e, b)} noValidate style={{ marginTop: 8 }}>
                {payError && <div className="form-error">{payError}</div>}
                <Field name="amount" label="Amount (₹)" required type="number" min="0" step="any" {...pf('amount')} />
                <Field name="payment_method" label="Payment method" required as="select" {...pf('payment_method')}>
                  <option value="">Select a method</option>
                  {METHODS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Field>
                <Field name="paid_on" label="Paid on" type="date" {...pf('paid_on')} />
                <div className="inline-field">
                  <button type="button" className="btn btn-secondary" onClick={() => setPayingId(null)} disabled={paySubmitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={paySubmitting}>
                    {paySubmitting ? 'Saving...' : 'Save payment'}
                  </button>
                </div>
              </form>
            )}

            {(canPay || canCancel) && payingId !== b.id && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {canPay && (
                  <button type="button" className="btn btn-primary" onClick={() => openPayment(b)}>
                    Record payment
                  </button>
                )}
                {canCancel && (
                  <button type="button" className="btn btn-secondary" onClick={() => cancelBill(b)}>
                    Cancel bill
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
