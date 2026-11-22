import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const HORIZONS = [30, 60, 90];

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => rupees.format(Number(n) || 0);
const dateOnly = (d) => String(d || '').slice(0, 10);

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: '#555' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// Groups daily rows into weeks of seven days and sums each column.
function weeklyRows(days) {
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const sum = (k) => chunk.reduce((s, d) => s + (Number(d[k]) || 0), 0);
    weeks.push({
      key: i,
      from: dateOnly(chunk[0].date),
      to: dateOnly(chunk[chunk.length - 1].date),
      confirmed: sum('incoming_confirmed'),
      expected: sum('incoming_expected'),
      estimated: sum('incoming_estimated'),
      bills: sum('outflow_bills'),
      expenses: sum('outflow_expenses'),
      net: sum('net'),
    });
  }
  return weeks;
}

// Labels may arrive as an array or an object of strings; keep only the strings.
function labelList(labels) {
  if (!labels) return [];
  if (Array.isArray(labels)) return labels.map(String);
  return Object.values(labels).filter((v) => typeof v === 'string');
}

// Inline SVG line chart of closing balance. Red dots mark days below zero.
function BalanceChart({ days }) {
  const W = 320;
  const H = 180;
  const PL = 72;
  const PR = 10;
  const PT = 10;
  const PB = 20;
  const values = days.map((d) => Number(d.closing_balance) || 0);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const n = values.length;
  const x = (i) => (n > 1 ? PL + (i * (W - PL - PR)) / (n - 1) : PL);
  const y = (v) => H - PB - ((v - min) / span) * (H - PT - PB);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const shortIdx = values.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Projected closing balance by day" style={{ display: 'block' }}>
      <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="#94A3B8" strokeDasharray="4 3" />
      <text x={PL - 6} y={PT + 8} fontSize="10" fill="#555" textAnchor="end">{money(max)}</text>
      <text x={PL - 6} y={H - PB} fontSize="10" fill="#555" textAnchor="end">{money(min)}</text>
      <text x={PL} y={H - 4} fontSize="10" fill="#555">{dateOnly(days[0]?.date)}</text>
      <text x={W - PR} y={H - 4} fontSize="10" fill="#555" textAnchor="end">{dateOnly(days[n - 1]?.date)}</text>
      <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={points} />
      {shortIdx.map((i) => (
        <circle key={i} cx={x(i)} cy={y(values[i])} r="3.5" fill="#D64545" />
      ))}
    </svg>
  );
}

export default function Forecast() {
  const [horizon, setHorizon] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState({ opening_cash: '', collection_rate: '', expense_factor: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveFieldErrors, setSaveFieldErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api(`/api/forecast?horizon=${horizon}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setForm({
          opening_cash: String(res.opening_cash ?? ''),
          collection_rate: String(res.assumptions_used?.collection_rate ?? ''),
          expense_factor: String(res.assumptions_used?.expense_factor ?? ''),
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [horizon, reloadKey]);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function saveAssumptions(e) {
    e.preventDefault();
    setSaved(false);
    setSaveError('');
    setSaveFieldErrors({});

    const localErrors = {};
    const body = {};
    if (form.opening_cash.trim() !== '') {
      const v = Number(form.opening_cash);
      if (!Number.isFinite(v) || v < 0) localErrors.opening_cash = 'Enter an amount of 0 or more';
      else body.opening_cash = v;
    }
    if (form.collection_rate.trim() !== '') {
      const v = Number(form.collection_rate);
      if (!Number.isFinite(v) || v < 0 || v > 1.5) localErrors.collection_rate = 'Enter a rate from 0 to 1.5';
      else body.collection_rate = v;
    }
    if (form.expense_factor.trim() !== '') {
      const v = Number(form.expense_factor);
      if (!Number.isFinite(v) || v < 0 || v > 1.5) localErrors.expense_factor = 'Enter a factor from 0 to 1.5';
      else body.expense_factor = v;
    }
    if (Object.keys(localErrors).length > 0) {
      setSaveFieldErrors(localErrors);
      return;
    }

    setSaving(true);
    try {
      await api('/api/forecast/assumptions', { method: 'PUT', body });
      setSaved(true);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSaveError(err.message);
      setSaveFieldErrors(err.fieldErrors || {});
    } finally {
      setSaving(false);
    }
  }

  const days = data?.days || [];
  const summary = data?.summary || {};
  const shortage = Array.isArray(summary.shortage_days) ? summary.shortage_days : [];
  const endBalance = summary.closing_end ?? null;
  const weeks = weeklyRows(days);
  const notes = labelList(data?.labels);
  const used = data?.assumptions_used || {};

  return (
    <div>
      <h1 className="page-title">Cash forecast</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={h === horizon}
              className={`btn ${h === horizon ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHorizon(h)}
            >
              {h} days
            </button>
          ))}
        </div>
        <Link to="/forecast/simulate">What if? Simulator</Link>
      </div>

      {loading && <p>Loading forecast...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && data && (
        <>
          {days.length === 0 && (
            <div className="card">
              <p style={{ margin: 0 }}>No forecast days to show yet.</p>
            </div>
          )}

          {days.length > 0 && (
            <>
              <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                <Stat label={`Closing balance, day ${horizon}`} value={money(endBalance)} />
                <Stat label="Lowest balance" value={money(summary.min_balance)} />
                <Stat label="Lowest on" value={dateOnly(summary.min_balance_date) || '-'} />
              </div>

              {shortage.length > 0 ? (
                <div className="form-error" role="alert">
                  Cash may become insufficient on {shortage.length} days, first on {dateOnly(shortage[0])}.
                </div>
              ) : (
                <div className="card" style={{ background: '#ECFDF5', color: '#166534' }}>
                  No shortage projected in the next {horizon} days.
                </div>
              )}

              <div className="card">
                <strong>Balance by day</strong>
                <BalanceChart days={days} />
              </div>

              <div className="card" style={{ overflowX: 'auto' }}>
                <strong>Week by week</strong>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'right' }}>
                      <th style={{ textAlign: 'left' }}>Week</th>
                      <th>Confirmed</th>
                      <th>Expected from invoices</th>
                      <th>Estimated</th>
                      <th>Bills</th>
                      <th>Expenses</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w.key} style={{ textAlign: 'right', borderTop: '1px solid #E2E8F0' }}>
                        <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{w.from} to {w.to}</td>
                        <td>{money(w.confirmed)}</td>
                        <td>{money(w.expected)}</td>
                        <td>{money(w.estimated)}</td>
                        <td>{money(w.bills)}</td>
                        <td>{money(w.expenses)}</td>
                        <td style={{ color: w.net < 0 ? '#D64545' : undefined, fontWeight: 600 }}>{money(w.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="card">
            <strong>Assumptions</strong>
            <div style={{ fontSize: '0.9rem', color: '#555', margin: '8px 0' }}>
              Opening cash {money(data.opening_cash)} · Collection rate {used.collection_rate ?? '-'} · Expense factor {used.expense_factor ?? '-'}
            </div>

            <form onSubmit={saveAssumptions} noValidate>
              {saveError && <div className="form-error">{saveError}</div>}
              {Object.entries(saveFieldErrors).map(([field, msg]) => (
                <div key={field} className="form-error">{Array.isArray(msg) ? msg[0] : String(msg)}</div>
              ))}
              <div className="field">
                <label htmlFor="forecast-opening-cash">Opening cash (₹)</label>
                <input id="forecast-opening-cash" type="number" min="0" step="any" value={form.opening_cash} disabled={saving} onChange={(e) => setField('opening_cash', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="forecast-collection-rate">Collection rate (0 to 1.5)</label>
                <input id="forecast-collection-rate" type="number" min="0" max="1.5" step="0.05" value={form.collection_rate} disabled={saving} onChange={(e) => setField('collection_rate', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="forecast-expense-factor">Expense factor (0 to 1.5)</label>
                <input id="forecast-expense-factor" type="number" min="0" max="1.5" step="0.05" value={form.expense_factor} disabled={saving} onChange={(e) => setField('expense_factor', e.target.value)} />
              </div>
              <div className="inline-field">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save assumptions'}
                </button>
              </div>
              {saved && <p style={{ color: '#166534', marginBottom: 0 }}>Assumptions saved.</p>}
            </form>
          </div>

          {notes.length > 0 && (
            <div className="card">
              <strong>What this means</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
