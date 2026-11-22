import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setMessage('If an account exists for that email, a reset link has been prepared.');
      setResetToken(data.resetToken || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <h1 className="brand">FeeSaathi</h1>
        <p className="tagline">Your Teaching Business, Financially in Control.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        {message && <p>{message}</p>}
        {resetToken && (
          <>
            <Link to={'/reset-password?token=' + encodeURIComponent(resetToken)}>
              Continue to reset password
            </Link>
            <p className="muted">Development mode: no email is sent yet.</p>
          </>
        )}
        <div>
          <Link to="/login">Back to log in</Link>
        </div>
      </div>
    </div>
  );
}
