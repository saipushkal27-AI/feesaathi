import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN');
}

export default function Priority() {
  const [items, setItems] = useState([]);
  const [totalOverdue, setTotalOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Per-invoice draft state, keyed by invoice_id.
  const [drafts, setDrafts] = useState({});
  const cardRefs = useRef([]);

  useEffect(() => {
    let cancelled = false;
    api('/api/priority')
      .then((data) => {
        if (cancelled) return;
        setItems(data.items || []);
        setTotalOverdue(Number(data.total_outstanding_overdue) || 0);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function patchDraft(invoiceId, patch) {
    setDrafts((prev) => ({ ...prev, [invoiceId]: { ...prev[invoiceId], ...patch } }));
  }

  async function draftReminder(item, force = false) {
    patchDraft(item.invoice_id, { busy: true, error: '', conflict: '' });
    try {
      const body = force ? { invoice_id: item.invoice_id, force: true } : { invoice_id: item.invoice_id };
      const data = await api('/api/reminders/draft', { method: 'POST', body });
      setDrafts((prev) => ({
        ...prev,
        [item.invoice_id]: {
          reminder: data.reminder,
          text: data.reminder.message,
          busy: false,
          copied: false,
          sent: false,
          error: '',
          conflict: '',
        },
      }));
    } catch (err) {
      // 409 means a reminder was made recently; the user can confirm and force it.
      if (err.status === 409) patchDraft(item.invoice_id, { busy: false, conflict: err.message });
      else patchDraft(item.invoice_id, { busy: false, error: err.message });
    }
  }

  async function copyText(invoiceId) {
    try {
      await navigator.clipboard.writeText(drafts[invoiceId].text);
      patchDraft(invoiceId, { copied: true, error: '' });
    } catch {
      patchDraft(invoiceId, { error: 'Could not copy. Select the text and copy it manually.' });
    }
  }

  // Opens WhatsApp only; does not mark the reminder as sent.
  function shareOnWhatsApp(invoiceId) {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(drafts[invoiceId].text)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  async function markSent(invoiceId) {
    patchDraft(invoiceId, { busy: true, error: '' });
    try {
      await api(`/api/reminders/${drafts[invoiceId].reminder.id}/sent`, { method: 'POST' });
      patchDraft(invoiceId, { busy: false, sent: true });
    } catch (err) {
      patchDraft(invoiceId, { busy: false, error: err.message });
    }
  }

  function focusNext(index) {
    const next = cardRefs.current[index + 1];
    if (next) next.focus();
  }

  return (
    <div>
      <h1 className="page-title">Priority fee recovery</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.9rem', color: '#555' }}>Total overdue</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{rupees.format(totalOverdue)}</div>
        <div style={{ fontSize: '0.9rem', color: '#555' }}>
          {items.length} {items.length === 1 ? 'item' : 'items'} to chase
        </div>
      </div>

      {loading && <p>Loading overdue fees...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}

      {!loading && !loadError && items.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No overdue fees. Nothing to chase today.</p>
        </div>
      )}

      {!loading && !loadError && items.map((item, index) => {
        const d = drafts[item.invoice_id] || {};
        const days = Number(item.days_overdue) || 0;
        return (
          <div
            key={item.invoice_id}
            ref={(el) => { cardRefs.current[index] = el; }}
            tabIndex={-1}
            className="card"
            style={{ opacity: d.sent ? 0.7 : 1 }}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>
              {index + 1}. {item.student_name}
            </h2>
            <div>Parent: {item.parent_name}</div>
            <div>Balance: {rupees.format(Number(item.remaining_balance) || 0)}</div>
            <div>Due: {item.due_date}</div>
            <div>{days} {days === 1 ? 'day' : 'days'} overdue</div>
            <div>Suggested action: {item.suggested_action}</div>
            <div style={{ fontSize: '0.9rem', color: '#555' }}>
              {item.last_reminder_at
                ? `Last reminder: ${formatDate(item.last_reminder_at)}`
                : 'No reminder yet'}
            </div>

            {d.conflict && <div className="form-error" style={{ marginTop: 8 }}>{d.conflict}</div>}
            {d.error && <div className="form-error" style={{ marginTop: 8 }}>{d.error}</div>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {!d.reminder && !d.conflict && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={d.busy}
                  onClick={() => draftReminder(item)}
                >
                  {d.busy ? 'Drafting...' : 'Draft reminder'}
                </button>
              )}
              {d.conflict && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={d.busy}
                  onClick={() => draftReminder(item, true)}
                >
                  Create anyway
                </button>
              )}
              <Link
                className="btn btn-secondary"
                to={`/invoices/${item.invoice_id}`}
                style={{ textDecoration: 'none' }}
              >
                View invoice
              </Link>
            </div>

            {d.reminder && !d.sent && (
              <div style={{ marginTop: 12 }}>
                <div className="field">
                  <label htmlFor={`reminder-${item.invoice_id}`}>Reminder message</label>
                  <textarea
                    id={`reminder-${item.invoice_id}`}
                    rows={6}
                    value={d.text}
                    onChange={(e) => patchDraft(item.invoice_id, { text: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => copyText(item.invoice_id)}>
                    Copy
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => shareOnWhatsApp(item.invoice_id)}>
                    Share on WhatsApp
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={d.busy}
                    onClick={() => markSent(item.invoice_id)}
                  >
                    Mark as sent
                  </button>
                  {d.copied && <span style={{ color: '#166534', fontWeight: 600 }}>Copied</span>}
                </div>
              </div>
            )}

            {d.sent && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>Recorded as sent</span>
                {index < items.length - 1 && (
                  <button type="button" className="btn btn-primary" onClick={() => focusNext(index)}>
                    Next
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
