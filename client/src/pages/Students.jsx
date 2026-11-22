import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StudentForm from './StudentForm.jsx';

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

// Drop empty optional fields and convert the fee to a number before POST.
function toPayload(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const t = typeof v === 'string' ? v.trim() : v;
    if (t === '' || t === null || t === undefined) continue;
    out[k] = k === 'fee_amount' ? Number(t) : t;
  }
  return out;
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

export default function Students() {
  const [students, setStudents] = useState([]);
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formErrors, setFormErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ status });
    if (q.trim()) params.set('q', q.trim());
    api(`/api/students?${params}`)
      .then((data) => {
        if (!cancelled) setStudents(Array.isArray(data) ? data : data.students || []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status, q, reloadKey]);

  async function handleCreate(values) {
    setSubmitting(true);
    setFormError('');
    setFormErrors({});
    try {
      await api('/api/students', { method: 'POST', body: toPayload(values) });
      setShowForm(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(err.message);
      setFormErrors(normalizeFieldErrors(err.fieldErrors));
    } finally {
      setSubmitting(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setFormError('');
    setFormErrors({});
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">Students</h1>
        {!showForm && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/students/import" className="btn btn-secondary">Import CSV</Link>
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Student
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Add student</h2>
          <StudentForm
            onSubmit={handleCreate}
            submitting={submitting}
            onCancel={closeForm}
            formError={formError}
            serverErrors={formErrors}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="student-search">Search</label>
        <input
          id="student-search"
          type="search"
          placeholder="Name, parent or mobile"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div role="group" aria-label="Status filter" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              className={active ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, padding: '8px 10px', fontSize: '0.9rem' }}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading && <p>Loading students...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && students.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            {q.trim() || status !== 'all'
              ? 'No students match this search or filter.'
              : 'No students yet. Tap "+ Add Student" to add your first one.'}
          </p>
        </div>
      )}

      {!loading && !loadError && students.map((s) => (
        <Link
          key={s.id}
          to={`/students/${s.id}`}
          className="card"
          style={{ display: 'block', color: '#0B1F3A', textDecoration: 'none' }}
        >
          <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>{s.student_name}</h2>
          <div>Parent: {s.parent_name}</div>
          <div>Mobile: {s.parent_mobile}</div>
          <div>Fee: ₹{s.fee_amount} / {String(s.fee_frequency || '').replace('_', ' ')}</div>
        </Link>
      ))}
    </div>
  );
}
