import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import ghlRouter from './routes/webhooks/ghl.js';
import zoomRouter from './routes/webhooks/zoom.js';
import dashboardRouter from './routes/api/dashboard.js';
import { startMetaAdsCron } from './jobs/metaAdsCron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// SPA fallback — serve index.html for all non-API/webhook routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// Start the Meta Ads cron job
startMetaAdsCron();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
