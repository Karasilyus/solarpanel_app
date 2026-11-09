const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { createApp } = require('../src/app');
const { normalizeBatch } = require('../src/records');

const validRecord = {
  device_id: 'panel-01',
  boot: 3,
  seq: 142,
  ts: 1794268800,
  night: false,
  n: 5,
  trk_ok: 5,
  fix_ok: 5,
  trk_wh: 0.42,
  fix_wh: 0.31,
  angle_deg: 18.5,
};

async function startServer(t, pool) {
  const server = createApp(pool, '*').listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('normalizes an unknown timestamp to null', () => {
  const [values] = normalizeBatch([{ ...validRecord, ts: 0 }]);
  assert.equal(values[3], null);
});

test('rejects batches outside the supported size and invalid record values', () => {
  assert.throws(() => normalizeBatch([]), /1 to 20 records/);
  assert.throws(() => normalizeBatch(Array(21).fill(validRecord)), /1 to 20 records/);
  assert.throws(
    () => normalizeBatch([{ ...validRecord, night: 1 }]),
    /night must be a boolean/,
  );
  assert.throws(
    () => normalizeBatch([{ ...validRecord, trk_ok: 6 }]),
    /must not exceed n/,
  );
});

test('ingests batches in a transaction and reports ignored duplicates', async (t) => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      return sql.startsWith('INSERT') ? { rowCount: 1 } : {};
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const baseUrl = await startServer(t, pool);

  const response = await fetch(`${baseUrl}/api/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([validRecord, { ...validRecord, seq: 143 }]),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: 2,
    inserted: 1,
    duplicates: 1,
  });
  assert.equal(statements[0], 'BEGIN');
  assert.match(statements[1], /ON CONFLICT \(device_id, boot, seq\) DO NOTHING/);
  assert.equal(statements[2], 'COMMIT');
});

test('rolls back a batch when the database rejects it', async (t) => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('INSERT')) throw new Error('database constraint failed');
      return {};
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const baseUrl = await startServer(t, pool);
  const originalError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([validRecord]),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to store record batch' });
    assert.equal(statements[0], 'BEGIN');
    assert.match(statements[1], /^INSERT INTO minute_records/);
    assert.equal(statements[2], 'ROLLBACK');
  } finally {
    console.error = originalError;
  }
});

test('daily dashboard applies data quality, sleep, and Istanbul-day filters', async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SUM(trk_wh)')) {
        return { rows: [{ trk_wh: 12, fix_wh: 10, records: 20 }] };
      }
      return { rows: [{ night: true, ts: null }] };
    },
  };
  const baseUrl = await startServer(t, pool);

  const dailyResponse = await fetch(
    `${baseUrl}/api/dashboard/daily?device_id=panel-01&date=2026-11-09`,
  );
  assert.equal(dailyResponse.status, 200);
  assert.deepEqual(await dailyResponse.json(), {
    device_id: 'panel-01',
    date: '2026-11-09',
    timezone: 'Europe/Istanbul',
    energy: {
      trk_wh: 12,
      fix_wh: 10,
      gain_wh: 2,
      gain_percent: 20,
    },
    complete_minutes: 20,
  });
  assert.match(queries[0].sql, /Europe\/Istanbul/);
  assert.match(queries[0].sql, /night = false/);
  assert.match(queries[0].sql, /trk_ok = n/);
  assert.match(queries[0].sql, /fix_ok = n/);

  const statusResponse = await fetch(
    `${baseUrl}/api/dashboard/status?device_id=panel-01`,
  );
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    device_id: 'panel-01',
    night: true,
    ts: null,
  });
});

test('rejects invalid dashboard dates before querying the database', async (t) => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };
  const baseUrl = await startServer(t, pool);

  const response = await fetch(
    `${baseUrl}/api/dashboard/daily?device_id=panel-01&date=2026-02-30`,
  );
  assert.equal(response.status, 400);
  assert.equal(queried, false);
});
