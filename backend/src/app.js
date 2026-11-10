const cors = require('cors');
const express = require('express');
const { normalizeBatch } = require('./records');

const COMMON_COLUMNS = [
  'cihaz_id',
  'acilis_sayaci',
  'kayit_sira_no',
  'zaman',
  'gece_modu',
  'olcum_sayisi',
];
const PANEL_COLUMNS = [
  'gecerli_olcum_sayisi',
  'enerji_wh',
  'guc_w',
  'max_guc_w',
  'min_guc_w',
  'gerilim_v',
  'akim_ma',
];
const TRACKER_COLUMNS = [
  ...COMMON_COLUMNS,
  'calisma_suresi_saniye',
  ...PANEL_COLUMNS,
  'servo_azimut_derece',
  'servo_yukseklik_derece',
  'gunes_azimut_derece',
  'gunes_yukseklik_derece',
];
const FIXED_COLUMNS = [...COMMON_COLUMNS, ...PANEL_COLUMNS];
const DAY_LIMIT = 366;
const DEFAULT_ONLINE_THRESHOLD_SECONDS = 180;

function insertStatement(table, columns, recordCount) {
  const placeholders = [];
  let parameter = 1;

  for (let row = 0; row < recordCount; row += 1) {
    placeholders.push(`(${columns.map(() => `$${parameter++}`).join(', ')})`);
  }

  return `INSERT INTO ${table} (${columns.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (cihaz_id, acilis_sayaci, kayit_sira_no)
    DO UPDATE SET alindi_at = clock_timestamp()
    RETURNING (xmax = '0'::xid) AS yeni_kayit`;
}

function trackerValues(record) {
  return [
    ...record.ortak.slice(0, 6),
    record.ortak[6],
    record.takipli.gecerli_olcum_sayisi,
    record.takipli.enerji_wh,
    record.takipli.guc_w,
    record.takipli.max_guc_w,
    record.takipli.min_guc_w,
    record.takipli.gerilim_v,
    record.takipli.akim_ma,
    record.takipli.servo_azimut_derece,
    record.takipli.servo_yukseklik_derece,
    record.takipli.gunes_azimut_derece,
    record.takipli.gunes_yukseklik_derece,
  ];
}

function fixedValues(record) {
  return [
    ...record.ortak.slice(0, 6),
    record.sabit.gecerli_olcum_sayisi,
    record.sabit.enerji_wh,
    record.sabit.guc_w,
    record.sabit.max_guc_w,
    record.sabit.min_guc_w,
    record.sabit.gerilim_v,
    record.sabit.akim_ma,
  ];
}

function isValidDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function readDeviceId(req, res) {
  const deviceId = req.query.device_id ?? req.query.cihaz_id;
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    res.status(400).json({ hata: 'device_id query parametresi zorunludur' });
    return null;
  }
  return deviceId.trim();
}

function readDateRange(req, res, singleDate = false) {
  const from = singleDate
    ? req.query.date ?? req.query.tarih
    : req.query.from ?? req.query.tarih;
  const to = singleDate ? from : req.query.to ?? req.query.tarih;
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    res.status(400).json({
      hata: singleDate
        ? 'date YYYY-MM-DD biciminde gecerli bir tarih olmalidir'
        : 'from ve to gecerli YYYY-MM-DD tarihleri olmali',
    });
    return null;
  }
  const dayCount = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
    / 86400000 + 1;
  if (dayCount > DAY_LIMIT) {
    res.status(400).json({ hata: `Tarih araligi en fazla ${DAY_LIMIT} gun olabilir` });
    return null;
  }
  return { from, to };
}

function createApp(
  pool,
  allowedOrigins = process.env.CORS_ORIGIN || '*',
  onlineThresholdSeconds = Number(
    process.env.ONLINE_THRESHOLD_SECONDS || DEFAULT_ONLINE_THRESHOLD_SECONDS,
  ),
) {
  if (!Number.isInteger(onlineThresholdSeconds) || onlineThresholdSeconds <= 0) {
    throw new TypeError('ONLINE_THRESHOLD_SECONDS must be a positive integer');
  }
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
    let records;
    try {
      records = normalizeBatch(req.body);
    } catch (error) {
      res.status(400).json({ hata: error.message });
      return;
    }

    let client;
    let transactionStarted = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      transactionStarted = true;

      const trackerResult = await client.query(
        insertStatement('takipli_panel_kayitlari', TRACKER_COLUMNS, records.length),
        records.flatMap(trackerValues),
      );
      const fixedResult = await client.query(
        insertStatement('sabit_panel_kayitlari', FIXED_COLUMNS, records.length),
        records.flatMap(fixedValues),
      );
      const trackerInserted = trackerResult.rows.filter((row) => row.yeni_kayit).length;
      const fixedInserted = fixedResult.rows.filter((row) => row.yeni_kayit).length;
      if (trackerInserted !== fixedInserted) {
        throw new Error('Panel record tables are inconsistent for this batch');
      }

      await client.query('COMMIT');
      transactionStarted = false;
      res.status(200).json({
        alinan: records.length,
        eklenen: trackerInserted,
        mukerrer: records.length - trackerInserted,
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
      res.status(500).json({ hata: 'Kayit paketi veritabanina yazilamadi' });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/dashboard/series', async (req, res) => {
    const deviceId = readDeviceId(req, res);
    if (!deviceId) return;
    const range = readDateRange(req, res, true);
    if (!range) return;
    const intervalMinutes = req.query.interval === undefined ? 1 : Number(req.query.interval);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
      res.status(400).json({ hata: 'interval 1 ile 60 arasinda dakika olmali' });
      return;
    }

    try {
      const result = await pool.query(
        `WITH ham AS (
           SELECT
             tp.zaman AS ts,
             tp.gece_modu AS night,
             tp.olcum_sayisi AS n,
             tp.gecerli_olcum_sayisi AS trk_ok,
             sp.gecerli_olcum_sayisi AS fix_ok,
             tp.enerji_wh AS trk_wh,
             sp.enerji_wh AS fix_wh,
             tp.gerilim_v AS trk_v,
             tp.akim_ma AS trk_ma,
             sp.gerilim_v AS fix_v,
             sp.akim_ma AS fix_ma,
             tp.gunes_azimut_derece AS sun_az,
             tp.gunes_yukseklik_derece AS sun_el,
             tp.servo_azimut_derece AS servo_az,
             tp.servo_yukseklik_derece AS servo_el,
             row_number() OVER (
               PARTITION BY floor(
                 extract(epoch FROM (
                   tp.zaman - ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul')
                 )) / 60 / $3
               )
               ORDER BY tp.zaman, tp.acilis_sayaci, tp.kayit_sira_no
             ) AS bucket_row,
             SUM(tp.enerji_wh) OVER (
               ORDER BY tp.zaman, tp.acilis_sayaci, tp.kayit_sira_no
             ) AS trk_cumulative_wh,
             SUM(sp.enerji_wh) OVER (
               ORDER BY tp.zaman, tp.acilis_sayaci, tp.kayit_sira_no
             ) AS fix_cumulative_wh
           FROM takipli_panel_kayitlari tp
           INNER JOIN sabit_panel_kayitlari sp
             ON sp.cihaz_id = tp.cihaz_id
             AND sp.acilis_sayaci = tp.acilis_sayaci
             AND sp.kayit_sira_no = tp.kayit_sira_no
           WHERE tp.cihaz_id = $1
             AND tp.zaman >= ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul')
             AND tp.zaman < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
         )
         SELECT ts, night, n, trk_ok, fix_ok, trk_wh, fix_wh,
                trk_v, trk_ma, fix_v, fix_ma, sun_az, sun_el, servo_az, servo_el,
                trk_cumulative_wh, fix_cumulative_wh
         FROM ham
         WHERE bucket_row = 1
         ORDER BY ts`,
        [deviceId, range.from, intervalMinutes],
      );

      res.status(200).json({
        device_id: deviceId,
        date: range.from,
        timezone: 'Europe/Istanbul',
        points: result.rows,
      });
    } catch (error) {
      console.error('Failed to fetch daily series:', error);
      res.status(500).json({ hata: 'Gun ici seri alinamadi' });
    }
  });

  app.get('/api/dashboard/daily', async (req, res) => {
    const deviceId = readDeviceId(req, res);
    if (!deviceId) return;
    const range = readDateRange(req, res);
    if (!range) return;

    try {
      const result = await pool.query(
        `WITH eslesmis AS (
           SELECT tp.zaman, tp.gece_modu, tp.olcum_sayisi,
                  tp.gecerli_olcum_sayisi AS trk_ok,
                  sp.gecerli_olcum_sayisi AS fix_ok,
                  tp.enerji_wh AS trk_wh, sp.enerji_wh AS fix_wh,
                  tp.max_guc_w AS trk_peak_w, sp.max_guc_w AS fix_peak_w
           FROM takipli_panel_kayitlari tp
           INNER JOIN sabit_panel_kayitlari sp
             ON sp.cihaz_id = tp.cihaz_id
             AND sp.acilis_sayaci = tp.acilis_sayaci
             AND sp.kayit_sira_no = tp.kayit_sira_no
           WHERE tp.cihaz_id = $1
             AND tp.zaman >= ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul')
             AND tp.zaman < (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
         ),
         gunluk AS (
           SELECT
             (zaman AT TIME ZONE 'Europe/Istanbul')::date AS gun,
             COUNT(*) FILTER (
               WHERE trk_ok = olcum_sayisi AND fix_ok = olcum_sayisi
             )::integer AS complete_minutes,
             COUNT(*)::integer AS total_minutes,
             COALESCE(SUM(trk_wh) FILTER (
               WHERE NOT gece_modu AND trk_ok = olcum_sayisi AND fix_ok = olcum_sayisi
             ), 0)::double precision AS trk_wh,
             COALESCE(SUM(fix_wh) FILTER (
               WHERE NOT gece_modu AND trk_ok = olcum_sayisi AND fix_ok = olcum_sayisi
             ), 0)::double precision AS fix_wh,
             MAX(trk_peak_w) FILTER (
               WHERE NOT gece_modu AND trk_ok = olcum_sayisi AND fix_ok = olcum_sayisi
             ) AS trk_peak_w,
             MAX(fix_peak_w) FILTER (
               WHERE NOT gece_modu AND trk_ok = olcum_sayisi AND fix_ok = olcum_sayisi
             ) AS fix_peak_w
           FROM eslesmis
           WHERE zaman IS NOT NULL
           GROUP BY (zaman AT TIME ZONE 'Europe/Istanbul')::date
         )
         SELECT
           to_char(gun, 'YYYY-MM-DD') AS date,
           trk_wh,
           fix_wh,
           trk_wh - fix_wh AS gain_wh,
           CASE WHEN fix_wh = 0 THEN NULL ELSE (trk_wh - fix_wh) / fix_wh * 100 END
             AS gain_percent,
           trk_peak_w,
           fix_peak_w,
           complete_minutes,
           total_minutes,
           CASE WHEN total_minutes = 0 THEN 0
                ELSE complete_minutes::double precision / total_minutes * 100
           END AS coverage_percent
         FROM gunluk
         ORDER BY gun`,
        [deviceId, range.from, range.to],
      );

      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Failed to fetch daily dashboard data:', error);
      res.status(500).json({ hata: 'Gunluk pano verisi alinamadi' });
    }
  });

  const statusHandler = async (req, res) => {
    const deviceId = readDeviceId(req, res);
    if (!deviceId) return;

    try {
      const result = await pool.query(
        `WITH son_kayit AS (
           SELECT tp.*, sp.enerji_wh AS fix_wh, sp.guc_w AS fix_guc_w,
                  sp.gerilim_v AS fix_v, sp.akim_ma AS fix_ma
           FROM takipli_panel_kayitlari tp
           INNER JOIN sabit_panel_kayitlari sp
             ON sp.cihaz_id = tp.cihaz_id
             AND sp.acilis_sayaci = tp.acilis_sayaci
             AND sp.kayit_sira_no = tp.kayit_sira_no
           WHERE tp.cihaz_id = $1
           ORDER BY tp.acilis_sayaci DESC, tp.kayit_sira_no DESC
           LIMIT 1
         ),
         son_alim AS (
           SELECT MAX(alindi_at) AS alindi_at
           FROM takipli_panel_kayitlari
           WHERE cihaz_id = $1
         )
         SELECT son_kayit.*, son_alim.alindi_at AS last_record_at,
                COALESCE(
                  son_alim.alindi_at > now() - ($2 * interval '1 second'),
                  false
                ) AS online
         FROM son_alim
         LEFT JOIN son_kayit ON true`,
        [deviceId, onlineThresholdSeconds],
      );
      const row = result.rows[0];
      const exists = row.cihaz_id !== null;
      const trkPower = exists ? row.enerji_wh * 60 : null;
      const fixPower = exists ? row.fix_wh * 60 : null;
      const gainW = trkPower === null ? null : trkPower - fixPower;

      res.status(200).json({
        device_id: deviceId,
        online: row.online,
        last_record_at: row.last_record_at,
        ts: exists ? row.zaman : null,
        night: exists ? row.gece_modu : null,
        uptime_s: exists ? row.calisma_suresi_saniye : null,
        boot: exists ? row.acilis_sayaci : null,
        trk: exists
          ? {
            power_w: trkPower,
            v: row.gerilim_v,
            ma: row.akim_ma,
            wh: row.enerji_wh,
          }
          : null,
        fix: exists
          ? {
            power_w: fixPower,
            v: row.fix_v,
            ma: row.fix_ma,
            wh: row.fix_wh,
          }
          : null,
        gain_w: gainW,
        gain_percent: fixPower === null || fixPower === 0
          ? null
          : gainW / fixPower * 100,
        sun: exists
          ? { az: row.gunes_azimut_derece, el: row.gunes_yukseklik_derece }
          : null,
        servo: exists
          ? { az: row.servo_azimut_derece, el: row.servo_yukseklik_derece }
          : null,
      });
    } catch (error) {
      console.error('Failed to fetch device status:', error);
      res.status(500).json({ hata: 'Cihaz durumu alinamadi' });
    }
  };
  app.get('/api/dashboard/status', statusHandler);
  app.get('/api/dashboard/latest', statusHandler);

  app.get('/api/devices', async (req, res) => {
    try {
      const result = await pool.query(
        `WITH son_kayit AS (
           SELECT DISTINCT ON (cihaz_id)
             cihaz_id, acilis_sayaci, kayit_sira_no, alindi_at
           FROM takipli_panel_kayitlari
           ORDER BY cihaz_id, alindi_at DESC, acilis_sayaci DESC, kayit_sira_no DESC
         )
         SELECT cihaz_id AS device_id,
                COALESCE(alindi_at > now() - ($1 * interval '1 second'), false) AS online,
                alindi_at AS last_record_at,
                acilis_sayaci AS last_boot,
                kayit_sira_no AS last_seq
         FROM son_kayit
         ORDER BY cihaz_id`,
        [onlineThresholdSeconds],
      );
      res.status(200).json(result.rows);
    } catch (error) {
      console.error('Failed to list devices:', error);
      res.status(500).json({ hata: 'Cihaz listesi alinamadi' });
    }
  });

  app.get('/api/dashboard/health', async (req, res) => {
    const deviceId = readDeviceId(req, res);
    if (!deviceId) return;
    const range = readDateRange(req, res);
    if (!range) return;

    try {
      const result = await pool.query(
        `WITH params AS (
           SELECT
             ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul') AS baslangic,
             (($3::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul') AS bitis
         ),
         kayitlar AS (
           SELECT tp.acilis_sayaci, tp.kayit_sira_no, tp.zaman, tp.alindi_at
           FROM takipli_panel_kayitlari tp
           WHERE tp.cihaz_id = $1
         ),
         gunluk AS (
           SELECT
             COALESCE(
               (zaman AT TIME ZONE 'Europe/Istanbul')::date,
               (alindi_at AT TIME ZONE 'Europe/Istanbul')::date
             ) AS gun,
             COUNT(*) FILTER (WHERE zaman IS NOT NULL)::integer AS records,
             COUNT(*) FILTER (WHERE zaman IS NULL)::integer AS ts_unknown,
             array_agg(DISTINCT acilis_sayaci ORDER BY acilis_sayaci) AS boots
           FROM kayitlar, params
           WHERE (zaman >= baslangic AND zaman < bitis)
              OR (zaman IS NULL AND alindi_at >= baslangic AND alindi_at < bitis)
           GROUP BY 1
         ),
         gunler AS (
           SELECT generate_series($2::date, $3::date, interval '1 day')::date AS gun
         ),
         sirali AS (
           SELECT zaman, lag(zaman) OVER (ORDER BY zaman, acilis_sayaci, kayit_sira_no) AS onceki
           FROM kayitlar
           WHERE zaman IS NOT NULL
         ),
         bosluklar AS (
           SELECT onceki AS gap_from, zaman AS gap_to,
                  floor(extract(epoch FROM (zaman - onceki)) / 60)::integer - 1
                    AS missing_minutes
           FROM sirali, params
           WHERE onceki IS NOT NULL
             AND zaman - onceki > interval '1 minute'
             AND zaman >= baslangic
             AND onceki < bitis
         )
         SELECT
           COALESCE(
             (SELECT json_agg(json_build_object(
               'date', to_char(g.gun, 'YYYY-MM-DD'),
               'records', COALESCE(d.records, 0),
               'expected', 1440,
               'coverage_percent', COALESCE(d.records, 0)::double precision / 1440 * 100,
               'ts_unknown', COALESCE(d.ts_unknown, 0),
               'boots', COALESCE(d.boots, ARRAY[]::integer[])
             ) ORDER BY g.gun)
             FROM gunler g LEFT JOIN gunluk d ON d.gun = g.gun),
             '[]'::json
           ) AS days,
           COALESCE(
             (SELECT json_agg(json_build_object(
               'from', gap_from,
               'to', gap_to,
               'missing_minutes', missing_minutes
             ) ORDER BY gap_from)
             FROM bosluklar),
             '[]'::json
           ) AS gaps`,
        [deviceId, range.from, range.to],
      );

      res.status(200).json({
        device_id: deviceId,
        days: result.rows[0].days,
        gaps: result.rows[0].gaps,
      });
    } catch (error) {
      console.error('Failed to fetch data health:', error);
      res.status(500).json({ hata: 'Veri kalitesi alinamadi' });
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ hata: 'Istek govdesi gecerli JSON olmali' });
      return;
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ hata: 'Istek govdesi cok buyuk' });
      return;
    }
    console.error('Unhandled request error:', error);
    res.status(500).json({ hata: 'Sunucu hatasi' });
  });

  return app;
}

module.exports = { createApp };
