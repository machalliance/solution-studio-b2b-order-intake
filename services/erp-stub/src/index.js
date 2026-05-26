/**
 * @file index.js
 * @description ERP stub service. Accepts submitted orders and exposes GET endpoints
 *              for the Agent Control Interface. Demonstrates the ERPAdapter interface.
 * @module erp-stub
 */
import 'dotenv/config';
import express from 'express';
import pg from 'pg';

const app  = express();
const PORT = process.env.ERP_STUB_PORT || 3001;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

app.use(express.json());

// Health endpoint (required on all services)
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'erp-stub' }));

// Ensure table exists on startup
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS erp_submissions (
      id            SERIAL PRIMARY KEY,
      erp_order_id  UUID         NOT NULL DEFAULT gen_random_uuid(),
      payload       JSONB        NOT NULL,
      status        VARCHAR(20)  NOT NULL DEFAULT 'draft',
      submitted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  console.log('ERP stub ready.');
}

// POST /orders - accept a submitted order
app.post('/orders', async (req, res) => {
  try {
    const payload  = req.body;
    const orderId  = crypto.randomUUID();
    const now      = new Date().toISOString();

    await pool.query(
      `INSERT INTO erp_submissions (erp_order_id, payload, submitted_at)
       VALUES ($1, $2, NOW())`,
      [orderId, JSON.stringify(payload)]
    );

    res.status(201).json({
      orderId,
      status:     'draft',
      receivedAt: now,
      message:    'Order received by ERP stub',
    });
  } catch (err) {
    console.error('ERP stub POST /orders error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /orders - list all submitted orders
app.get('/orders', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit  || '50');
    const offset = parseInt(req.query.offset || '0');
    const { rows } = await pool.query(
      `SELECT erp_order_id, status, submitted_at,
              payload->>'poNumber' AS po_number,
              payload->'customer'->>'companyName' AS company_name
       FROM erp_submissions
       ORDER BY submitted_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ orders: rows, limit, offset });
  } catch (err) {
    console.error('ERP stub GET /orders error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /orders/:id - get a specific submitted order with full payload
app.get('/orders/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM erp_submissions WHERE erp_order_id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('ERP stub GET /orders/:id error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

init()
  .then(() => app.listen(PORT, () => console.log(`ERP stub running on port ${PORT}`)))
  .catch(err => { console.error('ERP stub init error:', err); process.exit(1); });
