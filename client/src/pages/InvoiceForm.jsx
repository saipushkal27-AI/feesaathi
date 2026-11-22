import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const INVOICE_TYPES = ['monthly', 'weekly', 'per_class', 'custom', 'additional'];

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Today's date in the user's local timezone as YYYY-MM-DD (not UTC).
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns { field: message } for missing or invalid required fields.
export function validateInvoiceForm(values) {
  const errors = {};
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  if (blank(values?.student_id)) errors.student_id = 'Select a student';
  if (blank(values?.billing_period)) errors.billing_period = 'This field is required';
  if (blank(values?.due_date)) errors.due_date = 'This field is required';
  if (blank(values?.base_amount)) {
    errors.base_amount = 'This field is required';
  } else {
    const n = Number(values.base_amount);
    if (!Number.isFinite(n) || n < 0) errors.base_amount = 'Enter an amount of 0 or more';
  }
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
      <label htmlFor={`invoice-${name}`}>{label}{required ? ' *' : ''}</label>
      <Tag
        id={`invoice-${name}`}
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

let nextRowKey = 1;

export default function InvoiceForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams(); // present only on /invoices/:id/edit
  const editing = Boolean(id);
  const [loaded, setLoaded] = useState(!editing);
  const [students, setStudents] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [values, setValues] = useState(() => ({
    student_id: searchParams.get('student_id') || '',
    invoice_type: 'monthly',
    billing_period: '',
    issue_date: localToday(),
    due_date: '',
    base_amount: '',
    discount: '',
    description: '',
  }));
  const [charges, setCharges] = useState([]);
  const [localErrors, setLocalErrors] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/api/students?status=active')
      .then((data) => {
        if (!cancelled) setStudents(Array.isArray(data) ? data : data.students || []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  // Edit mode: prefill from the saved invoice.
  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    api(`/api/invoices/${id}`)
      .then((d) => {
        if (cancelled) return;
        const inv = d.invoice || {};
        setValues({
          student_id: String(inv.student_id ?? ''),
          invoice_type: inv.invoice_type || 'monthly',
          billing_period: inv.billing_period || '',
          issue_date: inv.issue_date || '',
          due_date: inv.due_date || '',
          base_amount: String(inv.base_amount ?? ''),
          discount: String(inv.discount ?? ''),
          description: inv.description || '',
        });
        setCharges((d.items || [])
          .filter((i) => i.kind === 'additional')
          .map((i) => ({ key: nextRowKey++, label: i.label || '', amount: String(i.amount ?? '') })));
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => { cancelled = true; };
  }, [id]);

  function set(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function addCharge() {
    setCharges((prev) => [...prev, { key: nextRowKey++, label: '', amount: '' }]);
  }

  function updateCharge(key, name, value) {
    setCharges((prev) => prev.map((c) => (c.key === key ? { ...c, [name]: value } : c)));
  }

  function removeCharge(key) {
    setCharges((prev) => prev.filter((c) => c.key !== key));
  }

  const base = Number(values.base_amount) || 0;
  const discount = Number(values.discount) || 0;
  const additionalSum = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const total = base + additionalSum - discount;

  async function submit(withStatus) {
    const errs = validateInvoiceForm(values);
    setLocalErrors(errs);
    setServerErrors({});
    setFormError('');
    if (Object.keys(errs).length > 0) return;

    const student = students.find((s) => String(s.id) === String(values.student_id));
    const body = {
      student_id: student ? student.id : values.student_id,
      invoice_type: values.invoice_type,
      billing_period: values.billing_period.trim(),
      due_date: values.due_date,
      base_amount: Number(values.base_amount),
    };
    if (values.issue_date.trim() !== '') body.issue_date = values.issue_date;
    if (values.discount.trim() !== '') body.discount = Number(values.discount);
    if (values.description.trim() !== '') body.description = values.description.trim();
    const filled = charges.filter((c) => c.label.trim() !== '' || c.amount.trim() !== '');
    if (filled.length > 0) {
      body.additional_charges = filled.map((c) => ({ label: c.label.trim(), amount: Number(c.amount) || 0 }));
    }
    if (withStatus) body.status = 'draft';

    setSubmitting(true);
    try {
      const invoice = editing
        ? await api(`/api/invoices/${id}`, { method: 'PUT', body })
        : await api('/api/invoices', { method: 'POST', body });
      navigate('/invoices/' + invoice.id);
    } catch (err) {
      setFormError(err.message);
      setServerErrors(normalizeFieldErrors(err.fieldErrors));
    } finally {
      setSubmitting(false);
    }
  }

  const errorFor = (name) => localErrors[name] || serverErrors[name];
  const f = (name) => ({ value: values[name], onChange: set, disabled: submitting, error: errorFor(name) });

  return (
    <div>
      <h1 className="page-title">{editing ? 'Edit invoice' : 'New invoice'}</h1>

      {loadError && <div className="form-error">{loadError}</div>}
      {formError && <div className="form-error">{formError}</div>}

      <form onSubmit={(e) => e.preventDefault()} noValidate>
        <Field name="student_id" label="Student" required as="select" {...f('student_id')}>
          <option value="">Select a student</option>
          {students.map((s) => (
            <option key={s.id} value={String(s.id)}>{s.student_name}</option>
          ))}
        </Field>

        <Field name="invoice_type" label="Invoice type" as="select" {...f('invoice_type')}>
          {INVOICE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </Field>

        <Field name="billing_period" label="Billing period" required {...f('billing_period')} />
        <Field name="issue_date" label="Issue date" type="date" {...f('issue_date')} />
        <Field name="due_date" label="Due date" required type="date" {...f('due_date')} />
        <Field name="base_amount" label="Base amount (₹)" required type="number" min="0" step="any" {...f('base_amount')} />

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Additional charges</strong>
            <button type="button" className="btn btn-secondary" onClick={addCharge} disabled={submitting}>
              + Add charge
            </button>
          </div>
          {charges.length === 0 && <p style={{ margin: 0 }}>None</p>}
          {charges.map((c) => (
            <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                <label htmlFor={`charge-label-${c.key}`}>Label</label>
                <input
                  id={`charge-label-${c.key}`}
                  type="text"
                  value={c.label}
                  disabled={submitting}
                  onChange={(e) => updateCharge(c.key, 'label', e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor={`charge-amount-${c.key}`}>Amount (₹)</label>
                <input
                  id={`charge-amount-${c.key}`}
                  type="number"
                  min="0"
                  step="any"
                  value={c.amount}
                  disabled={submitting}
                  onChange={(e) => updateCharge(c.key, 'amount', e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => removeCharge(c.key)} disabled={submitting}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <Field name="discount" label="Discount (₹)" type="number" min="0" step="any" {...f('discount')} />
        <Field name="description" label="Description" as="textarea" rows={2} {...f('description')} />

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>Total</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{rupees.format(total)}</div>
        </div>

        <div className="inline-field">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(editing ? '/invoices/' + id : '/invoices')} disabled={submitting}>
            Cancel
          </button>
          {editing ? (
            <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={submitting || !loaded}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save as draft'}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save and mark pending'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
