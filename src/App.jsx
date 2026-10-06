import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ExternalLink, Plus, Pencil, Trash2, Copy, Check, X,
  Upload, Download, RefreshCw, TriangleAlert,
} from 'lucide-react';

const LS_KEY = 'bidOpportunities.workingCopy.v1';
const DATABASE_URL = '/database.json';

function validate(d) {
  if (!d || !Array.isArray(d.agencies) || !Array.isArray(d.keywords)) throw new Error('Data must contain "agencies" and "keywords" arrays.');
  const urls = new Set(); const kws = new Set();
  const agencies = d.agencies.map((a) => {
    const name = typeof a?.name === 'string' ? a.name.trim() : '';
    const url = typeof a?.url === 'string' ? a.url.trim() : '';
    if (!name) throw new Error('Every agency needs a name.');
    if (!isHttpUrl(url)) throw new Error(`"${name}" needs a URL starting with http:// or https://`);
    if (urls.has(url.toLowerCase())) throw new Error(`Duplicate URL: ${url}`);
    urls.add(url.toLowerCase());
    return { id: typeof a.id === 'string' && a.id ? a.id : makeId(name, []), name, url };
  });
  const keywords = d.keywords.map((k) => {
    const kw = typeof k === 'string' ? k.trim() : '';
    if (!kw) throw new Error('Keywords must be non-empty text.');
    if (kws.has(kw.toLowerCase())) throw new Error(`Duplicate keyword: ${kw}`);
    kws.add(kw.toLowerCase());
    return kw;
  });
  return { agencies, keywords };
}

const api = {
  isStatic: () => true,
  async get() {
    const res = await fetch(DATABASE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('missing');
    const base = validate(await res.json());
    try { const c = localStorage.getItem(LS_KEY); if (c) return validate(JSON.parse(c)); } catch { /* ignore bad copy */ }
    return base;
  },
  async put(d) {
    const clean = validate(d);
    try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); } catch { /* storage unavailable */ }
    return clean;
  },
  resetWorkingCopy: () => { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } },
};

const isHttpUrl = (s) => {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const openUrl = (u) => window.open(u, '_blank', 'noopener,noreferrer');
const makeId = (name, list) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
  let id = base; let n = 2;
  while (list.some((a) => a.id === id)) id = `${base}-${n++}`;
  return id;
};

/* ---------- Modals ---------- */
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    (el.querySelector('input, [data-autofocus]') || el).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="iconbtn" aria-label="Close dialog" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function FormModal({ title, fields, submitLabel, onSubmit, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.value])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const err = await onSubmit(values);
    setBusy(false);
    if (err) setError(err); else onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {fields.map((f) => (
          <div className="field" key={f.name}>
            <label htmlFor={`f-${f.name}`}>{f.label}</label>
            <input
              id={`f-${f.name}`} type="text" autoComplete="off" placeholder={f.placeholder}
              value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          </div>
        ))}
        <p className="form-error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, message, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{message}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" data-autofocus onClick={async () => { await onConfirm(); onClose(); }}>Delete</button>
      </div>
    </Modal>
  );
}

function ImportModal({ onSubmit, onClose }) {
  const [parsed, setParsed] = useState(null);
  const [info, setInfo] = useState({ text: '', bad: false });
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    setParsed(null); setInfo({ text: '', bad: false });
    const file = e.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.agencies) || !Array.isArray(obj.keywords)) throw new Error('shape');
      setParsed(obj);
      setInfo({ text: `Ready: ${obj.agencies.length} agencies, ${obj.keywords.length} keywords.`, bad: false });
    } catch {
      setInfo({ text: 'This is not a valid data file. It needs "agencies" and "keywords" arrays.', bad: true });
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const err = await onSubmit(parsed);
    setBusy(false);
    if (err) setInfo({ text: err, bad: true }); else onClose();
  };
  return (
    <Modal title="Import JSON" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">Choose a previously exported database.json. It replaces the current agencies and keywords.</p>
        <div className="field">
          <label htmlFor="import-file">JSON file</label>
          <input id="import-file" type="file" accept=".json,application/json" onChange={pick} />
        </div>
        <p className={info.bad ? 'form-error' : 'muted'} role="status">{info.text}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!parsed || busy}>Import data</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Items ---------- */
function CopyButton({ text, onCopied, onFail }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    try { await navigator.clipboard.writeText(text); } catch { onFail(); return; }
    setDone(true); onCopied();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" className={`btn btn-sm${done ? ' ok' : ''}`} aria-label={`Copy keyword ${text}`} onClick={click}>
      {done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copied' : 'Copy'}
    </button>
  );
}

function AgencyCard({ agency, onEdit, onDelete }) {
  return (
    <li className="card">
      <button type="button" className="card-main" aria-label={`Open ${agency.name} in a new tab`} onClick={() => openUrl(agency.url)}>
        <span className="card-top"><strong>{agency.name}</strong><ExternalLink size={16} /></span>
        <span className="muted small">Government Procurement</span>
        <span className="host">{hostOf(agency.url)}</span>
      </button>
      <div className="card-actions">
        <button type="button" onClick={() => openUrl(agency.url)}><ExternalLink size={14} />Open</button>
        <button type="button" onClick={onEdit}><Pencil size={14} />Edit</button>
        <button type="button" className="danger" onClick={onDelete}><Trash2 size={14} />Delete</button>
      </div>
    </li>
  );
}

/* ---------- App ---------- */
export default function App() {
  const [data, setData] = useState({ agencies: [], keywords: [] });
  const [status, setStatus] = useState('loading');
  const [tab, setTab] = useState('agencies');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isStatic, setIsStatic] = useState(false);
  const nextId = useRef(1);

  const toast = useCallback((message, type = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try { setData(await api.get()); setIsStatic(api.isStatic()); setStatus('ready'); } catch { setStatus('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Persist changes in this browser. Export JSON publishes a new database file.
  const save = async (next, message) => {
    try { setData(await api.put(next)); toast(message); return null; }
    catch (e) { return e.message || 'Could not save changes.'; }
  };
  const run = async (promise) => { const err = await promise; if (err) toast(err, 'error'); };

  const saveAgency = (existing, v) => {
    const name = v.name.trim(); const url = v.url.trim();
    if (!name) return 'Agency name is required.';
    if (!url) return 'URL is required.';
    if (!isHttpUrl(url)) return 'Enter a URL starting with http:// or https://';
    if (data.agencies.some((a) => a.id !== existing?.id && a.url.toLowerCase() === url.toLowerCase())) return 'An agency with this URL already exists.';
    const agencies = existing
      ? data.agencies.map((a) => (a.id === existing.id ? { ...a, name, url } : a))
      : [...data.agencies, { id: makeId(name, data.agencies), name, url }];
    return save({ ...data, agencies }, existing ? 'Agency updated successfully' : 'Agency added successfully');
  };
  const saveKeyword = (existing, v) => {
    const kw = v.kw.trim();
    if (!kw) return 'Keyword is required.';
    if (data.keywords.some((k) => k !== existing && k.toLowerCase() === kw.toLowerCase())) return 'This keyword already exists.';
    const keywords = existing ? data.keywords.map((k) => (k === existing ? kw : k)) : [...data.keywords, kw];
    return save({ ...data, keywords }, existing ? 'Keyword updated successfully' : 'Keyword added successfully');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'database.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('JSON exported successfully');
  };

  const q = query.trim().toLowerCase();
  const agencies = useMemo(() => data.agencies.filter((a) => !q || a.name.toLowerCase().includes(q) || a.url.toLowerCase().includes(q)), [data.agencies, q]);
  const keywords = useMemo(() => data.keywords.filter((k) => !q || k.toLowerCase().includes(q)), [data.keywords, q]);

  const closeModal = () => setModal(null);
  const empty = (title, hint) => (<div className="empty"><p><strong>{title}</strong></p><p className="muted">{hint}</p></div>);

  let content;
  if (status === 'loading') {
    content = (<div className="center" role="status"><div className="spinner" /><p className="muted">Loading procurement sources...</p></div>);
  } else if (status === 'error') {
    content = (
      <div className="error-box" role="alert">
        <TriangleAlert size={32} />
        <p><strong>Unable to load procurement data.</strong></p>
        <p className="muted">Check that database.json exists and is accessible.</p>
        <button type="button" className="btn btn-primary" onClick={load}><RefreshCw size={16} />Retry</button>
      </div>
    );
  } else if (tab === 'agencies') {
    content = (
      <>
        <div className="section-head">
          <div><h2>Procurement sources</h2><p className="muted small">{agencies.length} of {data.agencies.length} shown</p></div>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'agency', item: null })}><Plus size={16} />Add Agency</button>
        </div>
        {!data.agencies.length ? empty('No agencies found.', 'Add your first procurement source.')
          : !agencies.length ? empty('No matching agencies.', `Nothing matches "${query.trim()}".`)
          : (
            <ul className="grid">
              {agencies.map((a) => (
                <AgencyCard
                  key={a.id} agency={a}
                  onEdit={() => setModal({ type: 'agency', item: a })}
                  onDelete={() => setModal({
                    type: 'confirm', title: 'Delete Agency?', message: `Are you sure you want to delete ${a.name}?`,
                    onConfirm: () => run(save({ ...data, agencies: data.agencies.filter((x) => x.id !== a.id) }, 'Agency deleted successfully')),
                  })}
                />
              ))}
            </ul>
          )}
      </>
    );
  } else {
    content = (
      <>
        <div className="section-head">
          <div><h2>Search keywords</h2><p className="muted small">{keywords.length} of {data.keywords.length} shown</p></div>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'keyword', item: null })}><Plus size={16} />Add Keyword</button>
        </div>
        {!data.keywords.length ? empty('No keywords found.', 'Add a PhilGEPS search keyword.')
          : !keywords.length ? empty('No matching keywords.', `Nothing matches "${query.trim()}".`)
          : (
            <ul className="kw-grid">
              {keywords.map((k) => (
                <li className="kw" key={k}>
                  <span className="kw-text">{k}</span>
                  <div className="kw-actions">
                    <CopyButton text={k} onCopied={() => toast('Copied to clipboard')} onFail={() => toast('Copy failed. Select the text and copy it manually.', 'error')} />
                    <button type="button" className="iconbtn" aria-label={`Edit ${k}`} title={`Edit ${k}`} onClick={() => setModal({ type: 'keyword', item: k })}><Pencil size={16} /></button>
                    <button type="button" className="iconbtn danger" aria-label={`Delete ${k}`} title={`Delete ${k}`}
                      onClick={() => setModal({
                        type: 'confirm', title: 'Delete Keyword?', message: `Are you sure you want to delete "${k}"?`,
                        onConfirm: () => run(save({ ...data, keywords: data.keywords.filter((x) => x !== k) }, 'Keyword deleted successfully')),
                      })}><Trash2 size={16} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="wrap top-row">
          <div className="brand">
            <div className="logo"><img src="/img/logo.png?v=2" alt="" /></div>
            <div><h1>Bid Opportunities</h1><p className="muted small">Government Procurement Dashboard</p></div>
          </div>
          <div className="search">
            <label htmlFor="search" className="sr-only">Search</label>
            <Search size={16} />
            <input id="search" type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'agencies' ? 'Search agencies by name or URL...' : 'Search keywords...'} />
          </div>
        </div>
      </header>

      <div className="tabbar">
        <div className="wrap tabbar-row">
          <div role="tablist" aria-label="Sections" className="tabs">
            {[['agencies', 'Bid Opportunities', data.agencies.length], ['keywords', 'PhilGEPS Keywords', data.keywords.length]].map(([id, label, n]) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="main" className="tab" onClick={() => setTab(id)}>
                {label}<span className="count">{n}</span>
              </button>
            ))}
          </div>
          <div className="tools" role="group" aria-label="Data management">
            <button type="button" className="btn" onClick={() => setModal({ type: 'import' })}><Upload size={16} />Import JSON</button>
            <button type="button" className="btn" onClick={exportJson} disabled={status !== 'ready'}><Download size={16} />Export JSON</button>
          </div>
        </div>
      </div>

            <main id="main" role="tabpanel" className="wrap main">
        {isStatic && status === 'ready' && (
          <p className="notice" role="note">
            Changes are saved in this browser only. Use Export JSON to keep them.{' '}
            <button type="button" className="linkbtn" onClick={() => { api.resetWorkingCopy(); load(); }}>Discard local changes</button>
          </p>
        )}
        {content}
      </main>
      <footer className="foot">Built by John Paul Torres</footer>

      {modal?.type === 'agency' && (
        <FormModal
          title={modal.item ? 'Edit Agency' : 'Add Agency'} submitLabel="Save Agency" onClose={closeModal}
          fields={[
            { name: 'name', label: 'Agency Name', value: modal.item ? modal.item.name : '', placeholder: 'e.g. DOH' },
            { name: 'url', label: 'URL', value: modal.item ? modal.item.url : '', placeholder: 'https://' },
          ]}
          onSubmit={(v) => saveAgency(modal.item, v)}
        />
      )}
      {modal?.type === 'keyword' && (
        <FormModal
          title={modal.item ? 'Edit Keyword' : 'Add Keyword'} submitLabel="Save Keyword" onClose={closeModal}
          fields={[{ name: 'kw', label: 'Keyword', value: modal.item || '', placeholder: 'e.g. Data Analytics' }]}
          onSubmit={(v) => saveKeyword(modal.item, v)}
        />
      )}
      {modal?.type === 'confirm' && <ConfirmModal title={modal.title} message={modal.message} onConfirm={modal.onConfirm} onClose={closeModal} />}
      {modal?.type === 'import' && <ImportModal onClose={closeModal} onSubmit={(obj) => save(obj, 'JSON imported successfully')} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (<div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>{t.message}</div>))}
      </div>
    </div>
  );
}
