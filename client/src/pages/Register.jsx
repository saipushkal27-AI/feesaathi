import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setFieldError('Please enter your name.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setFieldError('Password must be at least 8 characters.');
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: { name: name.trim(), email, password },
      });
      await refresh();
      navigate('/onboarding', { replace: true });
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
              Name
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
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
          <div className="field">
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          {fieldError && <p className="field-error">{fieldError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <div>
          <Link to="/login">Already have an account? Log in</Link>
        </div>
      </div>
    </div>
  );
}
