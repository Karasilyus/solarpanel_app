const assert = require('node:assert/strict');
const { test } = require('node:test');
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
  trk_v: 12.5,
  trk_ma: 2000,
  fix_v: 12,
  fix_ma: 1500,
  sun_az: 22,
  sun_el: 48,
  servo_az: 15,
  servo_el: 35,
  uptime_s: 86400,
};

async function startServer(t, pool, threshold = 180) {
  const server = createApp(pool, '*', threshold).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('normalizes v1 device payload and permits not-yet-reported sensor fields', () => {
  const [record] = normalizeBatch([{
    ...validRecord,
    ts: 0,
    trk_v: undefined,
    trk_ma: undefined,
    sun_el: undefined,
    servo_az: undefined,
  }]);

  assert.equal(record.ortak[3], null);
  assert.equal(record.ortak[6], 86400);
  assert.equal(record.takipli.enerji_wh, 0.42);
  assert.equal(record.takipli.akim_ma, null);
  assert.equal(record.takipli.servo_azimut_derece, null);
  assert.equal(record.sabit.gerilim_v, 12);
});

test('converts legacy amp input and derives average watts from Wh', () => {
  const [record] = normalizeBatch([{
    cihaz_id: 'legacy',
    acilis_sayaci: 1,
    kayit_sira_no: 2,
    zaman_saniye: 0,
    gece_modu: false,
    olcum_sayisi: 1,
    takipli_gecerli_olcum_sayisi: 1,
    sabit_gecerli_olcum_sayisi: 1,
    takipli_panel: { enerji_wh: 0.5, akim_a: 1 },
    sabit_panel: { enerji_wh: 0.25, akim_a: 0.5 },
  }]);

  assert.equal(record.takipli.akim_ma, 1000);
  assert.equal(record.takipli.guc_w, 30);
  assert.equal(record.sabit.akim_ma, 500);
  assert.equal(record.takipli.servo_azimut_derece, null);
});

test('rejects invalid batches and duplicate keys', () => {
  assert.throws(() => normalizeBatch([]), /1 to 20 records/);
  assert.throws(() => normalizeBatch(Array(21).fill(validRecord)), /1 to 20 records/);
  assert.throws(
    () => normalizeBatch([validRecord, validRecord]),
    /duplicate device_id, boot, and sequence keys/,
  );
  assert.throws(
    () => normalizeBatch([{ ...validRecord, night: 1 }]),
    /night must be a boolean/,
  );
});

test('ingests both panel rows transactionally and refreshes receive time on retries', async (t) => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('INSERT')) {
        return { rows: [{ yeni_kayit: true }, { yeni_kayit: false }], rowCount: 2 };
      }
      return {};
    },
    release() {},
  };
  const baseUrl = await startServer(t, { async connect() { return client; } });

  const response = await fetch(`${baseUrl}/api/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([validRecord, { ...validRecord, seq: 143 }]),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    alinan: 2,
    eklenen: 1,
    mukerrer: 1,
  });
  assert.match(statements[1], /ON CONFLICT \(cihaz_id, acilis_sayaci, kayit_sira_no\)/);
  assert.match(statements[1], /alindi_at = clock_timestamp\(\)/);
  assert.match(statements[1], /akim_ma/);
  assert.equal(statements.at(-1), 'COMMIT');
});

test('rolls back both panel writes when either table rejects the batch', async (t) => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO sabit_panel_kayitlari')) {
        throw new Error('database constraint failed');
      }
      if (sql.startsWith('INSERT INTO takipli_panel_kayitlari')) {
        return { rows: [{ yeni_kayit: true }] };
      }
      return {};
    },
    release() {},
  };
  const baseUrl = await startServer(t, { async connect() { return client; } });
  const originalError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([validRecord]),
    });
    assert.equal(response.status, 500);
    assert.equal(statements.at(-1), 'ROLLBACK');
  } finally {
    console.error = originalError;
  }
});

test('series returns requested date and interval-sampled v1 points', async (t) => {
  let query = '';
  let params;
  const baseUrl = await startServer(t, {
    async query(sql, values) {
      query = sql;
      params = values;
      return {
        rows: [{
          ts: '2026-11-09T08:30:00Z',
          night: false,
          n: 60,
          trk_ok: 60,
          fix_ok: 60,
          trk_wh: 0.42,
          fix_wh: 0.31,
          trk_v: 5.9,
          trk_ma: 166.1,
          fix_v: 5.7,
          fix_ma: 152.7,
          sun_az: 120.4,
          sun_el: 18.7,
          servo_az: 95.1,
          servo_el: 150.2,
        }],
      };
    },
  });
  const response = await fetch(
    `${baseUrl}/api/dashboard/series?device_id=panel-01&date=2026-11-09&interval=5`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.timezone, 'Europe/Istanbul');
  assert.equal(body.points[0].trk_wh, 0.42);
  assert.equal(params[2], 5);
  assert.match(query, /Europe\/Istanbul/);
  assert.match(query, /trk_cumulative_wh/);
});

test('daily returns only days with data and calculates quality coverage', async (t) => {
  let query = '';
  const baseUrl = await startServer(t, {
    async query(sql) {
      query = sql;
      return {
        rows: [{
          date: '2026-11-09',
          trk_wh: 11.84,
          fix_wh: 9.77,
          gain_wh: 2.07,
          gain_percent: 21.2,
          trk_peak_w: 83.5,
          fix_peak_w: 67.9,
          complete_minutes: 548,
          total_minutes: 602,
          coverage_percent: 91,
        }],
      };
    },
  });
  const response = await fetch(
    `${baseUrl}/api/dashboard/daily?device_id=panel-01&from=2026-11-07&to=2026-11-10`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    date: '2026-11-09',
    trk_wh: 11.84,
    fix_wh: 9.77,
    gain_wh: 2.07,
    gain_percent: 21.2,
    trk_peak_w: 83.5,
    fix_peak_w: 67.9,
    complete_minutes: 548,
    total_minutes: 602,
    coverage_percent: 91,
  }]);
  assert.match(query, /Europe\/Istanbul/);
  assert.match(query, /NOT gece_modu/);
  assert.match(query, /complete_minutes/);
});

test('status returns live values, online threshold, and nulls when absent', async (t) => {
  let params;
  const baseUrl = await startServer(t, {
    async query(sql, values) {
      params = values;
      return {
        rows: [{
          cihaz_id: 'panel-01',
          online: true,
          last_record_at: '2026-11-09T11:45:00Z',
          zaman: '2026-11-09T11:45:00Z',
          gece_modu: false,
          calisma_suresi_saniye: 51840,
          acilis_sayaci: 4,
          enerji_wh: 1.29,
          guc_w: 77,
          gerilim_v: 6.12,
          akim_ma: 210.3,
          fix_wh: 1.06,
          fix_guc_w: 63,
          fix_v: 5.87,
          fix_ma: 180.9,
          gunes_azimut_derece: 185.2,
          gunes_yukseklik_derece: 32.1,
          servo_azimut_derece: 140.2,
          servo_yukseklik_derece: 150.9,
        }],
      };
    },
  }, 180);
  const response = await fetch(
    `${baseUrl}/api/dashboard/status?device_id=panel-01`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(params[1], 180);
  assert.ok(Math.abs(body.trk.power_w - 77.4) < 1e-9);
  assert.equal(body.trk.ma, 210.3);
  assert.equal(body.fix.wh, 1.06);
  assert.ok(Math.abs(body.gain_w - 13.8) < 1e-9);
  assert.equal(body.sun.az, 185.2);
  assert.equal(body.servo.el, 150.9);
  assert.equal(body.last_record_at, '2026-11-09T11:45:00Z');
});

test('status returns null measurements for an unknown device', async (t) => {
  const baseUrl = await startServer(t, {
    async query() {
      return {
        rows: [{
          cihaz_id: null,
          online: false,
          last_record_at: null,
          zaman: null,
          gece_modu: null,
          calisma_suresi_saniye: null,
          acilis_sayaci: null,
          enerji_wh: null,
          guc_w: null,
          gerilim_v: null,
          akim_ma: null,
          fix_wh: null,
          fix_guc_w: null,
          fix_v: null,
          fix_ma: null,
          gunes_azimut_derece: null,
          gunes_yukseklik_derece: null,
          servo_azimut_derece: null,
          servo_yukseklik_derece: null,
        }],
      };
    },
  });
  const response = await fetch(
    `${baseUrl}/api/dashboard/status?device_id=missing`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.online, false);
  assert.equal(body.last_record_at, null);
  assert.equal(body.night, null);
  assert.equal(body.trk, null);
  assert.equal(body.fix, null);
  assert.equal(body.gain_percent, null);
});

test('lists devices and returns data health days and gaps', async (t) => {
  const baseUrl = await startServer(t, {
    async query(sql) {
      if (sql.includes('DISTINCT ON')) {
        return {
          rows: [{
            device_id: 'panel-01',
            online: false,
            last_record_at: '2026-11-09T11:45:00Z',
            last_boot: 4,
            last_seq: 1523,
          }],
        };
      }
      return {
        rows: [{
          days: [{
            date: '2026-11-07',
            records: 602,
            expected: 1440,
            coverage_percent: 41.8,
            ts_unknown: 0,
            boots: [4],
          }],
          gaps: [{
            from: '2026-11-05T22:10:00Z',
            to: '2026-11-06T05:03:00Z',
            missing_minutes: 412,
          }],
        }],
      };
    },
  });

  const devicesResponse = await fetch(`${baseUrl}/api/devices`);
  assert.deepEqual(await devicesResponse.json(), [{
    device_id: 'panel-01',
    online: false,
    last_record_at: '2026-11-09T11:45:00Z',
    last_boot: 4,
    last_seq: 1523,
  }]);
  const healthResponse = await fetch(
    `${baseUrl}/api/dashboard/health?device_id=panel-01&from=2026-11-05&to=2026-11-07`,
  );
  const health = await healthResponse.json();
  assert.equal(health.days[0].expected, 1440);
  assert.equal(health.gaps[0].missing_minutes, 412);
});

test('rejects invalid date ranges and interval values', async (t) => {
  let queried = false;
  const baseUrl = await startServer(t, {
    async query() {
      queried = true;
      return { rows: [] };
    },
  });

  const invalidDaily = await fetch(
    `${baseUrl}/api/dashboard/daily?device_id=panel-01&from=2026-02-30&to=2026-03-01`,
  );
  const invalidInterval = await fetch(
    `${baseUrl}/api/dashboard/series?device_id=panel-01&date=2026-11-09&interval=0`,
  );
  assert.equal(invalidDaily.status, 400);
  assert.equal(invalidInterval.status, 400);
  assert.equal(queried, false);
});
