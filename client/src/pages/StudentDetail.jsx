import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StudentForm from './StudentForm.jsx';

// Trim strings and convert the fee to a number. Empty optional fields go as '' so a cleared value is saved.
function toPayload(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const t = typeof v === 'string' ? v.trim() : v;
    out[k] = k === 'fee_amount' && t !== '' ? Number(t) : t;
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

// Indian rupee format, no decimals.
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => rupees.format(Number(n) || 0);

// Summary cards from GET /api/students/:id/profile. Colours: paid green, overdue red, upcoming due orange.
function summaryCards(s) {
  return [
    { label: 'Total invoiced', value: money(s.total_invoiced) },
    { label: 'Total paid', value: money(s.total_paid), color: '#15803D' },
    { label: 'Pending balance', value: money(s.pending_balance) },
    { label: 'Overdue balance', value: money(s.overdue_balance), color: '#D64545' },
    { label: 'Last payment', value: s.last_payment_date || 'None yet' },
    { label: 'Next due', value: s.next_due_date || 'None', color: '#D97706' },
  ];
}

const DETAILS = [
  { key: 'parent_name', label: 'Parent name' },
  { key: 'parent_mobile', label: 'Parent mobile' },
  { key: 'email', label: 'Email' },
  { key: 'class_grade', label: 'Class / grade' },
  { key: 'subject', label: 'Subject' },
  { key: 'joining_date', label: 'Joining date' },
  { key: 'address', label: 'Address' },
  { key: 'notes', label: 'Notes' },
];

export default function StudentDetail() {
  const { id } = useParams();
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [reminders, setReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [remindersError, setRemindersError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api(`/api/students/${id}`)
      .then((data) => {
        if (!cancelled) setStudent(data.student || data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  // Billing profile: separate call, so the student load above is unchanged.
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setProfileError('');
    api(`/api/students/${id}/profile`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setProfileError(err.message);
      });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  // Reminder history for this student: GET /api/reminders?studentId=, newest first.
  useEffect(() => {
    let cancelled = false;
    setRemindersLoading(true);
    setRemindersError('');
    api(`/api/reminders?studentId=${id}`)
      .then((data) => {
        if (!cancelled) setReminders(data.reminders || []);
      })
      .catch((err) => {
        if (!cancelled) setRemindersError(err.message);
      })
      .finally(() => {
        if (!cancelled) setRemindersLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  async function handleSave(values) {
    setSubmitting(true);
    setFormError('');
    setFormErrors({});
    try {
      await api(`/api/students/${id}`, { method: 'PUT', body: toPayload(values) });
      setEditing(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(err.message);
      setFormErrors(normalizeFieldErrors(err.fieldErrors));
    } finally {
      setSubmitting(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setFormError('');
    setFormErrors({});
  }

  async function runAction(action) {
    setActionBusy(true);
    setActionError('');
    try {
      await api(`/api/students/${id}/${action}`, { method: 'POST' });
      setConfirmArchive(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div>
      <p style={{ margin: '8px 0 0' }}>
        <Link to="/students">Back to students</Link>
      </p>

      {loading && <p>Loading student...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && student && editing && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Edit student</h2>
          <StudentForm
            initial={student}
            onSubmit={handleSave}
            submitting={submitting}
            onCancel={cancelEdit}
            formError={formError}
            serverErrors={formErrors}
          />
        </div>
      )}

      {!loading && !loadError && student && !editing && (
        <>
          <h1 className="page-title">{student.student_name}</h1>

          <div className="card">
            <div>Status: {student.status === 'archived' ? 'Archived' : 'Active'}</div>
            <div>Fee: ₹{student.fee_amount} / {String(student.fee_frequency || '').replace('_', ' ')}</div>
            {DETAILS.map((d) => (
              <div key={d.key}>{d.label}: {student[d.key] || '—'}</div>
            ))}
          </div>

          {actionError && <div className="form-error">{actionError}</div>}

          <div className="card">
            <div className="inline-field">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)} disabled={actionBusy}>
                Edit
              </button>
              {student.status === 'active' && !confirmArchive && (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmArchive(true)} disabled={actionBusy}>
                  Archive
                </button>
              )}
              {student.status === 'archived' && (
                <button type="button" className="btn btn-primary" onClick={() => runAction('restore')} disabled={actionBusy}>
                  {actionBusy ? 'Restoring...' : 'Restore'}
                </button>
              )}
              {student.status === 'active' && (
                <Link className="btn btn-primary" to={`/invoices/new?student_id=${student.id}`}>
                  Create invoice
                </Link>
              )}
            </div>

            {student.status === 'active' && confirmArchive && (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: '0 0 8px' }}>Archive this student? They will move out of the active list.</p>
                <div className="inline-field">
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmArchive(false)} disabled={actionBusy}>
                    Keep active
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => runAction('archive')} disabled={actionBusy}>
                    {actionBusy ? 'Archiving...' : 'Yes, archive'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <h2>Billing</h2>
          {profileError && <div className="form-error">{profileError}</div>}
          {profile && (
            <>
              <div
                className="card"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}
              >
                {summaryCards(profile.summary || {}).map((c) => (
                  <div key={c.label}>
                    <div style={{ fontSize: '0.8rem', color: '#64748B' }}>{c.label}</div>
                    <div style={{ fontWeight: 600, color: c.color || '#0B1F3A' }}>{c.value}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Invoices</h3>
                {(profile.invoices || []).length === 0 && <p>No invoices yet</p>}
                {(profile.invoices || []).map((inv, i) => (
                  <div key={inv.invoice_number || i} style={{ borderTop: '1px solid #E2E8F0', padding: '8px 0' }}>
                    <div><strong>{inv.invoice_number}</strong> · {inv.billing_period}</div>
                    <div style={{ fontSize: '0.9rem' }}>
                      Due {inv.due_date} · Total {money(inv.total_amount)} · Remaining {money(inv.remaining_balance)} · {inv.status}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Payments</h3>
                {(profile.payments || []).length === 0 && <p>No payments yet</p>}
                {(profile.payments || []).map((p, i) => {
                  const reversed = p.status === 'reversed';
                  return (
                    <div
                      key={p.id ?? i}
                      style={{ borderTop: '1px solid #E2E8F0', padding: '8px 0', opacity: reversed ? 0.5 : 1 }}
                    >
                      <div>
                        <strong>{money(p.amount)}</strong> · {p.payment_date} · {p.method}
                        <span style={{ marginLeft: 8, color: reversed ? '#64748B' : '#15803D' }}>
                          {reversed ? 'Reversed' : 'Active'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <h2>Reminder history</h2>
          <div className="card">
            {remindersLoading && <p>Loading reminders...</p>}
            {!remindersLoading && remindersError && <div className="form-error">{remindersError}</div>}
            {!remindersLoading && !remindersError && reminders.length === 0 && <p>No reminders sent yet.</p>}
            {!remindersLoading && !remindersError && reminders.map((r, i) => (
              <div key={r.id ?? i} style={{ borderTop: '1px solid #E2E8F0', padding: '8px 0' }}>
                <div>
                  <strong>{r.sent_at || r.created_at || '—'}</strong> · {r.kind || '—'}
                  {r.invoice_number && <span> · {r.invoice_number}</span>}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#64748B' }}>Status: {r.status || '—'}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
