import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(root, 'data.json');
const PORT = Number(process.env.PORT) || 3000;
const prod = process.argv.includes('--prod');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function validate(d) {
  if (!d || !Array.isArray(d.agencies) || !Array.isArray(d.keywords)) {
    throw new Error('Data must contain "agencies" and "keywords" arrays.');
  }
  const urls = new Set();
  const ids = new Set();
  const kws = new Set();
  const agencies = d.agencies.map((a, i) => {
    const name = typeof a?.name === 'string' ? a.name.trim() : '';
    const url = typeof a?.url === 'string' ? a.url.trim() : '';
    if (!name) throw new Error('Every agency needs a name.');
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ }
    if (!ok) throw new Error(`"${name}" needs a URL starting with http:// or https://`);
    if (urls.has(url.toLowerCase())) throw new Error(`Duplicate URL: ${url}`);
    urls.add(url.toLowerCase());
    let id = typeof a.id === 'string' && a.id.trim() ? a.id.trim() : slug(name) || `agency-${i + 1}`;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    return { id, name, url };
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

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/data', async (req, res) => {
  try {
    res.json(validate(JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))));
  } catch {
    res.status(500).json({ error: 'Unable to read data.json.' });
  }
});

app.put('/api/data', async (req, res) => {
  let clean;
  try { clean = validate(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2) + '\n');
    await fs.rename(tmp, DATA_FILE);
    res.json(clean);
  } catch {
    res.status(500).json({ error: 'Unable to write data.json.' });
  }
});

if (prod) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Invalid JSON body.' : 'Server error.' });
});

app.listen(PORT, () => console.log(`Bid Opportunities running at http://localhost:${PORT} (${prod ? 'production' : 'development'})`));
