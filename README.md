# Bid Opportunities

React (Vite) front end backed by a local SQLite database through the Express API.

## Run (Node 18+ required)

```
npm install
npm run dev
```

Open http://localhost:3000. Changes are saved in `data/bidops.sqlite`; no separate
database server is required.

## Production

```
npm run build
npm start
```

Export JSON / Import JSON are available for backups. On first run, the SQLite
database is seeded from `data/seed.json`.

## Database location

The database path defaults to `data/bidops.sqlite`. Set `DATABASE_PATH` to use a
different SQLite file:

```
DATABASE_PATH=/path/to/bidops.sqlite npm start
```
