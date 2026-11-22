import { useState } from 'react';

const REQUIRED = ['student_name', 'parent_name', 'parent_mobile', 'fee_amount', 'fee_frequency'];

export const FEE_FREQUENCIES = ['monthly', 'weekly', 'per_class', 'custom'];

// Mirrors the server's required rules. Returns { field: message } for missing fields.
export function validateStudentForm(values) {
  const errors = {};
  for (const name of REQUIRED) {
    const v = values?.[name];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors[name] = 'This field is required';
    }
  }
  return errors;
}

const EMPTY = {
  student_name: '', parent_name: '', parent_mobile: '', email: '', class_grade: '',
  subject: '', joining_date: '', address: '', notes: '', fee_amount: '', fee_frequency: 'monthly',
};

// Defined at module level so inputs keep focus across re-renders.
function Field({ name, label, required, value, onChange, disabled, error, type = 'text', as, children, ...rest }) {
  const Tag = as || 'input';
  return (
    <div className="field">
      <label htmlFor={`student-${name}`}>{label}{required ? ' *' : ''}</label>
      <Tag
        id={`student-${name}`}
        name={name}
        type={Tag === 'input' ? type : undefined}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        disabled={disabled}
        {...rest}
      >
        {children}
      </Tag>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export default function StudentForm({ initial, onSubmit, submitting, onCancel, serverErrors = {}, formError = '' }) {
  const [values, setValues] = useState(() => {
    const start = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) {
      if (initial?.[k] !== undefined && initial?.[k] !== null) start[k] = String(initial[k]);
    }
    return start;
  });
  const [localErrors, setLocalErrors] = useState({});

  function set(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validateStudentForm(values);
    setLocalErrors(errs);
    if (Object.keys(errs).length === 0) onSubmit(values);
  }

  const errorFor = (name) => localErrors[name] || serverErrors[name];
  const common = { value: undefined, onChange: set, disabled: submitting };
  const f = (name) => ({ ...common, value: values[name], error: errorFor(name) });

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && <div className="form-error">{formError}</div>}

      <Field name="student_name" label="Student name" required {...f('student_name')} />
      <Field name="parent_name" label="Parent name" required {...f('parent_name')} />
      <Field name="parent_mobile" label="Parent mobile" required type="tel" {...f('parent_mobile')} />
      <Field name="email" label="Email" type="email" {...f('email')} />
      <Field name="class_grade" label="Class / grade" {...f('class_grade')} />
      <Field name="subject" label="Subject" {...f('subject')} />
      <Field name="joining_date" label="Joining date" type="date" {...f('joining_date')} />
      <Field name="address" label="Address" as="textarea" rows={2} {...f('address')} />
      <Field name="notes" label="Notes" as="textarea" rows={2} {...f('notes')} />
      <Field name="fee_amount" label="Fee amount (₹)" required type="number" min="0" step="any" {...f('fee_amount')} />
      <Field name="fee_frequency" label="Fee frequency" required as="select" {...f('fee_frequency')}>
        {FEE_FREQUENCIES.map((opt) => (
          <option key={opt} value={opt}>{opt.replace('_', ' ')}</option>
        ))}
      </Field>

      <div className="inline-field">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save student'}
        </button>
      </div>
    </form>
  );
}
