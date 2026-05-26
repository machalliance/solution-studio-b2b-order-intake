/**
 * @file server.js
 * @description Serves the built React SPA and proxies /api calls to the pipeline
 * @module agent-ui/server
 */
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.AGENT_UI_PORT || 3000;

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'agent-ui' }));

// Proxy all /api/* requests to the pipeline service, rewriting to the versioned path.
// UI components call /api/... - the proxy transparently rewrites to /api/v1/...
// so no component changes are needed when the version prefix changes.
const PIPELINE_URL = process.env.PIPELINE_API_URL || 'http://pipeline:3002';
app.use('/api', express.json(), async (req, res) => {
  try {
    const url = `${PIPELINE_URL}/api/v1${req.url}`;
    const opts = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      opts.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(url, opts);
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Pipeline unreachable: ${err.message}` });
  }
});

app.use(express.static(join(__dirname, '../dist')));

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => console.log(`Agent UI running on port ${PORT}`));
