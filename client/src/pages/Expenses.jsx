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

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function labelFor(list, value) {
  return list.find((o) => o.value === value)?.label || String(value || '');
}

function emptyValues() {
  return { title: '', amount: '', category: '', expense_date: todayISO(), payment_method: '', description: '' };
}

// Returns { field: message } for missing or invalid required fields.
function validateExpense(v) {
  const errors = {};
  const blank = (s) => String(s ?? '').trim() === '';
  if (blank(v.title)) errors.title = 'This field is required';
  if (blank(v.amount)) errors.amount = 'This field is required';
  else if (!(Number(v.amount) > 0)) errors.amount = 'Enter an amount greater than 0';
  if (blank(v.category)) errors.category = 'Select a category';
  if (blank(v.payment_method)) errors.payment_method = 'Select a payment method';
  return errors;
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

// Defined at module level so inputs keep focus across re-renders.
function Field({ name, label, required, value, onChange, disabled, error, type = 'text', as, children, ...rest }) {
  const Tag = as || 'input';
  return (
    <div className="field">
      <label htmlFor={`expense-${name}`}>{label}{required ? ' *' : ''}</label>
      <Tag
        id={`expense-${name}`}
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

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: '#555' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function Expenses() {
  const [summary, setSummary] = useState({ today_total: 0, month_total: 0, total: 0 });
  const [byCategory, setByCategory] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState(emptyValues);
  const [localErrors, setLocalErrors] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    const query = params.toString();
    Promise.all([
      api(`/api/expenses${query ? `?${query}` : ''}`),
      api('/api/expenses/summary'),
    ])
      .then(([list, sum]) => {
        if (cancelled) return;
        setExpenses(list.expenses || []);
        setByCategory(list.by_category || []);
        setSummary({
          today_total: Number(sum.today_total) || 0,
          month_total: Number(sum.month_total) || 0,
          total: Number(sum.total) || 0,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [category, reloadKey]);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  function set(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function save(e) {
    e.preventDefault();
    const errs = validateExpense(values);
    setLocalErrors(errs);
    setServerErrors({});
    setFormError('');
    if (Object.keys(errs).length > 0) return;

    const body = {
      title: values.title.trim(),
      amount: Number(values.amount),
      category: values.category,
      payment_method: values.payment_method,
    };
    if (values.expense_date) body.expense_date = values.expense_date;
    if (values.description.trim() !== '') body.description = values.description.trim();

    setSubmitting(true);
    try {
      await api('/api/expenses', { method: 'POST', body });
      setValues(emptyValues());
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

  async function remove(exp) {
    if (!window.confirm(`Delete expense "${exp.title}"?`)) return;
    setActionError('');
    try {
      await api(`/api/expenses/${exp.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      // 409 means the expense came from a bill payment; the server message explains it.
      setActionError(err.message);
    }
  }

  const errorFor = (name) => localErrors[name] || serverErrors[name];
  const f = (name) => ({ value: values[name], onChange: set, disabled: submitting, error: errorFor(name) });

  const maxCategoryTotal = Math.max(0, ...byCategory.map((c) => Number(c.total) || 0));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">Expenses</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ Add expense'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Stat label="Today" value={rupees.format(summary.today_total)} />
        <Stat label="This month" value={rupees.format(summary.month_total)} />
        <Stat label="Total" value={rupees.format(summary.total)} />
      </div>

      {byCategory.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>By category</strong>
          {byCategory.map((c) => {
            const total = Number(c.total) || 0;
            const pct = maxCategoryTotal > 0 ? (total / maxCategoryTotal) * 100 : 0;
            return (
              <div key={c.category} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                  <span>{labelFor(CATEGORIES, c.category)}</span>
                  <span>{rupees.format(total)}</span>
                </div>
                <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, background: '#2563eb', height: '100%' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <form className="card" onSubmit={save} noValidate style={{ marginBottom: 16 }}>
          {formError && <div className="form-error">{formError}</div>}
          <Field name="title" label="Title" required {...f('title')} />
          <Field name="amount" label="Amount (₹)" required type="number" min="0" step="any" {...f('amount')} />
          <Field name="category" label="Category" required as="select" {...f('category')}>
            <option value="">Select a category</option>
            {CATEGORIES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Field>
          <Field name="expense_date" label="Date" type="date" {...f('expense_date')} />
          <Field name="payment_method" label="Payment method" required as="select" {...f('payment_method')}>
            <option value="">Select a method</option>
            {METHODS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Field>
          <Field name="description" label="Description" as="textarea" rows={2} {...f('description')} />
          <div className="inline-field">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save expense'}
            </button>
          </div>
        </form>
      )}

      <div className="field">
        <label htmlFor="expense-filter-category">Category</label>
        <select id="expense-filter-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && <p>Loading expenses...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}
      {actionError && <div className="form-error">{actionError}</div>}

      {!loading && !loadError && expenses.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No expenses yet. Use "+ Add expense" to record one.</p>
        </div>
      )}

      {!loading && !loadError && expenses.map((exp) => (
        <div key={exp.id} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong>{exp.title}</strong>
            <strong>{rupees.format(Number(exp.amount) || 0)}</strong>
          </div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            {String(exp.expense_date || '').slice(0, 10)} · {labelFor(CATEGORIES, exp.category)} · {labelFor(METHODS, exp.payment_method)}
          </div>
          {exp.description && <div style={{ fontSize: '0.9rem' }}>{exp.description}</div>}
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button type="button" className="btn btn-secondary" onClick={() => remove(exp)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
