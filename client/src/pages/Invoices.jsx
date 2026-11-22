import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'cancelled', label: 'Cancelled' },
];

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

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

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [outstanding, setOutstanding] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const query = params.toString();
    api(`/api/invoices${query ? `?${query}` : ''}`)
      .then((data) => {
        if (cancelled) return;
        setInvoices(Array.isArray(data) ? data : data.invoices || []);
        setOutstanding(Number(data.outstanding_total) || 0);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">Invoices</h1>
        <Link to="/invoices/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          + New invoice
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.9rem', color: '#555' }}>Outstanding total</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{rupees.format(outstanding)}</div>
      </div>

      <div className="field">
        <label htmlFor="invoice-status">Status</label>
        <select id="invoice-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && <p>Loading invoices...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && invoices.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No invoices yet</p>
        </div>
      )}

      {!loading && !loadError && invoices.map((inv) => (
        <Link
          key={inv.id}
          to={`/invoices/${inv.id}`}
          className="card"
          style={{ display: 'block', color: '#0B1F3A', textDecoration: 'none' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>{inv.invoice_number}</h2>
            <StatusBadge status={inv.status} />
          </div>
          <div>Student ID: {inv.student_id}</div>
          <div>Billing period: {inv.billing_period}</div>
          <div>Due: {inv.due_date}</div>
          <div>Balance: {rupees.format(Number(inv.remaining_balance) || 0)}</div>
        </Link>
      ))}
    </div>
  );
}
