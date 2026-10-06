# Bid Opportunities

React (Vite) front end that reads `public/database.json` directly in the browser.

## Run (Node 18+ required)

```
npm install
npm run dev
```

Open http://localhost:3000. Changes are saved in the browser's local storage.

## Production

```
npm run build
npm start
```

Export JSON / Import JSON are still available for backups.

## Static hosting (Vercel, GitHub Pages)

No data API server is needed. The app loads `public/database.json`, keeps edits in the
browser, and Export JSON saves them. To publish changes, replace `public/database.json`
with the exported file.
On Vercel use the Vite preset (build command `npm run build`, output directory `dist`).
