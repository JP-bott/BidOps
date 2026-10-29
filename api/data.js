import { createClient } from '@libsql/client';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const seed = {
  "agencies": [
    {
      "id": "philgeps",
      "name": "PhilGEPS",
      "url": "https://notices.philgeps.gov.ph/GEPS/log-in.aspx"
    },
    {
      "id": "doe",
      "name": "DOE",
      "url": "https://doe.gov.ph/news-and-events/bids-and-notices/bid-opportunities"
    },
    {
      "id": "dswd",
      "name": "DSWD",
      "url": "https://procurement.dswd.gov.ph/"
    },
    {
      "id": "qc-hall",
      "name": "QC HALL",
      "url": "https://quezoncity.gov.ph/public-notices/procurement/"
    },
    {
      "id": "bafe",
      "name": "BAFE",
      "url": "https://bafe.gov.ph/bid-supplement/"
    },
    {
      "id": "dilg",
      "name": "DILG",
      "url": "https://ncr.dilg.gov.ph/bac-corner/"
    },
    {
      "id": "nfa",
      "name": "NFA",
      "url": "https://nfaweb.nfa.gov.ph/webapp/bac/EBPS.nsf/$ViewTemplateAll?OpenForm"
    },
    {
      "id": "nmis",
      "name": "NMIS",
      "url": "https://nmis.gov.ph/bids-notices-and-invitation/"
    },
    {
      "id": "opapru",
      "name": "OPAPRU",
      "url": "https://peace.gov.ph/procurement-opportunities/"
    },
    {
      "id": "philfida",
      "name": "PhilFIDA",
      "url": "https://philfida.da.gov.ph/bids-and-awards-2026/"
    },
    {
      "id": "psa",
      "name": "PSA",
      "url": "https://procurement.psa.gov.ph/invitationbid/"
    },
    {
      "id": "bsp",
      "name": "BSP",
      "url": "https://www.bsp.gov.ph/SitePages/Procurement/Procurement.aspx"
    }
  ],
  "keywords": [
    "Data Analytics",
    "Data Science",
    "Business Integration",
    "Data Visualization",
    "Data Integration",
    "Various Software",
    "Power BI",
    "Business Intelligence",
    "Advanced Analytics",
    "Cloud Services",
    "Artificial Intelligence",
    "Software License",
    "Software Subscription",
    "Video Conferencing",
    "Zoom",
    "Data Warehouse",
    "Canva",
    "Codex"
  ]
};

let client;
let initialized;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function database() {
  if (!client) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new ApiError(500, 'Turso environment variables are not configured.');
    }
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

function checkWriteAccess(req) {
  const secret = process.env.BIDOPS_WRITE_KEY;
  if (!secret) return;
  const supplied = req.headers['x-bidops-write-key'];
  const a = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'Write access requires a valid BidOps edit key.');
  }
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function agencyInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!name) throw new ApiError(400, 'Agency name is required.');
  if (!httpUrl(url)) throw new ApiError(400, 'Enter a URL starting with http:// or https://.');
  return { name, url };
}

function keywordInput(body) {
  const value = typeof body?.value === 'string' ? body.value.trim() : '';
  if (!value) throw new ApiError(400, 'Keyword is required.');
  return value;
}

function requiredId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'A valid record identifier is required.');
  }
  return value;
}

function cleanImport(input) {
  if (!input || !Array.isArray(input.agencies) || !Array.isArray(input.keywords)) {
    throw new ApiError(400, 'Import needs agencies and keywords arrays.');
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ApiError(400, 'Reload the current database before importing.');
  }
  const ids = new Set();
  const urls = new Set();
  const agencies = input.agencies.map((item) => {
    const id = requiredId(item?.id);
    const { name, url } = agencyInput(item);
    if (ids.has(id) || urls.has(url.toLowerCase())) {
      throw new ApiError(400, 'The import contains duplicate agencies or URLs.');
    }
    ids.add(id);
    urls.add(url.toLowerCase());
    return { id, name, url };
  });
  const keywords = input.keywords.map((entry) => keywordInput({ value: entry }));
  const unique = new Set(keywords.map((value) => value.toLowerCase()));
  if (unique.size !== keywords.length) {
    throw new ApiError(400, 'The import contains duplicate keywords.');
  }
  return { agencies, keywords };
}

const revisionTriggers = [
  ['agencies', 'INSERT'], ['agencies', 'UPDATE'], ['agencies', 'DELETE'],
  ['keywords', 'INSERT'], ['keywords', 'UPDATE'], ['keywords', 'DELETE'],
].map(([table, action]) => (
  'CREATE TRIGGER IF NOT EXISTS revision_' + table + '_' + action.toLowerCase() +
  ' AFTER ' + action + ' ON ' + table +
  " BEGIN UPDATE metadata SET value = value + 1 WHERE key = 'revision'; END"
));

async function ensureDatabase() {
  if (!initialized) {
    initialized = (async () => {
      const db = database();
      await db.batch([
        'CREATE TABLE IF NOT EXISTS agencies (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE)',
        'CREATE TABLE IF NOT EXISTS keywords (value TEXT PRIMARY KEY)',
        'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)',
        "INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0)",
        "INSERT OR IGNORE INTO metadata (key, value) VALUES ('seeded', 0)",
        'CREATE UNIQUE INDEX IF NOT EXISTS agencies_url_nocase ON agencies (url COLLATE NOCASE)',
        'CREATE UNIQUE INDEX IF NOT EXISTS keywords_value_nocase ON keywords (value COLLATE NOCASE)',
        ...revisionTriggers,
      ], 'write');

      const [marker, count] = await db.batch([
        "SELECT value FROM metadata WHERE key = 'seeded'",
        'SELECT (SELECT COUNT(*) FROM agencies) + (SELECT COUNT(*) FROM keywords) AS total',
      ], 'read');
      if (Number(marker.rows[0].value) === 0) {
        const statements = [];
        if (Number(count.rows[0].total) === 0) {
          for (const agency of seed.agencies) {
            statements.push({
              sql: 'INSERT OR IGNORE INTO agencies (id, name, url) VALUES (?, ?, ?)',
              args: [agency.id, agency.name, agency.url],
            });
          }
          for (const value of seed.keywords) {
            statements.push({
              sql: 'INSERT OR IGNORE INTO keywords (value) VALUES (?)',
              args: [value],
            });
          }
        }
        statements.push("UPDATE metadata SET value = 1 WHERE key = 'seeded'");
        await db.batch(statements, 'write');
      }
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

async function readData() {
  const [agencies, keywords, revision] = await database().batch([
    'SELECT id, name, url FROM agencies ORDER BY rowid',
    'SELECT value FROM keywords ORDER BY rowid',
    "SELECT value FROM metadata WHERE key = 'revision'",
  ], 'read');
  return {
    agencies: agencies.rows.map((row) => ({ id: row.id, name: row.name, url: row.url })),
    keywords: keywords.rows.map((row) => row.value),
    revision: Number(revision.rows[0].value),
  };
}

async function mutate(method, input) {
  const db = database();
  const type = input?.entity;
  if (type !== 'agency' && type !== 'keyword') {
    throw new ApiError(400, 'Choose an agency or keyword to modify.');
  }

  let result;
  if (type === 'agency') {
    if (method === 'POST') {
      const { name, url } = agencyInput(input);
      result = await db.execute({
        sql: 'INSERT INTO agencies (id, name, url) VALUES (?, ?, ?)',
        args: [randomUUID(), name, url],
      });
    } else if (method === 'PATCH') {
      const id = requiredId(input.id);
      const { name, url } = agencyInput(input);
      const original = agencyInput(input.original);
      result = await db.execute({
        sql: 'UPDATE agencies SET name = ?, url = ? WHERE id = ? AND name = ? AND url = ?',
        args: [name, url, id, original.name, original.url],
      });
    } else if (method === 'DELETE') {
      const id = requiredId(input.id);
      const original = agencyInput(input.original);
      result = await db.execute({
        sql: 'DELETE FROM agencies WHERE id = ? AND name = ? AND url = ?',
        args: [id, original.name, original.url],
      });
    }
  } else if (method === 'POST') {
    const value = keywordInput(input);
    result = await db.execute({ sql: 'INSERT INTO keywords (value) VALUES (?)', args: [value] });
  } else {
    const oldValue = requiredId(input.oldValue);
    if (method === 'PATCH') {
      const value = keywordInput(input);
      result = await db.execute({
        sql: 'UPDATE keywords SET value = ? WHERE value = ?',
        args: [value, oldValue],
      });
    } else if (method === 'DELETE') {
      result = await db.execute({ sql: 'DELETE FROM keywords WHERE value = ?', args: [oldValue] });
    }
  }

  if (method !== 'POST' && Number(result.rowsAffected) !== 1) {
    throw new ApiError(409, 'This record was changed or deleted in another tab. Reload and try again.');
  }
  return readData();
}

async function importData(input) {
  const clean = cleanImport(input);
  const statements = [{
    sql: "UPDATE metadata SET value = CASE WHEN value = ? THEN value + 1 ELSE NULL END WHERE key = 'revision'",
    args: [input.expectedRevision],
  }, 'DELETE FROM agencies', 'DELETE FROM keywords'];

  for (const agency of clean.agencies) {
    statements.push({
      sql: 'INSERT INTO agencies (id, name, url) VALUES (?, ?, ?)',
      args: [agency.id, agency.name, agency.url],
    });
  }
  for (const keyword of clean.keywords) {
    statements.push({ sql: 'INSERT INTO keywords (value) VALUES (?)', args: [keyword] });
  }
  await database().batch(statements, 'write');
  return readData();
}

function errorResponse(error) {
  if (error instanceof ApiError) return { status: error.status, message: error.message };
  const message = String(error?.message || '');
  if (/metadata\.value|NOT NULL constraint failed: metadata/i.test(message)) {
    return { status: 409, message: 'The database changed in another tab. Refresh before importing.' };
  }
  if (/unique constraint|constraint_unique|SQLITE_CONSTRAINT_UNIQUE|primary key/i.test(message)) {
    return { status: 409, message: 'This agency or keyword already exists. Refresh and try again.' };
  }
  console.error('BidOps API failure:', error);
  return { status: 500, message: 'Database request failed. No success was recorded. Please retry.' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE, PUT');
      throw new ApiError(405, 'Method not allowed.');
    }
    if (req.method !== 'GET') checkWriteAccess(req);
    await ensureDatabase();
    const output = req.method === 'GET' ? await readData()
      : req.method === 'PUT' ? await importData(req.body)
      : await mutate(req.method, req.body);
    return res.status(200).json(output);
  } catch (error) {
    const { status, message } = errorResponse(error);
    return res.status(status).json({ error: message });
  }
}
