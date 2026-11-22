import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

const TYPES = [
  { value: 'delay_invoice', label: 'Delay one invoice' },
  { value: 'delay_invoices', label: 'Delay several invoices' },
  { value: 'remove_student', label: 'A student leaves' },
  { value: 'expense_increase', label: 'Expenses increase' },
  { value: 'bill_earlier', label: 'Bill paid earlier' },
];

const HORIZONS = [30, 60, 90];

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => rupees.format(Number(n) || 0);
const dateOnly = (d) => String(d || '').slice(0, 10);

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// Lists may come back as a bare array or wrapped under a key; accept both.
function listFrom(res, key) {
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.[key]) ? res[key] : [];
}

function emptyDraft() {
  return {
    type: 'delay_invoice',
    invoice_id: '',
    invoice_ids: [],
    days: '7',
    student_id: '',
    from_date: todayISO(),
    percent: '10',
    category: '',
    bill_id: '',
    new_due_date: '',
  };
}

const isWholeDays = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Turns the draft into { scenario, label } or { error }. Labels are for the scenario list only.
function buildScenario(d, invoices, students, bills) {
  const invNo = (id) => invoices.find((i) => String(i.id) === String(id))?.invoice_number || `#${id}`;
  switch (d.type) {
    case 'delay_invoice': {
      if (!d.invoice_id) return { error: 'Pick an invoice' };
      if (!isWholeDays(d.days)) return { error: 'Days must be a whole number from 1 to 365' };
      return {
        scenario: { type: 'delay_invoice', invoice_id: Number(d.invoice_id), days: Number(d.days) },
        label: `Invoice ${invNo(d.invoice_id)} moves ${d.days} days later`,
      };
    }
    case 'delay_invoices': {
      if (d.invoice_ids.length === 0) return { error: 'Tick at least one invoice' };
      if (!isWholeDays(d.days)) return { error: 'Days must be a whole number from 1 to 365' };
      return {
        scenario: { type: 'delay_invoices', invoice_ids: d.invoice_ids.map(Number), days: Number(d.days) },
        label: `${d.invoice_ids.length} invoices move ${d.days} days later`,
      };
    }
    case 'remove_student': {
      if (!d.student_id) return { error: 'Pick a student' };
      if (!isDate(d.from_date)) return { error: 'Pick a from date' };
      const name = students.find((s) => String(s.id) === String(d.student_id))?.student_name || 'Student';
      return {
        scenario: { type: 'remove_student', student_id: Number(d.student_id), from_date: d.from_date },
        label: `${name} leaves from ${d.from_date}`,
      };
    }
    case 'expense_increase': {
      const percent = Number(d.percent);
      if (d.percent.trim() === '' || !Number.isFinite(percent) || percent < -100 || percent > 500) {
        return { error: 'Percent must be from -100 to 500' };
      }
      if (!isDate(d.from_date)) return { error: 'Pick a from date' };
      const scenario = { type: 'expense_increase', percent, from_date: d.from_date };
      if (d.category) scenario.category = d.category;
      const what = d.category ? CATEGORIES.find((c) => c.value === d.category)?.label : 'All expenses';
      return { scenario, label: `${what} change ${percent}% from ${d.from_date}` };
    }
    case 'bill_earlier': {
      if (!d.bill_id) return { error: 'Pick a bill' };
      if (!isDate(d.new_due_date)) return { error: 'Pick the new due date' };
      const bill = bills.find((b) => String(b.id) === String(d.bill_id));
      const name = bill?.name || 'Bill';
      return {
        scenario: { type: 'bill_earlier', bill_id: Number(d.bill_id), new_due_date: d.new_due_date },
        label: `${name} paid on ${d.new_due_date}${bill?.due_date ? ` instead of ${dateOnly(bill.due_date)}` : ''}`,
      };
    }
    default:
      return { error: 'Pick a scenario type' };
  }
}

export default function Simulator() {
  const [invoices, setInvoices] = useState([]);
  const [students, setStudents] = useState([]);
  const [bills, setBills] = useState([]);
  const [pickersError, setPickersError] = useState('');

  const [draft, setDraft] = useState(emptyDraft);
  const [draftError, setDraftError] = useState('');
  const [scenarios, setScenarios] = useState([]);

  const [horizon, setHorizon] = useState(30);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api('/api/invoices'),
      api('/api/students?status=active'),
      api('/api/bills'),
    ])
      .then(([inv, stu, bil]) => {
        if (cancelled) return;
        setInvoices(listFrom(inv, 'invoices'));
        setStudents(listFrom(stu, 'students'));
        setBills(listFrom(bil, 'bills'));
      })
      .catch((err) => {
        if (!cancelled) setPickersError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  function setDraftField(name, value) {
    setDraft((prev) => ({ ...prev, [name]: value }));
  }

  function toggleInvoice(id) {
    setDraft((prev) => {
      const key = String(id);
      const has = prev.invoice_ids.map(String).includes(key);
      return { ...prev, invoice_ids: has ? prev.invoice_ids.filter((v) => String(v) !== key) : [...prev.invoice_ids, id] };
    });
  }

  function addScenario() {
    setDraftError('');
    const built = buildScenario(draft, invoices, students, bills);
    if (built.error) {
      setDraftError(built.error);
      return;
    }
    setScenarios((prev) => [...prev, { id: Date.now() + Math.random(), ...built }]);
    setResult(null);
  }

  function removeScenario(id) {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    setResult(null);
  }

  async function runSimulation() {
    setRunError('');
    setResult(null);
    if (scenarios.length === 0) {
      setRunError('Add at least one scenario first');
      return;
    }
    setRunning(true);
    try {
      const res = await api('/api/forecast/simulate', {
        method: 'POST',
        body: { horizon, scenarios: scenarios.map((s) => s.scenario) },
      });
      setResult(res);
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const originalClose = result?.original?.summary_by_horizon?.[horizon]?.closing_end;
  const simulatedClose = result?.simulated?.summary_by_horizon?.[horizon]?.closing_end;
  const difference = result ? Number(result.difference?.[`closing_${horizon}`]) || 0 : 0;

  const invoiceLabel = (inv) => `${inv.invoice_number || `Invoice ${inv.id}`}${inv.due_date ? ` (due ${dateOnly(inv.due_date)})` : ''}`;

  return (
    <div>
      <h1 className="page-title">What if? Simulator</h1>
      <p style={{ marginTop: 0 }}>
        <Link to="/forecast">Back to cash forecast</Link>
      </p>

      <div className="card" style={{ background: '#FFF7E6', color: '#7A4B00' }}>
        This simulation does not change any invoices, payments, bills or expenses.
      </div>

      {pickersError && <div className="form-error">{pickersError}</div>}

      <div className="card">
        <strong>Add a scenario</strong>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="sim-type">Scenario</label>
          <select id="sim-type" value={draft.type} onChange={(e) => { setDraftError(''); setDraftField('type', e.target.value); }}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {draft.type === 'delay_invoice' && (
          <>
            <div className="field">
              <label htmlFor="sim-invoice">Invoice</label>
              <select id="sim-invoice" value={draft.invoice_id} onChange={(e) => setDraftField('invoice_id', e.target.value)}>
                <option value="">Select an invoice</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>{invoiceLabel(inv)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-days">Days later</label>
              <input id="sim-days" type="number" min="1" max="365" step="1" value={draft.days} onChange={(e) => setDraftField('days', e.target.value)} />
            </div>
          </>
        )}

        {draft.type === 'delay_invoices' && (
          <>
            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
              <legend style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>Invoices</legend>
              {invoices.length === 0 && <p style={{ margin: 0 }}>No invoices yet.</p>}
              {invoices.map((inv) => (
                <label key={inv.id} style={{ display: 'block', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={draft.invoice_ids.map(String).includes(String(inv.id))}
                    onChange={() => toggleInvoice(inv.id)}
                  />{' '}
                  {invoiceLabel(inv)}
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="sim-days-many">Days later</label>
              <input id="sim-days-many" type="number" min="1" max="365" step="1" value={draft.days} onChange={(e) => setDraftField('days', e.target.value)} />
            </div>
          </>
        )}

        {draft.type === 'remove_student' && (
          <>
            <div className="field">
              <label htmlFor="sim-student">Student</label>
              <select id="sim-student" value={draft.student_id} onChange={(e) => setDraftField('student_id', e.target.value)}>
                <option value="">Select a student</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.student_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-from">Leaves from</label>
              <input id="sim-from" type="date" value={draft.from_date} onChange={(e) => setDraftField('from_date', e.target.value)} />
            </div>
          </>
        )}

        {draft.type === 'expense_increase' && (
          <>
            <div className="field">
              <label htmlFor="sim-percent">Change in percent (negative to cut)</label>
              <input id="sim-percent" type="number" min="-100" max="500" step="any" value={draft.percent} onChange={(e) => setDraftField('percent', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sim-category">Category (optional)</label>
              <select id="sim-category" value={draft.category} onChange={(e) => setDraftField('category', e.target.value)}>
                <option value="">All expenses</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-from-exp">From date</label>
              <input id="sim-from-exp" type="date" value={draft.from_date} onChange={(e) => setDraftField('from_date', e.target.value)} />
            </div>
          </>
        )}

        {draft.type === 'bill_earlier' && (
          <>
            <div className="field">
              <label htmlFor="sim-bill">Bill</label>
              <select id="sim-bill" value={draft.bill_id} onChange={(e) => setDraftField('bill_id', e.target.value)}>
                <option value="">Select a bill</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.due_date ? ` (due ${dateOnly(b.due_date)})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sim-new-due">New due date</label>
              <input id="sim-new-due" type="date" value={draft.new_due_date} onChange={(e) => setDraftField('new_due_date', e.target.value)} />
            </div>
          </>
        )}

        {draftError && <div className="form-error">{draftError}</div>}
        <button type="button" className="btn btn-secondary" onClick={addScenario}>Add scenario</button>
      </div>

      <div className="card">
        <strong>Scenarios ({scenarios.length})</strong>
        {scenarios.length === 0 && <p style={{ marginBottom: 0 }}>No scenarios added yet.</p>}
        <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
          {scenarios.map((s) => (
            <li key={s.id} style={{ marginBottom: 6 }}>
              {s.label}{' '}
              <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => removeScenario(s.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ width: 'auto', marginBottom: 0 }}>
          <label htmlFor="sim-horizon">Horizon</label>
          <select id="sim-horizon" value={horizon} onChange={(e) => { setHorizon(Number(e.target.value)); setResult(null); }}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>{h} days</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={runSimulation} disabled={running || scenarios.length === 0}>
          {running ? 'Running...' : 'Run simulation'}
        </button>
      </div>

      {runError && <div className="form-error">{runError}</div>}

      {result && (
        <div className="card">
          <strong>Result at {horizon} days</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>Original closing balance</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{money(originalClose)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>Simulated closing balance</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{money(simulatedClose)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>Difference</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: difference < 0 ? '#D64545' : undefined }}>{money(difference)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>Shortage days</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                {(result.shortage_before || []).length} before, {(result.shortage_after || []).length} after
              </div>
            </div>
          </div>

          {Array.isArray(result.explanation) && result.explanation.length > 0 && (
            <>
              <strong style={{ display: 'block', marginTop: 12 }}>What changes</strong>
              <ul style={{ paddingLeft: 20, marginTop: 4 }}>
                {result.explanation.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </>
          )}

          {result.recommendation && (
            <div style={{ marginTop: 12, background: '#ECFDF5', color: '#166534', padding: 10, borderRadius: 8 }}>
              {result.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
