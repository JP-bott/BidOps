import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const seed = {
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
    { id: 'psa', name: 'PSA', url: 'https://procurement.psa.gov.ph/invitationbid/' },
    { id: 'bsp', name: 'BSP', url: 'https://www.bsp.gov.ph/SitePages/Procurement/Procurement.aspx' },
  ],
  keywords: [
    'Data Analytics', 'Data Science', 'Business Integration', 'Data Visualization', 'Data Integration',
    'Various Software', 'Power BI', 'Business Intelligence', 'Advanced Analytics', 'Cloud Services',
    'Artificial Intelligence', 'Software License', 'Software Subscription', 'Video Conferencing', 'Zoom',
    'Data Warehouse', 'Canva', 'Codex',
  ],
};

let initialized;

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
  const urls = new Set();
  const agencies = data.agencies.map((agency) => {
    const id = typeof agency?.id === 'string' && agency.id ? agency.id : '';
    const name = typeof agency?.name === 'string' ? agency.name.trim() : '';
    const url = typeof agency?.url === 'string' ? agency.url.trim() : '';
    if (!id || !name) throw new Error('Every agency needs an id and name.');
    if (!isHttpUrl(url)) throw new Error(`"${name}" needs a URL starting with http:// or https://`);
    if (urls.has(url.toLowerCase())) throw new Error(`Duplicate URL: ${url}`);
    urls.add(url.toLowerCase());
    return { id, name, url };
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

async function ensureDatabase() {
  if (!initialized) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      throw new Error('Turso environment variables are not configured.');
    }
    initialized = client.batch([
      'CREATE TABLE IF NOT EXISTS agencies (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE)',
      'CREATE TABLE IF NOT EXISTS keywords (value TEXT PRIMARY KEY)',
    ], 'write');
    await initialized;
    const count = await client.execute('SELECT (SELECT COUNT(*) FROM agencies) + (SELECT COUNT(*) FROM keywords) AS total');
    if (Number(count.rows[0].total) === 0) await replaceData(seed);
  }
}

async function readData() {
  const [agencies, keywords] = await Promise.all([
    client.execute('SELECT id, name, url FROM agencies ORDER BY rowid'),
    client.execute('SELECT value FROM keywords ORDER BY rowid'),
  ]);
  return {
    agencies: agencies.rows,
    keywords: keywords.rows.map((row) => row.value),
  };
}

async function replaceData(data) {
  const clean = validateData(data);
  await client.batch([
    'DELETE FROM agencies',
    'DELETE FROM keywords',
    ...clean.agencies.map((agency) => ({
      sql: 'INSERT INTO agencies (id, name, url) VALUES (?, ?, ?)',
      args: [agency.id, agency.name, agency.url],
    })),
    ...clean.keywords.map((keyword) => ({
      sql: 'INSERT INTO keywords (value) VALUES (?)',
      args: [keyword],
    })),
  ], 'write');
  return clean;
}

export default async function handler(req, res) {
  try {
    await ensureDatabase();
    if (req.method === 'GET') return res.status(200).json(await readData());
    if (req.method === 'PUT') return res.status(200).json(await replaceData(req.body));
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    return res.status(error.message.includes('Turso environment') ? 500 : 400)
      .json({ error: error.message || 'Database request failed.' });
  }
}
