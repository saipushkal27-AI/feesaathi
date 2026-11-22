import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const PRIORITY = {
  high: { label: 'High', bg: '#FDECEC', fg: '#D64545' },
  medium: { label: 'Medium', bg: '#FFF4E5', fg: '#B45309' },
  low: { label: 'Low', bg: '#EEF2F6', fg: '#475569' },
};

const CHANNEL_LABELS = { in_app: 'In app', push: 'Push' };

function deliveryText(row) {
  const channel = CHANNEL_LABELS[row.channel] || row.channel;
  return `${channel}: ${row.status}${row.detail ? ` (${row.detail})` : ''}`;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/alerts');
      setAlerts(data.alerts || []);
      setUnreadCount(Number(data.unread_count) || 0);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id) {
    setBusy(true);
    setActionError('');
    try {
      await api(`/api/alerts/${id}/read`, { method: 'POST' });
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markUnread(id) {
    setBusy(true);
    setActionError('');
    try {
      await api(`/api/alerts/${id}/unread`, { method: 'POST' });
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    setBusy(true);
    setActionError('');
    try {
      await api('/api/alerts/read-all', { method: 'POST' });
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Alerts</h1>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>Unread</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{unreadCount}</div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || unreadCount === 0}
          onClick={markAllRead}
        >
          Mark all read
        </button>
      </div>

      {loading && <p>Loading alerts...</p>}
      {!loading && loadError && <div className="form-error">{loadError}</div>}
      {actionError && <div className="form-error">{actionError}</div>}

      {!loading && !loadError && alerts.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No alerts right now.</p>
        </div>
      )}

      {!loading && !loadError && alerts.map((alert) => {
        const p = PRIORITY[alert.priority] || PRIORITY.low;
        const unread = !alert.read;
        return (
          <div
            key={alert.id}
            className="card"
            style={{ opacity: unread ? 1 : 0.75 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  background: p.bg,
                  color: p.fg,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                {p.label}
              </span>
              {unread && (
                <span
                  aria-label="Unread"
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B9EFF', display: 'inline-block' }}
                />
              )}
              <span style={{ fontSize: '0.8rem', color: '#555', marginLeft: 'auto' }}>
                {unread ? 'Unread' : 'Read'}
              </span>
            </div>

            <div style={{ fontWeight: unread ? 700 : 400 }}>{alert.message}</div>

            {Array.isArray(alert.delivery) && alert.delivery.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.85rem', color: '#555' }}>
                {alert.delivery.map((row, i) => (
                  <li key={`${row.channel}-${i}`}>{deliveryText(row)}</li>
                ))}
              </ul>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {alert.action_path && (
                <Link className="btn btn-primary" to={alert.action_path} style={{ textDecoration: 'none' }}>
                  {alert.action_label || 'Open'}
                </Link>
              )}
              {unread && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => markRead(alert.id)}
                >
                  Mark read
                </button>
              )}
              {!unread && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => markUnread(alert.id)}
                >
                  Mark unread
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
