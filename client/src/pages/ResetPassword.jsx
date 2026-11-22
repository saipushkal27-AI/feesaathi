import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <h1 className="brand">FeeSaathi</h1>
          <p className="tagline">Your Teaching Business, Financially in Control.</p>
          <div className="form-error" role="alert">This reset link is missing its token.</div>
          <Link to="/forgot-password">Request a new link</Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setFieldError('Password must be at least 8 characters.');
      return;
    }
    if (confirmPassword !== newPassword) {
      setFieldError('Passwords do not match.');
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
      navigate('/login', { replace: true });
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
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
          </div>
          <div className="field">
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
          </div>
          {fieldError && <p className="field-error">{fieldError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Resetting...' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
