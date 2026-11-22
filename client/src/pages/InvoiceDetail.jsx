import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

const METHODS = ['cash', 'upi', 'bank_transfer', 'other'];

// Print stylesheet: hides navigation, action buttons, payment forms and Share; keeps invoice content.
const PRINT_CSS = `
@media print {
  nav, header, aside, .no-print { display: none !important; }
  body { background: #fff !important; }
}`;

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => rupees.format(Number(n) || 0);

const BADGE_COLORS = {
  overdue: { bg: '#fde2e1', fg: '#b42318' },
  pending: { bg: '#fff1e0', fg: '#b45309' },
  sent: { bg: '#fff1e0', fg: '#b45309' },
  partially_paid: { bg: '#fff1e0', fg: '#b45309' },
  paid: { bg: '#dcfce7', fg: '#166534' },
  draft: { bg: '#e5e7eb', fg: '#374151' },
  cancelled: { bg: '#e5e7eb', fg: '#374151' },
};

function StatusBadge({ status }) {
  const c = BADGE_COLORS[status] || BADGE_COLORS.draft;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: '0.8rem', fontWeight: 600, background: c.bg, color: c.fg,
    }}>
      {String(status || '').replace('_', ' ')}
    </span>
  );
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
      <label htmlFor={`pay-${name}`}>{label}{required ? ' *' : ''}</label>
      <Tag
        id={`pay-${name}`}
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

// Local date as YYYY-MM-DD.
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blankPayment() {
  return { amount: '', payment_date: todayStr(), method: 'cash', reference: '', notes: '' };
}

// Polite reminder text built only from loaded invoice fields.
function shareMessage(inv) {
  if (Number(inv.remaining_balance) <= 0) {
    return `Thank you, the invoice ${inv.invoice_number} is fully paid.`;
  }
  return `Hello! The tuition fee invoice ${inv.invoice_number} for ${inv.billing_period} of ${money(inv.total_amount)} is due on ${inv.due_date}. Pending balance: ${money(inv.remaining_balance)}. Kindly arrange the payment at your convenience. Thank you!`;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copyState, setCopyState] = useState(''); // '', 'copied', 'error'

  const [pay, setPay] = useState(blankPayment);
  const [payErrors, setPayErrors] = useState({});
  const [payFormError, setPayFormError] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(null); // { message, body } after a 409

  // Inline correct/reverse form for one payment: { id, mode: 'correct' | 'reverse', amount, reason }
  const [rowEdit, setRowEdit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    api(`/api/invoices/${id}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  // Runs a call, then reloads on success. Returns true when it succeeded.
  async function runAction(fn) {
    setActionBusy(true);
    setActionError('');
    try {
      await fn();
      setReloadKey((k) => k + 1);
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  function markSent() {
    runAction(() => api(`/api/invoices/${id}/send`, { method: 'POST' }));
  }

  function cancelInvoice() {
    if (!window.confirm('Cancel this invoice? This cannot be undone.')) return;
    runAction(() => api(`/api/invoices/${id}/cancel`, { method: 'POST' }));
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(shareMessage(data.invoice));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    setTimeout(() => setCopyState(''), 2000);
  }

  function setPayField(name, value) {
    setPay((prev) => ({ ...prev, [name]: value }));
  }

  async function sendPayment(body) {
    setPayBusy(true);
    setPayFormError('');
    setPayErrors({});
    try {
      await api('/api/payments', { method: 'POST', body });
      setPay(blankPayment());
      setDuplicate(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err.status === 409) {
        setDuplicate({ message: err.message, body });
      } else {
        setPayFormError(err.message);
        setPayErrors(normalizeFieldErrors(err.fieldErrors));
      }
    } finally {
      setPayBusy(false);
    }
  }

  function recordPayment() {
    const invoice = data.invoice;
    const remaining = Number(invoice.remaining_balance) || 0;
    const errs = {};
    const amount = Number(pay.amount);
    if (pay.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      errs.amount = 'Enter an amount greater than 0';
    } else if (amount > remaining) {
      errs.amount = `Cannot exceed the remaining balance of ${money(remaining)}`;
    }
    if (!pay.payment_date) errs.payment_date = 'This field is required';
    setPayErrors(errs);
    setPayFormError('');
    setDuplicate(null);
    if (Object.keys(errs).length > 0) return;

    const body = {
      invoice_id: invoice.id ?? id,
      amount,
      payment_date: pay.payment_date,
      method: pay.method,
    };
    if (pay.reference.trim() !== '') body.reference = pay.reference.trim();
    if (pay.notes.trim() !== '') body.notes = pay.notes.trim();
    sendPayment(body);
  }

  function recordAnyway() {
    if (!duplicate) return;
    sendPayment({ ...duplicate.body, allow_duplicate: true });
  }

  function startRowEdit(p, mode) {
    setActionError('');
    setRowEdit({ id: p.id, mode, amount: String(p.amount ?? ''), reason: '' });
  }

  async function submitRowEdit(p) {
    const reason = rowEdit.reason.trim();
    if (reason.length < 3) {
      setActionError('Reason must be at least 3 characters');
      return;
    }
    let ok;
    if (rowEdit.mode === 'correct') {
      const amount = Number(rowEdit.amount);
      if (rowEdit.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
        setActionError('Enter a corrected amount greater than 0');
        return;
      }
      ok = await runAction(() => api(`/api/payments/${p.id}/correct`, {
        method: 'POST', body: { amount, reason },
      }));
    } else {
      ok = await runAction(() => api(`/api/payments/${p.id}/reverse`, {
        method: 'POST', body: { reason },
      }));
    }
    if (ok) setRowEdit(null);
  }

  const invoice = data?.invoice;
  const items = data?.items || [];
  const payments = data?.payments || [];
  const extras = items.filter((i) => i.kind === 'additional');
  const hasActivePayment = payments.some((p) => p.status === 'active');
  const canRecord = invoice && invoice.status !== 'cancelled' && invoice.status !== 'draft';
  const canCancel = invoice && invoice.status !== 'cancelled' && !hasActivePayment;

  const details = invoice ? [
    { label: 'Student ID', value: invoice.student_id },
    { label: 'Billing period', value: invoice.billing_period },
    { label: 'Issue date', value: invoice.issue_date },
    { label: 'Due date', value: invoice.due_date },
    { label: 'Base amount', value: money(invoice.base_amount) },
    { label: 'Discount', value: money(invoice.discount) },
    { label: 'Total amount', value: money(invoice.total_amount) },
    { label: 'Paid amount', value: money(invoice.paid_amount) },
    { label: 'Remaining balance', value: money(invoice.remaining_balance), bold: true },
  ] : [];

  return (
    <div>
      <p className="no-print" style={{ margin: '8px 0 0' }}>
        <Link to="/invoices">Back to invoices</Link>
      </p>

      {loading && <p>Loading invoice...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && invoice && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h1 className="page-title">{invoice.invoice_number}</h1>
            <StatusBadge status={invoice.status} />
          </div>

          <style>{PRINT_CSS}</style>
          <div className="no-print" style={{ margin: '0 0 12px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          </div>

          <div className="card">
            {details.map((d) => (
              <div key={d.label} style={d.bold ? { fontWeight: 700 } : undefined}>
                {d.label}: {d.value || '—'}
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <strong>Additional charges</strong>
              {extras.length === 0 && <div>None</div>}
              {extras.map((x, i) => (
                <div key={x.id ?? i}>{x.label}: {money(x.amount)}</div>
              ))}
            </div>
          </div>

          {invoice.status !== 'cancelled' && (
            <div className="card no-print">
              <h3 style={{ marginTop: 0 }}>Share</h3>
              <div className="inline-field">
                <button type="button" className="btn btn-secondary" onClick={copyMessage}>
                  Copy message
                </button>
                {/* Opens WhatsApp with the text; no number is pre-filled because the parent's number is not loaded here. */}
                <a
                  className="btn btn-secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(shareMessage(invoice))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Share on WhatsApp
                </a>
              </div>
              {copyState === 'copied' && <p style={{ margin: '8px 0 0' }}>Copied</p>}
              {copyState === 'error' && <div className="form-error">Could not copy: clipboard is not available.</div>}
            </div>
          )}

          {actionError && <div className="form-error">{actionError}</div>}

          {(invoice.status === 'draft' || !hasActivePayment) && (
            <p className="no-print" style={{ margin: '0 0 12px' }}>
              <Link to={`/invoices/${id}/edit`}>Edit</Link>
            </p>
          )}

          {(invoice.status === 'draft' || canCancel) && (
            <div className="card no-print">
              <div className="inline-field">
                {invoice.status === 'draft' && (
                  <button type="button" className="btn btn-primary" onClick={markSent} disabled={actionBusy}>
                    {actionBusy ? 'Working...' : 'Mark as sent'}
                  </button>
                )}
                {canCancel && (
                  <button type="button" className="btn btn-secondary" onClick={cancelInvoice} disabled={actionBusy}>
                    Cancel invoice
                  </button>
                )}
              </div>
              {!canCancel && invoice.status !== 'cancelled' && (
                <p style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>
                  Reverse active payments before cancelling this invoice.
                </p>
              )}
            </div>
          )}

          {canRecord && (
            <div className="card no-print">
              <h3 style={{ marginTop: 0 }}>Record payment</h3>
              {payFormError && <div className="form-error">{payFormError}</div>}
              {duplicate && (
                <div className="card" style={{ background: '#fff1e0' }}>
                  <p style={{ margin: '0 0 8px' }}>{duplicate.message}</p>
                  <div className="inline-field">
                    <button type="button" className="btn btn-secondary" onClick={() => setDuplicate(null)} disabled={payBusy}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={recordAnyway} disabled={payBusy}>
                      {payBusy ? 'Recording...' : 'Record anyway'}
                    </button>
                  </div>
                </div>
              )}
              <form onSubmit={(e) => e.preventDefault()} noValidate>
                <Field name="amount" label="Amount (₹)" required type="number" min="0" step="any"
                  value={pay.amount} onChange={setPayField} disabled={payBusy} error={payErrors.amount} />
                <Field name="payment_date" label="Payment date" required type="date"
                  value={pay.payment_date} onChange={setPayField} disabled={payBusy} error={payErrors.payment_date} />
                <Field name="method" label="Method" as="select"
                  value={pay.method} onChange={setPayField} disabled={payBusy} error={payErrors.method}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m.replace('_', ' ')}</option>
                  ))}
                </Field>
                <Field name="reference" label="Reference" value={pay.reference}
                  onChange={setPayField} disabled={payBusy} error={payErrors.reference} />
                <Field name="notes" label="Notes" as="textarea" rows={2} value={pay.notes}
                  onChange={setPayField} disabled={payBusy} error={payErrors.notes} />
                <button type="button" className="btn btn-primary" onClick={recordPayment} disabled={payBusy}>
                  {payBusy ? 'Recording...' : 'Record payment'}
                </button>
              </form>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Payments</h3>
            {payments.length === 0 && <p>No payments yet</p>}
            {payments.map((p, i) => {
              const reversed = p.status === 'reversed';
              const editing = rowEdit && rowEdit.id === p.id;
              return (
                <div
                  key={p.id ?? i}
                  style={{ borderTop: '1px solid #E2E8F0', padding: '8px 0', opacity: reversed ? 0.5 : 1 }}
                >
                  <div>
                    <strong>{money(p.amount)}</strong> · {p.payment_date} · {String(p.method || '').replace('_', ' ')}
                    <span style={{ marginLeft: 8, color: reversed ? '#64748B' : '#15803D' }}>
                      {reversed ? 'Reversed' : 'Active'}
                    </span>
                  </div>
                  {p.reference && <div style={{ fontSize: '0.9rem' }}>Ref: {p.reference}</div>}
                  {p.notes && <div style={{ fontSize: '0.9rem' }}>Notes: {p.notes}</div>}

                  {!reversed && !editing && (
                    <div className="inline-field no-print" style={{ marginTop: 6 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => startRowEdit(p, 'correct')} disabled={actionBusy}>
                        Correct
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => startRowEdit(p, 'reverse')} disabled={actionBusy}>
                        Reverse
                      </button>
                    </div>
                  )}

                  {!reversed && editing && (
                    <div className="no-print" style={{ marginTop: 8 }}>
                      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
                        {rowEdit.mode === 'correct' ? 'Correct this payment' : 'Reverse this payment'}
                      </p>
                      {rowEdit.mode === 'correct' && (
                        <div className="field">
                          <label htmlFor={`row-amount-${p.id}`}>New amount (₹)</label>
                          <input
                            id={`row-amount-${p.id}`}
                            type="number"
                            min="0"
                            step="any"
                            value={rowEdit.amount}
                            disabled={actionBusy}
                            onChange={(e) => setRowEdit({ ...rowEdit, amount: e.target.value })}
                          />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor={`row-reason-${p.id}`}>Reason (min 3 characters)</label>
                        <input
                          id={`row-reason-${p.id}`}
                          type="text"
                          value={rowEdit.reason}
                          disabled={actionBusy}
                          onChange={(e) => setRowEdit({ ...rowEdit, reason: e.target.value })}
                        />
                      </div>
                      <div className="inline-field">
                        <button type="button" className="btn btn-secondary" onClick={() => setRowEdit(null)} disabled={actionBusy}>
                          Keep as is
                        </button>
                        <button type="button" className="btn btn-primary" onClick={() => submitRowEdit(p)} disabled={actionBusy}>
                          {actionBusy ? 'Saving...' : rowEdit.mode === 'correct' ? 'Save correction' : 'Confirm reversal'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
