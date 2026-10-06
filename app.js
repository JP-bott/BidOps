(() => {
'use strict';

/* ---------- Constants ---------- */
const LS_KEY = 'bidOpportunities.workingCopy.v1'; // optional local cache, NOT the database
const SEED = { // used only when opened via file:// (browsers block fetch of local files)
  agencies: [
    { id: 'philgeps', name: 'PhilGEPS', url: 'https://notices.philgeps.gov.ph/GEPS/log-in.aspx' },
    { id: 'doe', name: 'DOE', url: 'https://doe.gov.ph/news-and-events/bids-and-notices/bid-opportunities' },
    { id: 'dswd', name: 'DSWD', url: 'https://procurement.dswd.gov.ph/' },
    { id: 'qc-hall', name: 'QC HALL', url: 'https://quezoncity.gov.ph/public-notices/procurement/' },
    { id: 'bafe', name: 'BAFE', url: 'https://bafe.gov.ph/bid-supplement/' },
    { id: 'dilg', name: 'DILG', url: 'https://ncr.dilg.gov.ph/bac-corner/' },
    { id: 'nfa', name: 'NFA', url: 'https://nfaweb.nfa.gov.ph/webapp/bac/EBPS.nsf/$ViewTemplateAll?OpenForm' },
    { id: 'nmis', name: 'NMIS', url: 'https://nmis.gov.ph/bids-notices-and-invitation/' },
    { id: 'opapru', name: 'OPAPRU', url: 'https://peace.gov.ph/procurement-opportunities/' },
    { id: 'philfida', name: 'PhilFIDA', url: 'https://philfida.da.gov.ph/bids-and-awards-2026/' },
    { id: 'psa', name: 'PSA', url: 'https://procurement.psa.gov.ph/invitationbid/' }
  ],
  keywords: ['Data Analytics', 'Data Science', 'Business Integration', 'Data Visualization', 'Data Integration',
    'Various Software', 'Power BI', 'Business Intelligence', 'Advanced Analytics', 'Cloud Services',
    'Artificial Intelligence', 'Software License', 'Software Subscription', 'Video Conferencing', 'Zoom',
    'Data Warehouse', 'Canva', 'Codex']
};

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[.98]';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none';
const BTN_DANGER = BTN_PRIMARY.replace('bg-slate-900', 'bg-red-600').replace('hover:bg-slate-700', 'hover:bg-red-700');
const INPUT = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';

/* ---------- Tiny DOM helpers (no innerHTML: user data goes through textContent) ---------- */
const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  return el;
}
const icon = (name, cls = 'h-4 w-4') => h('i', { 'data-lucide': name, class: cls, 'aria-hidden': 'true' });
const paint = () => window.lucide && window.lucide.createIcons();

/* ---------- State ---------- */
let appData = { agencies: [], keywords: [] };
const ui = { tab: 'agencies', query: '', status: 'loading', source: '', dirty: false };

/* ---------- JSON data layer ---------- */
function normalizeUrl(value) {
  const s = String(value || '').trim();
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') ? s : null; }
  catch { return null; }
}
function makeId(name, list) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
  let id = base, n = 2;
  while (list.some((a) => a.id === id)) id = `${base}-${n++}`;
  return id;
}
function validateData(d) { // throws Error with a user-friendly message
  if (!d || typeof d !== 'object' || !Array.isArray(d.agencies) || !Array.isArray(d.keywords))
    throw new Error('The file must contain "agencies" and "keywords" arrays.');
  const agencies = [], keywords = [], urls = new Set(), kws = new Set();
  for (const a of d.agencies) {
    const name = typeof a?.name === 'string' ? a.name.trim() : '';
    const url = normalizeUrl(a?.url);
    if (!name) throw new Error('Every agency needs a name.');
    if (!url) throw new Error(`Agency "${name}" needs a valid http(s) URL.`);
    if (urls.has(url.toLowerCase())) throw new Error(`Duplicate agency URL: ${url}`);
    urls.add(url.toLowerCase());
    agencies.push({ id: typeof a.id === 'string' && a.id ? a.id : makeId(name, agencies), name, url });
  }
  for (const k of d.keywords) {
    const kw = typeof k === 'string' ? k.trim() : '';
    if (!kw) throw new Error('Keywords must be non-empty text.');
    if (kws.has(kw.toLowerCase())) throw new Error(`Duplicate keyword: ${kw}`);
    kws.add(kw.toLowerCase());
    keywords.push(kw);
  }
  return { agencies, keywords };
}
async function loadData() {
  ui.status = 'loading'; render();
  try {
    if (location.protocol === 'file:') { appData = validateData(SEED); ui.source = 'Built-in defaults (data.json cannot be fetched from file://)'; }
    else {
      const res = await fetch('data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      appData = validateData(await res.json());
      ui.source = 'data.json';
    }
    ui.dirty = false;
    try { // optional working copy from this browser
      const cached = localStorage.getItem(LS_KEY);
      if (cached) { appData = validateData(JSON.parse(cached)); ui.source = 'Browser working copy'; ui.dirty = true; }
    } catch { /* ignore a bad cache */ }
    ui.status = 'ready';
  } catch { ui.status = 'error'; }
  render();
}
function saveData() { // updates the optional working copy only; the authoritative file comes from exportData()
  ui.dirty = true;
  try { localStorage.setItem(LS_KEY, JSON.stringify(appData)); } catch { /* storage unavailable */ }
}
function checkAgency(name, url, exceptId) {
  if (!name) return 'Agency name is required.';
  if (!url) return 'URL is required.';
  if (!normalizeUrl(url)) return 'Enter a valid URL starting with http:// or https://';
  if (appData.agencies.some((a) => a.id !== exceptId && a.url.toLowerCase() === url.toLowerCase())) return 'An agency with this URL already exists.';
  return null;
}
function addAgency(name, url) {
  name = name.trim(); url = url.trim();
  const err = checkAgency(name, url); if (err) return err;
  appData.agencies.push({ id: makeId(name, appData.agencies), name, url }); saveData(); return null;
}
function updateAgency(id, name, url) {
  name = name.trim(); url = url.trim();
  const err = checkAgency(name, url, id); if (err) return err;
  const a = appData.agencies.find((x) => x.id === id); if (!a) return 'Agency not found.';
  a.name = name; a.url = url; saveData(); return null;
}
function deleteAgency(id) { appData.agencies = appData.agencies.filter((a) => a.id !== id); saveData(); }
function checkKeyword(kw, except) {
  if (!kw) return 'Keyword is required.';
  if (appData.keywords.some((k) => k !== except && k.toLowerCase() === kw.toLowerCase())) return 'This keyword already exists.';
  return null;
}
function addKeyword(kw) { kw = kw.trim(); const err = checkKeyword(kw); if (err) return err; appData.keywords.push(kw); saveData(); return null; }
function updateKeyword(old, kw) {
  kw = kw.trim(); const err = checkKeyword(kw, old); if (err) return err;
  const i = appData.keywords.indexOf(old); if (i < 0) return 'Keyword not found.';
  appData.keywords[i] = kw; saveData(); return null;
}
function deleteKeyword(kw) { appData.keywords = appData.keywords.filter((k) => k !== kw); saveData(); }
function exportData() {
  const blob = new Blob([JSON.stringify(appData, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'data.json' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ui.dirty = false; render(); toast('JSON exported successfully');
}
function importData(obj) { appData = validateData(obj); ui.source = 'Imported file'; saveData(); render(); }

/* ---------- Toasts ---------- */
function toast(msg, type = 'success') {
  const el = h('div', { class: 'toast flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-lg ' + (type === 'error' ? 'border-red-200 text-red-700' : 'border-slate-200 text-slate-800'), role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert-circle' : 'check-circle-2', 'h-4 w-4 ' + (type === 'error' ? 'text-red-600' : 'text-emerald-600')), msg);
  $('#toasts').append(el); paint();
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); }, 2800);
}

/* ---------- Modals ---------- */
let modalEl = null, lastFocus = null;
function openModal(title, content) {
  closeModal(true);
  lastFocus = document.activeElement;
  const panel = h('div', { class: 'modal-panel w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabindex: '-1' },
    h('div', { class: 'flex items-center justify-between border-b border-slate-200 px-4 py-3' },
      h('h2', { id: 'modal-title', class: 'text-base font-semibold', text: title }),
      h('button', { type: 'button', class: 'rounded p-1 text-slate-500 hover:bg-slate-100', 'aria-label': 'Close dialog', onclick: () => closeModal() }, icon('x'))),
    h('div', { class: 'p-4' }, content));
  const back = h('div', { class: 'modal-backdrop fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4', onmousedown: (e) => { if (e.target === back) closeModal(); } }, panel);
  document.body.append(back); modalEl = back; paint();
  (panel.querySelector('input, textarea') || panel.querySelector('[data-autofocus]') || panel).focus();
}
function closeModal(immediate) {
  if (!modalEl) return;
  const m = modalEl; modalEl = null;
  if (immediate) m.remove(); else { m.classList.add('closing'); setTimeout(() => m.remove(), 160); }
  if (!immediate && lastFocus && lastFocus.isConnected) lastFocus.focus();
}
document.addEventListener('keydown', (e) => {
  if (!modalEl) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
  if (e.key === 'Tab') {
    const f = [...modalEl.querySelectorAll('button:not([disabled]), input, textarea, a[href]')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
function footer(...btns) { return h('div', { class: 'mt-4 flex justify-end gap-2' }, btns); }
const cancelBtn = () => h('button', { type: 'button', class: BTN, text: 'Cancel', onclick: () => closeModal() });

function formModal({ title, fields, submitLabel, onSubmit }) {
  const err = h('p', { class: 'min-h-5 text-sm text-red-600', role: 'alert' });
  const inputs = {};
  const form = h('form', {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const vals = {}; for (const f of fields) vals[f.name] = inputs[f.name].value;
      const msg = onSubmit(vals);
      if (msg) err.textContent = msg; else closeModal();
    }
  }, fields.map((f) => {
    inputs[f.name] = h('input', { id: 'f-' + f.name, name: f.name, type: 'text', class: INPUT, value: f.value || '', placeholder: f.placeholder || '', autocomplete: 'off' });
    return h('div', { class: 'mb-3' }, h('label', { for: 'f-' + f.name, class: 'mb-1 block text-sm font-medium', text: f.label }), inputs[f.name]);
  }), err, footer(cancelBtn(), h('button', { type: 'submit', class: BTN_PRIMARY, text: submitLabel })));
  openModal(title, form);
}
function confirmModal(title, message, label, onConfirm) {
  openModal(title, h('div', {}, h('p', { class: 'text-sm text-slate-600', text: message }),
    footer(cancelBtn(), h('button', { type: 'button', class: BTN_DANGER, 'data-autofocus': true, text: label, onclick: () => { closeModal(); onConfirm(); } }))));
}
function importModal() {
  let parsed = null;
  const msg = h('p', { class: 'mt-2 min-h-5 text-sm text-slate-500', role: 'status' });
  const ok = h('button', { type: 'button', class: BTN_PRIMARY, disabled: true, text: 'Import data', onclick: () => {
    try { importData(parsed); closeModal(); toast('JSON imported successfully'); } catch (e) { msg.textContent = e.message; }
  } });
  const file = h('input', { type: 'file', accept: '.json,application/json', id: 'import-file', class: INPUT, onchange: async () => {
    parsed = null; ok.disabled = true; msg.className = 'mt-2 min-h-5 text-sm text-slate-500';
    const f = file.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); const v = validateData(d);
      parsed = v; ok.disabled = false; msg.textContent = `Ready: ${v.agencies.length} agencies, ${v.keywords.length} keywords.`;
    } catch (e) {
      msg.className = 'mt-2 min-h-5 text-sm text-red-600';
      msg.textContent = e instanceof SyntaxError ? 'This file is not valid JSON.' : e.message;
    }
  } });
  openModal('Import JSON', h('div', {},
    h('p', { class: 'mb-3 text-sm text-slate-600', text: 'Choose a previously exported data.json. It replaces the current agencies and keywords.' }),
    h('label', { for: 'import-file', class: 'mb-1 block text-sm font-medium', text: 'JSON file' }), file, msg, footer(cancelBtn(), ok)));
}

/* ---------- Views ---------- */
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const openUrl = (u) => window.open(u, '_blank', 'noopener,noreferrer');
const matches = (q, ...parts) => parts.some((p) => p.toLowerCase().includes(q));

function updateChrome() {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const t = b.dataset.tab, n = t === 'agencies' ? appData.agencies.length : appData.keywords.length;
    b.setAttribute('aria-selected', String(t === ui.tab)); b.tabIndex = t === ui.tab ? 0 : -1;
    b.replaceChildren(icon(t === 'agencies' ? 'building-2' : 'tags'), t === 'agencies' ? 'Bid Opportunities' : 'PhilGEPS Keywords', h('span', { class: 'count', text: String(n) }));
  });
  $('#search').placeholder = ui.tab === 'agencies' ? 'Search agencies by name or URL...' : 'Search keywords...';
}
function sectionHeader(title, shown, total, addLabel, onAdd) {
  const chip = h('span', { class: 'inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600', title: 'Where the data on screen came from' },
    icon('database', 'h-3.5 w-3.5'), 'Source: ' + ui.source,
    ui.dirty ? h('span', { class: 'font-medium text-amber-700', text: '· Unexported changes' }) : null);
  const reset = ui.source === 'Browser working copy' ? h('button', { type: 'button', class: 'text-xs text-slate-500 underline hover:text-slate-800', text: 'Discard working copy', onclick: () => confirmModal('Discard working copy?', 'This reloads the original data.json and removes unexported changes saved in this browser.', 'Discard', () => { try { localStorage.removeItem(LS_KEY); } catch {} loadData(); }) }) : null;
  return h('div', { class: 'mb-4 flex flex-wrap items-center justify-between gap-3' },
    h('div', {}, h('h2', { class: 'text-base font-semibold', text: title }), h('p', { class: 'text-xs text-slate-500', text: `${shown} of ${total} shown` })),
    h('div', { class: 'flex flex-wrap items-center gap-3' }, chip, reset, h('button', { type: 'button', class: BTN_PRIMARY, onclick: onAdd }, icon('plus'), addLabel)));
}
function emptyState(title, hint, action) {
  return h('div', { class: 'rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center' },
    h('p', { class: 'font-medium', text: title }), h('p', { class: 'mt-1 text-sm text-slate-500', text: hint }), action || null);
}
function agenciesView() {
  const q = ui.query.trim().toLowerCase();
  const list = appData.agencies.filter((a) => !q || matches(q, a.name, a.url));
  const wrap = h('div', { class: 'view-enter' }, sectionHeader('Procurement sources', list.length, appData.agencies.length, 'Add Agency', agencyForm));
  if (!appData.agencies.length) { wrap.append(emptyState('No agencies found.', 'Add your first procurement source.')); return wrap; }
  if (!list.length) { wrap.append(emptyState('No matching agencies.', `Nothing matches "${ui.query.trim()}".`)); return wrap; }
  const act = (label, ic, fn, extra = '') => h('button', { type: 'button', class: 'flex flex-1 items-center justify-center gap-1.5 py-2 text-sm text-slate-600 transition hover:bg-slate-50 ' + extra, onclick: fn }, icon(ic, 'h-3.5 w-3.5'), label);
  wrap.append(h('ul', { class: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' }, list.map((a) =>
    h('li', { class: 'flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-slate-400 hover:shadow' },
      h('button', { type: 'button', class: 'flex-1 p-4 text-left', 'aria-label': `Open ${a.name} in a new tab`, onclick: () => openUrl(a.url) },
        h('div', { class: 'flex items-start justify-between gap-2' }, h('h3', { class: 'font-semibold', text: a.name }), icon('external-link', 'h-4 w-4 shrink-0 text-slate-400')),
        h('p', { class: 'mt-0.5 text-xs text-slate-500', text: 'Government Procurement' }),
        h('p', { class: 'mt-3 truncate font-mono text-xs text-slate-400', text: hostOf(a.url) })),
      h('div', { class: 'flex divide-x divide-slate-200 border-t border-slate-200' },
        act('Open', 'external-link', () => openUrl(a.url), 'font-medium text-slate-900'),
        act('Edit', 'pencil', () => agencyForm(a)),
        act('Delete', 'trash-2', () => confirmModal('Delete Agency?', `Are you sure you want to delete ${a.name}?`, 'Delete', () => { deleteAgency(a.id); render(); toast('Agency deleted successfully'); }), 'hover:text-red-600'))))));
  return wrap;
}
function agencyForm(a) {
  const edit = a && a.id;
  formModal({
    title: edit ? 'Edit Agency' : 'Add Agency', submitLabel: 'Save Agency',
    fields: [{ name: 'name', label: 'Agency Name', value: edit ? a.name : '', placeholder: 'e.g. DOH' }, { name: 'url', label: 'URL', value: edit ? a.url : '', placeholder: 'https://' }],
    onSubmit: (v) => {
      const err = edit ? updateAgency(a.id, v.name, v.url) : addAgency(v.name, v.url);
      if (!err) { render(); toast(edit ? 'Agency updated successfully' : 'Agency added successfully'); }
      return err;
    }
  });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try { const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
    catch { return false; }
  }
}
function copyButton(kw) {
  const set = (done) => { btn.replaceChildren(icon(done ? 'check' : 'copy', 'h-3.5 w-3.5'), done ? 'Copied' : 'Copy'); btn.classList.toggle('text-emerald-700', done); paint(); };
  const btn = h('button', { type: 'button', class: BTN + ' !px-2.5 !py-1', 'aria-label': `Copy keyword ${kw}`, onclick: async () => {
    if (await copyText(kw)) { set(true); toast('Copied to clipboard'); setTimeout(() => btn.isConnected && set(false), 2000); }
    else toast('Copy failed. Select the text and copy it manually.', 'error');
  } }, icon('copy', 'h-3.5 w-3.5'), 'Copy');
  return btn;
}
function keywordsView() {
  const q = ui.query.trim().toLowerCase();
  const list = appData.keywords.filter((k) => !q || matches(q, k));
  const wrap = h('div', { class: 'view-enter' }, sectionHeader('Search keywords', list.length, appData.keywords.length, 'Add Keyword', () => keywordForm()));
  if (!appData.keywords.length) { wrap.append(emptyState('No keywords found.', 'Add a PhilGEPS search keyword.')); return wrap; }
  if (!list.length) { wrap.append(emptyState('No matching keywords.', `Nothing matches "${ui.query.trim()}".`)); return wrap; }
  const iconBtn = (label, ic, fn, extra = '') => h('button', { type: 'button', class: 'rounded p-1.5 text-slate-500 transition hover:bg-slate-100 ' + extra, 'aria-label': label, title: label, onclick: fn }, icon(ic, 'h-4 w-4'));
  wrap.append(h('ul', { class: 'grid gap-2 md:grid-cols-2' }, list.map((k) =>
    h('li', { class: 'flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white py-2 pl-3 pr-2 shadow-sm' },
      h('span', { class: 'min-w-0 truncate text-sm font-medium', text: k }),
      h('div', { class: 'flex shrink-0 items-center gap-1' }, copyButton(k),
        iconBtn(`Edit ${k}`, 'pencil', () => keywordForm(k)),
        iconBtn(`Delete ${k}`, 'trash-2', () => confirmModal('Delete Keyword?', `Are you sure you want to delete "${k}"?`, 'Delete', () => { deleteKeyword(k); render(); toast('Keyword deleted successfully'); }), 'hover:!text-red-600'))))));
  return wrap;
}
function keywordForm(old) {
  formModal({
    title: old ? 'Edit Keyword' : 'Add Keyword', submitLabel: 'Save Keyword',
    fields: [{ name: 'kw', label: 'Keyword', value: old || '', placeholder: 'e.g. Data Analytics' }],
    onSubmit: (v) => {
      const err = old ? updateKeyword(old, v.kw) : addKeyword(v.kw);
      if (!err) { render(); toast(old ? 'Keyword updated successfully' : 'Keyword added successfully'); }
      return err;
    }
  });
}
function loaderView() {
  return h('div', { class: 'grid place-items-center gap-3 py-24 text-slate-500', role: 'status' },
    h('div', { class: 'h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800' }), h('p', { class: 'text-sm', text: 'Loading procurement sources...' }));
}
function errorView() {
  return h('div', { class: 'mx-auto max-w-md rounded-lg border border-red-200 bg-white p-6 text-center', role: 'alert' },
    icon('triangle-alert', 'mx-auto h-8 w-8 text-red-600'),
    h('p', { class: 'mt-3 font-semibold', text: 'Unable to load procurement data.' }),
    h('p', { class: 'mt-1 text-sm text-slate-500', text: 'Check that data.json exists and is accessible.' }),
    h('div', { class: 'mt-4 flex justify-center gap-2' },
      h('button', { type: 'button', class: BTN_PRIMARY, onclick: loadData }, icon('refresh-cw'), 'Retry'),
      h('button', { type: 'button', class: BTN, onclick: importModal }, icon('upload'), 'Import JSON')));
}

/* ---------- Render + wiring ---------- */
function render() {
  const view = $('#view'); view.replaceChildren();
  updateChrome();
  view.append(ui.status === 'loading' ? loaderView() : ui.status === 'error' ? errorView() : ui.tab === 'agencies' ? agenciesView() : keywordsView());
  paint();
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));
$('[role=tablist]').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  ui.tab = ui.tab === 'agencies' ? 'keywords' : 'agencies'; render(); $('#tab-' + ui.tab).focus();
});
$('#search').addEventListener('input', (e) => { ui.query = e.target.value; if (ui.status === 'ready') render(); });
$('#btn-import').addEventListener('click', importModal);
$('#btn-export').addEventListener('click', exportData);
window.addEventListener('beforeunload', (e) => { if (ui.dirty && ui.status === 'ready') { e.preventDefault(); e.returnValue = ''; } });

loadData();
})();
