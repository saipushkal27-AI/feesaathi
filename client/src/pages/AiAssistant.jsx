import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const EXAMPLES = [
  'Who has not paid?',
  'How much did I collect this month?',
  'Which bills must I pay this week?',
  'Will I have enough money next month?',
  'Which parents should I contact today?',
  'How much did I spend on teaching materials?',
];

const SOURCE_LABEL = {
  calculated: 'Calculated from your records',
  ai: 'AI-phrased from your records',
};

export default function AiAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const listEnd = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api('/api/ai/status')
      .then((res) => {
        if (!cancelled) setAiAvailable(res.ai_available !== false);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;

    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    setSending(true);
    try {
      const res = await api('/api/ai/chat', { method: 'POST', body: { question } });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer, source: res.source, intent: res.intent },
      ]);
    } catch (err) {
      const questionError = err.status === 400 && err.fieldErrors?.question;
      const text = questionError
        ? (Array.isArray(questionError) ? questionError[0] : String(questionError))
        : 'Could not get an answer right now. Try again.';
      setMessages((prev) => [...prev, { role: 'assistant', text, error: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">FeeSaathi AI</h1>

      {!aiAvailable && (
        <div className="card" style={{ background: '#FFF7ED', color: '#9A3412' }}>
          AI phrasing is off. Answers come straight from your records.
        </div>
      )}

      <div className="card">
        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.length === 0 && (
            <p style={{ color: '#555', margin: 0 }}>Ask a question about your fees, bills, or cash.</p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? '#3B9EFF' : '#F1F5F9',
                color: m.role === 'user' ? '#FFFFFF' : '#0B1F3A',
                padding: '8px 12px',
                borderRadius: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              <div>{m.text}</div>
              {m.role === 'assistant' && SOURCE_LABEL[m.source] && (
                <div style={{ fontSize: '0.75rem', color: '#555', marginTop: 4 }}>{SOURCE_LABEL[m.source]}</div>
              )}
            </div>
          ))}
          {sending && <div style={{ color: '#555', fontSize: '0.9rem' }}>Checking your records...</div>}
          <div ref={listEnd} />
        </div>

        <form onSubmit={send} noValidate style={{ marginTop: 12 }}>
          <div className="inline-field">
            <input
              type="text"
              aria-label="Your question"
              placeholder="Ask about fees, bills or cash"
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || input.trim() === ''}>
              Send
            </button>
          </div>
        </form>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '0.85rem' }} onClick={() => setInput(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Link to="/priority">Open priority recovery</Link>
        <Link to="/forecast">Open cash forecast</Link>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#555' }}>
        FeeSaathi AI reads your records and explains calculated results. It does not change any record.
      </p>
    </div>
  );
}
