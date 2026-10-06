import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const prod = process.argv.includes('--prod');

const app = express();

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
