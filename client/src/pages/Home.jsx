import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { api } from '../api.js';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function SummaryCard({ label, value, color, bg }) {
  return (
    <div className="card" style={{ marginBottom: 0, borderLeft: `4px solid ${color}`, background: bg || '#FFFFFF' }}>
      <div style={{ fontSize: '0.9rem', color: '#555' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export default function Home() {
  const { user, profile } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/api/dashboard/summary')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setSummaryError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const overdueTotal = Number(summary?.overdue_total) || 0;
  const upcomingCount = Number(summary?.upcoming_due_count) || 0;

  return (
    <div>
      <h1 className="page-title">Hello, {profile?.business_name || user?.name || 'there'}</h1>
      <div className="inline-field" style={{ marginBottom: 16 }}>
        <Link className="btn btn-primary" to="/students">+ Add student</Link>
        <Link className="btn btn-primary" to="/invoices/new">+ Create invoice</Link>
        <Link className="btn btn-secondary" to="/invoices">Invoices</Link>
      </div>

      <div className="card">
        <h2>Financial control centre</h2>
        {summaryLoading && <p>Loading summary...</p>}
        {!summaryLoading && summaryError && <div className="form-error">{summaryError}</div>}
        {!summaryLoading && !summaryError && summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <SummaryCard label="Received this month" value={rupees.format(Number(summary.received_this_month) || 0)} color="#166534" bg="#dcfce7" />
            <SummaryCard label="Expected this month" value={rupees.format(Number(summary.expected_this_month) || 0)} color="#0B1F3A" />
            <SummaryCard label="Outstanding" value={rupees.format(Number(summary.outstanding_total) || 0)} color="#0B1F3A" />
            <SummaryCard label="Overdue" value={rupees.format(overdueTotal)} color="#b42318" bg="#fde2e1" />
            <SummaryCard label="Upcoming due in 7 days" value={upcomingCount} color="#b45309" bg="#fff1e0" />
          </div>
        )}
      </div>

      {!summaryLoading && !summaryError && summary && (overdueTotal > 0 || upcomingCount > 0) && (
        <div className="card">
          <h2>Today's actions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {overdueTotal > 0 && (
              <Link to="/priority" style={{ color: '#b42318', fontWeight: 600 }}>Resolve today's pending fees</Link>
            )}
            {upcomingCount > 0 && (
              <Link to="/invoices" style={{ color: '#b45309', fontWeight: 600 }}>
                {upcomingCount} {upcomingCount === 1 ? 'invoice' : 'invoices'} due in the next 7 days
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
