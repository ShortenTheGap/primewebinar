import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import ghlRouter from './routes/webhooks/ghl.js';
import zoomRouter from './routes/webhooks/zoom.js';
import dashboardRouter from './routes/api/dashboard.js';
import healthRouter from './routes/api/health.js';
import { startMetaAdsCron } from './jobs/metaAdsCron.js';
import { initSchema } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global safety nets — log but don't crash on unhandled errors
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the Vite build output
// In production (dist/server/index.js), client files are at ../client
// In dev, they'd be at ../dist/client
const clientDir = path.join(__dirname, '../client');
app.use(express.static(clientDir));

// Mount route handlers
app.use('/webhooks/ghl', ghlRouter);
app.use('/webhooks/zoom', zoomRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/health', healthRouter);

// SPA fallback — serve index.html for all non-API/webhook routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// Initialize schema (idempotent), then start the server
initSchema()
  .catch((err) => {
    console.error('Schema init failed — continuing anyway:', err);
  })
  .finally(() => {
    startMetaAdsCron();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
