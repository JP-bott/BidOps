# Bid Opportunities

React (Vite) front end backed by SQLite-compatible Turso/libSQL through an API.

## Run (Node 18+ required)

```
npm install
npm run dev
```

Open http://localhost:3000. Local changes are saved in `data/bidops.sqlite`.

## Production

```
npm run build
npm start
```

Export JSON / Import JSON are available for backups. On first run, the SQLite
database is seeded from `data/seed.json`.

## Database location

The local database path defaults to `data/bidops.sqlite`. Set `DATABASE_PATH` to
use a different SQLite file:

```
DATABASE_PATH=/path/to/bidops.sqlite npm start
```

## Vercel deployment

Vercel functions cannot reliably persist a local SQLite file between deployments,
so the deployed API uses Turso/libSQL. Create a Turso database and configure these
Vercel environment variables:

```
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
```

The database tables and initial data are created automatically on the first API
request. Do not commit the token.
