import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
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

db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0), ('seeded', 0);
  CREATE UNIQUE INDEX IF NOT EXISTS agencies_url_nocase ON agencies (url COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS keywords_value_nocase ON keywords (value COLLATE NOCASE);
`);
for (const table of ['agencies', 'keywords']) {
  for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
    db.exec('CREATE TRIGGER IF NOT EXISTS revision_' + table + '_' + action.toLowerCase() +
      ' AFTER ' + action + ' ON ' + table +
      " BEGIN UPDATE metadata SET value=value+1 WHERE key='revision'; END");
  }
}

const count = db.prepare('SELECT (SELECT COUNT(*) FROM agencies) + (SELECT COUNT(*) FROM keywords) AS total').get().total;
if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get().value && count === 0 && fs.existsSync(seedPath)) {
  replaceData(JSON.parse(fs.readFileSync(seedPath, 'utf8')));
}

db.prepare("UPDATE metadata SET value=1 WHERE key='seeded'").run();

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
    revision: db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value,
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

function fail(code, message) { const error = new Error(message); error.status = code; throw error; }
function checkWriteAccess(req) {
  const secret = process.env.BIDOPS_WRITE_KEY;
  if (!secret) return;
  const supplied = req.headers['x-bidops-write-key'];
  const a = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) fail(401, 'Write access requires a valid BidOps edit key.');
}
function agencyInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!name) fail(400, 'Agency name is required.');
  if (!isHttpUrl(url)) fail(400, 'Enter a URL starting with http:// or https://.');
  return { name, url };
}
function keywordInput(body) {
  const value = typeof body?.value === 'string' ? body.value.trim() : '';
  if (!value) fail(400, 'Keyword is required.');
  return value;
}
function idInput(id) {
  if (typeof id !== 'string' || !id.trim()) fail(400, 'A valid identifier is required.');
  return id;
}
function mutate(method, body) {
  return db.transaction(() => {
    let result;
    if (body?.entity === 'agency') {
      if (method === 'POST') {
        const { name, url } = agencyInput(body);
        result = db.prepare('INSERT INTO agencies (id,name,url) VALUES (?,?,?)').run(randomUUID(), name, url);
      } else {
        const id = idInput(body.id);
        const original = agencyInput(body.original);
        if (method === 'PATCH') {
          const { name, url } = agencyInput(body);
          result = db.prepare('UPDATE agencies SET name=?,url=? WHERE id=? AND name=? AND url=?')
            .run(name, url, id, original.name, original.url);
        } else {
          result = db.prepare('DELETE FROM agencies WHERE id=? AND name=? AND url=?')
            .run(id, original.name, original.url);
        }
      }
    } else if (body?.entity === 'keyword') {
      if (method === 'POST') {
        result = db.prepare('INSERT INTO keywords (value) VALUES (?)').run(keywordInput(body));
      } else {
        const oldValue = idInput(body.oldValue);
        result = method === 'PATCH'
          ? db.prepare('UPDATE keywords SET value=? WHERE value=?').run(keywordInput(body), oldValue)
          : db.prepare('DELETE FROM keywords WHERE value=?').run(oldValue);
      }
    } else fail(400, 'Choose an agency or keyword to modify.');
    if (method !== 'POST' && result.changes !== 1) fail(409, 'Record changed in another tab. Reload and try again.');
    return readData();
  })();
}
function importSnapshot(input) {
  const clean = validateData(input);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, 'Reload before importing.');
  const ids = new Set();
  for (const agency of clean.agencies) {
    if (!idInput(agency.id) || ids.has(agency.id)) fail(400, 'Duplicate agency ID in import.');
    ids.add(agency.id);
  }
  return db.transaction(() => {
    if (db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value !== input.expectedRevision) {
      fail(409, 'Database changed in another tab. Refresh before importing.');
    }
    replaceData(clean);
    return readData();
  })();
}
app.all('/api/data', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!['GET','POST','PATCH','DELETE','PUT'].includes(req.method)) {
      res.set('Allow', 'GET, POST, PATCH, DELETE, PUT');
      fail(405, 'Method not allowed.');
    }
    if (req.method !== 'GET') checkWriteAccess(req);
    res.json(req.method === 'GET' ? readData()
      : req.method === 'PUT' ? importSnapshot(req.body)
      : mutate(req.method, req.body));
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message)) {
      return res.status(409).json({ error: 'This URL or keyword already exists. Refresh and try again.' });
    }
    if (!error.status) console.error('BidOps database error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Database request failed.' });
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
