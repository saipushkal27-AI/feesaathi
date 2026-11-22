import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEP_FIELDS = {
  1: ['name', 'businessName', 'mobile', 'email'],
  2: ['cityOrArea', 'currency', 'openingCashBalance'],
  3: ['feeCycle'],
};

const INITIAL_FORM = {
  name: '',
  businessName: '',
  mobile: '',
  email: '',
  cityOrArea: '',
  currency: 'INR',
  openingCashBalance: '0',
  feeCycle: 'monthly',
};

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      name: f.name || user?.name || '',
      email: f.email || user?.email || '',
    }));
  }, [user]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function validateStep(s) {
    const errors = {};
    if (s === 1) {
      if (!form.name.trim()) errors.name = 'Please enter your name.';
      if (!form.mobile.trim()) {
        errors.mobile = 'Please enter your mobile number.';
      } else {
        const digits = form.mobile.replace(/[\s-]/g, '').replace(/^\+91/, '');
        if (!/^\d{10}$/.test(digits)) errors.mobile = 'Enter a 10-digit mobile number.';
      }
      if (!form.email.trim()) {
        errors.email = 'Please enter your email address.';
      } else if (!EMAIL_RE.test(form.email.trim())) {
        errors.email = 'Enter a valid email address.';
      }
    }
    return errors;
  }

  function goNext() {
    const errors = validateStep(step);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) {
      setError('');
      setStep((s) => Math.min(3, s + 1));
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (step < 3) {
      goNext();
      return;
    }
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
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
      navigate('/home', { replace: true });
    } catch (err) {
      if (err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        const keys = Object.keys(err.fieldErrors);
        const target = [1, 2, 3].find((n) => STEP_FIELDS[n].some((f) => keys.includes(f)));
        if (target) setStep(target);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <h1 className="brand">FeeSaathi</h1>
        <p className="tagline">Your Teaching Business, Financially in Control.</p>
        <h2>Set up your business</h2>
        <div className="stepper">
          <span className={'step' + (step === 1 ? ' active' : '')}>1 Business</span>
          <span className={'step' + (step === 2 ? ' active' : '')}>2 Cash</span>
          <span className={'step' + (step === 3 ? ' active' : '')}>3 Cycle</span>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <form onSubmit={onSubmit}>
          {step === 1 && (
            <>
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
                  <input
                    value={form.businessName}
                    onChange={(e) => update('businessName', e.target.value)}
                  />
                </label>
                {fieldErrors.businessName && <p className="field-error">{fieldErrors.businessName}</p>}
              </div>
              <div className="field">
                <label>
                  Mobile number
                  <input
                    type="tel"
                    value={form.mobile}
                    onChange={(e) => update('mobile', e.target.value)}
                  />
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
            </>
          )}
          {step === 2 && (
            <>
              <div className="field">
                <label>
                  City or area
                  <input
                    value={form.cityOrArea}
                    onChange={(e) => update('cityOrArea', e.target.value)}
                  />
                </label>
                {fieldErrors.cityOrArea && <p className="field-error">{fieldErrors.cityOrArea}</p>}
              </div>
              <div className="field">
                <label>
                  Currency
                  <select value={form.currency} onChange={(e) => update('currency', e.target.value)}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="AED">AED</option>
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
            </>
          )}
          {step === 3 && (
            <div className="field">
              <fieldset>
                <legend>Fee cycle</legend>
                {[
                  ['monthly', 'Monthly'],
                  ['weekly', 'Weekly'],
                  ['per_class', 'Per class'],
                  ['custom', 'Custom'],
                ].map(([value, label]) => (
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
          )}
          <div>
            {step > 1 && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
              >
                Back
              </button>
            )}
            {step < 3 && (
              <button className="btn btn-primary" type="button" onClick={goNext}>
                Next
              </button>
            )}
            {step === 3 && (
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Finish setup'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
