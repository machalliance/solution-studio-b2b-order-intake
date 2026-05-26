/**
 * @file pool.js
 * @description Single shared pg.Pool instance for the pipeline service.
 * @module db/pool
 */
import pg from 'pg';
import 'dotenv/config';
import { logger } from '../util/logger.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pg pool error');
});

export default pool;
