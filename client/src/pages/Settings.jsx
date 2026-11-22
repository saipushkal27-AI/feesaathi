import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const FEE_CYCLES = [
  ['monthly', 'Monthly'],
  ['weekly', 'Weekly'],
  ['per_class', 'Per class'],
  ['custom', 'Custom'],
];

// Form fields mirror what Onboarding collects; prefilled from the saved profile.
function fromAuth(user, profile) {
  return {
    name: user?.name || '',
    businessName: profile?.businessName || '',
    mobile: profile?.mobile || '',
    email: profile?.email || user?.email || '',
    cityOrArea: profile?.cityOrArea || '',
    currency: profile?.currency || 'INR',
    openingCashBalance: String(profile?.openingCashBalance ?? 0),
    feeCycle: profile?.feeCycle || 'monthly',
  };
}

export default function Settings() {
  const { user, profile, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => fromAuth(user, profile));
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(fromAuth(user, profile));
  }, [user, profile]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setFieldErrors({});
    setBusy(true);
    try {
      // Same endpoint and body shape as Onboarding's final save.
      await api('/api/onboarding', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          businessName: form.businessName.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          cityOrArea: form.cityOrArea.trim(),
          currency: form.currency,
          openingCashBalance: Number(form.openingCashBalance) || 0,
          feeCycle: form.feeCycle,
        },
      });
      await refresh();
      setSuccess('Profile saved.');
    } catch (err) {
      if (err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>

      <div className="card">
        <h2>Business profile</h2>
        {error && <div className="form-error" role="alert">{error}</div>}
        {success && <div className="form-success" role="status">{success}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>
              Your name
              <input value={form.name} onChange={(e) => update('name', e.target.value)} />
            </label>
            {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
          </div>
          <div className="field">
            <label>
              Tuition or business name
              <input value={form.businessName} onChange={(e) => update('businessName', e.target.value)} />
            </label>
            {fieldErrors.businessName && <p className="field-error">{fieldErrors.businessName}</p>}
          </div>
          <div className="field">
            <label>
              Mobile number
              <input type="tel" value={form.mobile} onChange={(e) => update('mobile', e.target.value)} />
            </label>
            {fieldErrors.mobile && <p className="field-error">{fieldErrors.mobile}</p>}
          </div>
          <div className="field">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </label>
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>
          <div className="field">
            <label>
              City or area
              <input value={form.cityOrArea} onChange={(e) => update('cityOrArea', e.target.value)} />
            </label>
            {fieldErrors.cityOrArea && <p className="field-error">{fieldErrors.cityOrArea}</p>}
          </div>
          <div className="field">
            <label>
              Currency
              <select value={form.currency} onChange={(e) => update('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            {fieldErrors.currency && <p className="field-error">{fieldErrors.currency}</p>}
          </div>
          <div className="field">
            <label>
              Opening cash balance
              <input
                type="number"
                min="0"
                value={form.openingCashBalance}
                onChange={(e) => update('openingCashBalance', e.target.value)}
              />
            </label>
            {fieldErrors.openingCashBalance && (
              <p className="field-error">{fieldErrors.openingCashBalance}</p>
            )}
          </div>
          <div className="field">
            <fieldset>
              <legend>Fee collection cycle</legend>
              {FEE_CYCLES.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="feeCycle"
                    value={value}
                    checked={form.feeCycle === value}
                    onChange={(e) => update('feeCycle', e.target.value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {fieldErrors.feeCycle && <p className="field-error">{fieldErrors.feeCycle}</p>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>About FeeSaathi</h2>
        <p className="tagline">Your Teaching Business, Financially in Control.</p>
        <p>AI answers come from your records.</p>
      </div>

      <div className="card">
        <button className="btn btn-secondary" type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
