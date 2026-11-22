import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const FIELDS = [
  'student_name', 'parent_name', 'parent_mobile', 'fee_amount', 'fee_frequency',
  'email', 'class_grade', 'subject', 'joining_date', 'address', 'notes',
];
const HEADER_LINE = FIELDS.join(',');
const PREVIEW_LIMIT = 20;
const MAX_ROWS = 500;

// Quote-aware CSV split: handles commas and newlines inside "..." and "" escapes.
function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseCsv(text) {
  const lines = splitCsv(String(text || '').replace(/^\uFEFF/, ''));
  if (lines.length === 0) return [];
  const headers = lines[0].map((h) => h.trim().toLowerCase());
  const out = [];
  for (const cells of lines.slice(1)) {
    if (cells.every((c) => c.trim() === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (!FIELDS.includes(h)) return;
      const v = (cells[idx] ?? '').trim();
      if (v === '') return;
      obj[h] = h === 'fee_amount' ? Number(v) : v;
    });
    if (Object.keys(obj).length > 0) out.push(obj);
  }
  return out;
}

function errorText(e) {
  if (typeof e === 'string') return e;
  return (e && (e.message || e.error)) || JSON.stringify(e);
}

export default function StudentImport() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    setRows([]);
    setFileName('');
    setFileError('');
    setSubmitError('');
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) {
        setFileError('This file has no student rows. Check that it has a header line and at least one data row.');
      }
      setRows(parsed);
    } catch {
      setFileError('Could not read this file. Try saving it again as a CSV.');
    }
  }

  async function handleImport() {
    setSubmitting(true);
    setSubmitError('');
    setResult(null);
    try {
      const data = await api('/api/students/import', { method: 'POST', body: { rows } });
      setResult(data);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const preview = rows.slice(0, PREVIEW_LIMIT);
  const tooMany = rows.length > MAX_ROWS;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">Import students</h1>
        <Link to="/students" className="btn btn-secondary">Back to students</Link>
      </div>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          Expected header line:
        </p>
        <code style={{ display: 'block', overflowWrap: 'anywhere', marginBottom: 12 }}>{HEADER_LINE}</code>
        <div className="field">
          <label htmlFor="student-csv">CSV file</label>
          <input id="student-csv" type="file" accept=".csv" onChange={handleFile} />
        </div>
        {fileName && !fileError && <p style={{ margin: 0 }}>{fileName}: {rows.length} row{rows.length === 1 ? '' : 's'} found.</p>}
        {fileError && <div className="form-error">{fileError}</div>}
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          <p style={{ marginTop: 0 }}>
            Showing the first {preview.length} of {rows.length} row{rows.length === 1 ? '' : 's'}.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                {FIELDS.map((f) => (
                  <th key={f} style={{ textAlign: 'left', padding: 4, borderBottom: '1px solid #ccc' }}>{f}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i}>
                  {FIELDS.map((f) => (
                    <td key={f} style={{ padding: 4, borderBottom: '1px solid #eee' }}>{r[f] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {tooMany && (
            <div className="form-error" style={{ marginTop: 12 }}>
              The server accepts at most {MAX_ROWS} rows per import. Split this file and import it in parts.
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={submitting || tooMany}
            onClick={handleImport}
          >
            {submitting ? 'Importing...' : `Import ${rows.length} student${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {submitError && <div className="form-error">{submitError}</div>}

      {result && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Result</h2>
          <p>Imported {result.imported}. {(result.failed || []).length} failed.</p>
          {(result.failed || []).length > 0 && (
            <ul>
              {result.failed.map((f, i) => (
                <li key={i}>
                  Row {f.row}: {(Array.isArray(f.errors) ? f.errors : [f.errors]).map(errorText).join('; ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
