# Bid Opportunities

React (Vite) front end with a small Express server that reads and writes `data.json`.

## Run (Node 18+ required)

```
npm install
npm run dev
```

Open http://localhost:3000. Changes are saved straight to `data.json`.

## Production

```
npm run build
npm start
```

Export JSON / Import JSON are still available for backups.

## Static hosting (Vercel, GitHub Pages)

No server is needed. The app loads `public/data.json`, keeps edits in the browser, and
Export JSON saves them. To publish changes, replace `public/data.json` with the exported file.
On Vercel use the Vite preset (build command `npm run build`, output directory `dist`).
