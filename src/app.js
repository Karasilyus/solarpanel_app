const cors = require('cors');
const express = require('express');
const { normalizeBatch } = require('./records');

const INSERT_COLUMNS = [
  'device_id',
  'boot',
  'seq',
  'ts',
  'night',
  'n',
  'trk_ok',
  'fix_ok',
  'trk_wh',
  'fix_wh',
  'angle_deg',
];

function insertStatement(recordCount) {
  const placeholders = [];
  let parameter = 1;

  for (let row = 0; row < recordCount; row += 1) {
    const rowPlaceholders = INSERT_COLUMNS.map(() => `$${parameter++}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  return `INSERT INTO minute_records (${INSERT_COLUMNS.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (device_id, boot, seq) DO NOTHING`;
}

function readDashboardParams(req, res) {
  const { device_id: deviceId, date } = req.query;

  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    res.status(400).json({ error: 'device_id query parameter is required' });
    return null;
  }

  if (date !== undefined) {
    const parsedDate = typeof date === 'string'
      ? new Date(`${date}T00:00:00.000Z`)
      : null;
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date.startsWith('0000-') ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date' });
      return null;
    }
  }

  return { deviceId: deviceId.trim(), date };
}

function createApp(pool, allowedOrigins = process.env.CORS_ORIGIN || '*') {
  const app = express();
  const corsOptions = allowedOrigins === '*'
    ? { origin: '*' }
    : { origin: allowedOrigins.split(',').map((origin) => origin.trim()) };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '128kb' }));

  app.get('/healthz', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Health check database query failed:', error);
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.post('/api/records', async (req, res) => {
    let rows;

    try {
      rows = normalizeBatch(req.body);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    let client;
    let transactionStarted = false;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      transactionStarted = true;
      const result = await client.query(insertStatement(rows.length), rows.flat());
      await client.query('COMMIT');
      transactionStarted = false;

      res.status(200).json({
        received: rows.length,
        inserted: result.rowCount,
        duplicates: rows.length - result.rowCount,
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Failed to roll back record batch:', rollbackError);
        }
      }

      console.error('Failed to ingest record batch:', error);
      res.status(500).json({ error: 'Unable to store record batch' });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/dashboard/daily', async (req, res) => {
    const params = readDashboardParams(req, res);
    if (!params) return;
    if (!params.date) {
      res.status(400).json({ error: 'date query parameter is required' });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT
           COALESCE(SUM(trk_wh), 0)::double precision AS trk_wh,
           COALESCE(SUM(fix_wh), 0)::double precision AS fix_wh,
           COUNT(*)::integer AS records
         FROM minute_records
         WHERE device_id = $1
           AND ts IS NOT NULL
           AND ts >= ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul')
           AND ts < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
           AND night = false
           AND trk_ok = n
           AND fix_ok = n`,
        [params.deviceId, params.date],
      );

      const trkWh = result.rows[0].trk_wh;
      const fixWh = result.rows[0].fix_wh;
      const gainWh = trkWh - fixWh;

      res.status(200).json({
        device_id: params.deviceId,
        date: params.date,
        timezone: 'Europe/Istanbul',
        energy: {
          trk_wh: trkWh,
          fix_wh: fixWh,
          gain_wh: gainWh,
          gain_percent: fixWh === 0 ? null : (gainWh / fixWh) * 100,
        },
        complete_minutes: result.rows[0].records,
      });
    } catch (error) {
      console.error('Failed to fetch daily dashboard data:', error);
      res.status(500).json({ error: 'Unable to fetch daily dashboard data' });
    }
  });

  app.get('/api/dashboard/status', async (req, res) => {
    const params = readDashboardParams(req, res);
    if (!params) return;

    try {
      const result = await pool.query(
        `SELECT night, ts
         FROM minute_records
         WHERE device_id = $1
         ORDER BY boot DESC, seq DESC
         LIMIT 1`,
        [params.deviceId],
      );

      const latest = result.rows[0];
      res.status(200).json({
        device_id: params.deviceId,
        night: latest ? latest.night : null,
        ts: latest ? latest.ts : null,
      });
    } catch (error) {
      console.error('Failed to fetch device status:', error);
      res.status(500).json({ error: 'Unable to fetch device status' });
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Request body must contain valid JSON' });
      return;
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large' });
      return;
    }

    console.error('Unhandled request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
