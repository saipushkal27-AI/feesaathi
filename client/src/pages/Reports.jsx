import { useState } from 'react';
import { api } from '../api.js';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const REPORTS = [
  { value: 'collection', label: 'Collection' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'student-wise', label: 'Student-wise' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'upcoming-bills', label: 'Upcoming bills' },
  { value: 'forecast', label: 'Forecast' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStart() {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function monthEnd() {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function header(key) {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function Reports() {
  const [name, setName] = useState('collection');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [horizon, setHorizon] = useState('30');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isForecast = name === 'forecast';

  function buildUrl(format) {
    if (isForecast) {
      return `/api/reports/forecast?horizon=${horizon}&format=${format}`;
    }
    return `/api/reports/${name}?from=${from}&to=${to}&format=${format}`;
  }

  function validate() {
    if (!isForecast && from && to && from > to) {
      return 'The "from" date cannot be after the "to" date.';
    }
    return '';
  }

  async function view() {
    const problem = validate();
    if (problem) {
      setError(problem);
      setResult(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api(buildUrl('json'));
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const a = document.createElement('a');
    a.href = buildUrl('csv');
    a.download = `${name}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const total = result?.total;

  return (
    <div className="report-root">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .report-root, .report-root * { visibility: visible; }
          .report-root { position: absolute; left: 0; top: 0; width: 100%; }
          .report-no-print { display: none !important; }
        }
      `}</style>
      <h1 className="page-title">Reports</h1>

      <div className="card">
        <div className="field">
          <label htmlFor="report-name">Report</label>
          <select
            id="report-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setResult(null); setError(''); }}
          >
            {REPORTS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {isForecast ? (
          <div className="field">
            <label htmlFor="report-horizon">Horizon</label>
            <select id="report-horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        ) : (
          <div className="inline-field">
            <div className="field">
              <label htmlFor="report-from">From</label>
              <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="report-to">To</label>
              <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="report-no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={view}>
            {loading ? 'Loading...' : 'View'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {result && (
        <div className="card">
          {total !== undefined && total !== null && (
            <div style={{ marginBottom: 12, fontWeight: 600 }}>
              {typeof total === 'object'
                ? Object.entries(total).map(([key, value]) => (
                    <div key={key}>{header(key)}: {typeof value === 'number' ? rupees.format(value) : cell(value)}</div>
                  ))
                : <div>Total: {typeof total === 'number' ? rupees.format(total) : cell(total)}</div>}
            </div>
          )}

          {rows.length === 0 ? (
            <p style={{ margin: 0 }}>No rows for this period.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr>
                    {columns.map((key) => (
                      <th key={key} style={{ textAlign: 'left', borderBottom: '1px solid #E2E8F0', padding: '6px 8px' }}>
                        {header(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((key) => (
                        <td key={key} style={{ borderBottom: '1px solid #E2E8F0', padding: '6px 8px' }}>
                          {cell(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
