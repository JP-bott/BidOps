import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const prod = process.argv.includes('--prod');
const dataDir = path.join(root, 'data');
const databasePath = process.env.DATABASE_PATH || path.join(dataDir, 'bidops.sqlite');
const seedPath = path.join(dataDir, 'seed.json');

const app = express();
app.use(express.json({ limit: '1mb' }));

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS agencies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS keywords (
    value TEXT PRIMARY KEY COLLATE NOCASE
  );
`);

const count = db.prepare('SELECT (SELECT COUNT(*) FROM agencies) + (SELECT COUNT(*) FROM keywords) AS total').get().total;
if (count === 0 && fs.existsSync(seedPath)) {
  replaceData(JSON.parse(fs.readFileSync(seedPath, 'utf8')));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateData(data) {
  if (!data || !Array.isArray(data.agencies) || !Array.isArray(data.keywords)) {
    throw new Error('Data must contain "agencies" and "keywords" arrays.');
  }
  const agencies = data.agencies.map((agency) => {
    const id = typeof agency?.id === 'string' && agency.id ? agency.id : '';
    const name = typeof agency?.name === 'string' ? agency.name.trim() : '';
    const url = typeof agency?.url === 'string' ? agency.url.trim() : '';
    if (!id || !name) throw new Error('Every agency needs an id and name.');
    if (!isHttpUrl(url)) throw new Error(`"${name}" needs a URL starting with http:// or https://`);
    return { id, name, url };
  });
  const urls = new Set();
  agencies.forEach((agency) => {
    const key = agency.url.toLowerCase();
    if (urls.has(key)) throw new Error(`Duplicate URL: ${agency.url}`);
    urls.add(key);
  });
  const keywords = data.keywords.map((keyword) => {
    const value = typeof keyword === 'string' ? keyword.trim() : '';
    if (!value) throw new Error('Keywords must be non-empty text.');
    return value;
  });
  const uniqueKeywords = new Set();
  keywords.forEach((keyword) => {
    const key = keyword.toLowerCase();
    if (uniqueKeywords.has(key)) throw new Error(`Duplicate keyword: ${keyword}`);
    uniqueKeywords.add(key);
  });
  return { agencies, keywords };
}

function readData() {
  return {
    agencies: db.prepare('SELECT id, name, url FROM agencies ORDER BY rowid').all(),
    keywords: db.prepare('SELECT value FROM keywords ORDER BY rowid').all().map((row) => row.value),
  };
}

function replaceData(data) {
  const clean = validateData(data);
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM agencies').run();
    db.prepare('DELETE FROM keywords').run();
    const agencyInsert = db.prepare('INSERT INTO agencies (id, name, url) VALUES (?, ?, ?)');
    clean.agencies.forEach((agency) => agencyInsert.run(agency.id, agency.name, agency.url));
    const keywordInsert = db.prepare('INSERT INTO keywords (value) VALUES (?)');
    clean.keywords.forEach((keyword) => keywordInsert.run(keyword));
  });
  transaction();
  return clean;
}

app.get('/api/data', (req, res) => res.json(readData()));
app.put('/api/data', (req, res) => {
  try {
    res.json(replaceData(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid data.' });
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

app.listen(PORT, () => console.log(`Bid Opportunities running at http://localhost:${PORT} (${prod ? 'production' : 'development'}) using SQLite`));
