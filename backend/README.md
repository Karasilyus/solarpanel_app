# Solar panel backend

## Database

The database has one row per panel and minute in two tables:

- `takipli_panel_kayitlari`: moving/tracking panel, including both servo angles
  and sun azimuth/elevation.
- `sabit_panel_kayitlari`: fixed panel.

Both tables use `(cihaz_id, acilis_sayaci, kayit_sira_no)` as their primary key.
Apply `db/schema.sql` to a new database. For an existing two-table database,
run `db/migrations/002_dashboard_latest_series.sql` and then
`db/migrations/003_dashboard_api_v1.sql` once. For the original
`minute_records` database, first run `db/migrations/001_split_panel_tables.sql`
once, then migrations 002 and 003. Migration 001 drops `minute_records`; back up
any data you want to keep first. Migration 003 converts stored panel current
from amperes to milliamperes.

## Run without Docker

Use Node.js 20 or newer:

```sh
npm install
cp .env.example .env
npm start
```

Set either `DATABASE_URL` or the standard `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, and `PGPASSWORD` variables. `PORT` defaults to `3000`.
`CORS_ORIGIN` defaults to `*`; set it to a comma-separated origin allowlist
for deployment.

## Device payload

### `POST /api/records`

Send a JSON array with 1–20 minute records:

```json
{
  "cihaz_id": "panel-01",
  "acilis_sayaci": 3,
  "kayit_sira_no": 142,
  "zaman_saniye": 1794268800,
  "gece_modu": false,
  "olcum_sayisi": 5,
  "takipli_gecerli_olcum_sayisi": 5,
  "sabit_gecerli_olcum_sayisi": 5,
  "calisma_suresi_saniye": 86400,
  "servo_azimut_derece": 15,
  "servo_yukseklik_derece": 35,
  "gunes_azimut_derece": 22,
  "gunes_yukseklik_derece": 48,
  "takipli_panel": {
    "enerji_wh": 0.42,
    "guc_w": 25,
    "max_guc_w": 28,
    "min_guc_w": 21,
    "gerilim_v": 12.5,
    "akim_a": 2
  },
  "sabit_panel": {
    "enerji_wh": 0.31,
    "guc_w": 18,
    "max_guc_w": 20,
    "min_guc_w": 15,
    "gerilim_v": 12,
    "akim_a": 1.5
  }
}
```

The API accepts the original Turkish payload keys and the ESP/frontend v1 keys
(`device_id`, `boot`, `seq`, `ts`, `night`, `n`, `trk_ok`, `fix_ok`,
`trk_wh`/`fix_wh`, `trk_v`/`trk_ma`, `fix_v`/`fix_ma`, `sun_az`/`sun_el`,
`servo_az`/`servo_el`, `uptime_s`). `ts`/`zaman_saniye` is Unix epoch time in
seconds; `0` is stored as SQL `NULL`.
`calisma_suresi_saniye` is optional and is supplied by the device. `alindi_at`
is assigned by PostgreSQL when the server receives a new record; duplicate
retries refresh this receive time without modifying the measurement values.
Voltage is in V and current in mA on the v1 contract; legacy `akim_a` input is
converted from amperes. New voltage/current/angle fields may be omitted and
will be stored as `NULL` until the device sends them. `enerji_wh` is energy for
the recorded minute; average power defaults to `enerji_wh * 60` when omitted.
Both panel rows are written in one transaction; a database error or
inconsistent duplicate state rolls the whole batch back. HTTP 200 confirms the
device can clear its sent records.

## Dashboard API

All dashboard endpoints accept `device_id` (or legacy `cihaz_id`). Date values
are interpreted in `Europe/Istanbul`.

### `GET /api/dashboard/series?device_id=panel-01&date=2026-11-09&interval=5`

Returns the requested day's paired minute points in the v1 response format.
`interval` is optional and samples one point every 1–60 minutes; it defaults to
1. Timestamps are UTC instants and the day boundary is `Europe/Istanbul`.
Each point contains `ts`, `night`, `n`, `trk_ok`, `fix_ok`, `trk_wh`, `fix_wh`,
`trk_v`, `trk_ma`, `fix_v`, `fix_ma`, `sun_az`, `sun_el`, `servo_az`,
`servo_el`, `trk_cumulative_wh`, and `fix_cumulative_wh`. Not-yet-reported
sensor measurements are `null`.

### `GET /api/dashboard/daily?device_id=panel-01&from=2026-11-01&to=2026-11-09`

Returns an array with data-bearing days in the inclusive range (maximum 366
days): `date`, `trk_wh`, `fix_wh`, `gain_wh`, `gain_percent`, `trk_peak_w`,
`fix_peak_w`, `complete_minutes`, `total_minutes`, and `coverage_percent`.
Energy includes only complete, daytime samples. Coverage is complete samples
divided by all received samples with known timestamps for that day. A
zero-energy fixed panel gives `gain_percent: null`.

### `GET /api/dashboard/status?device_id=panel-01`

Returns the latest sample's `night`, `uptime_s`, `boot`, panel values, gain, sun
azimuth/elevation, servo azimuth/elevation, and online state. `last_record_at`
is server receive time. `online` uses a 180-second threshold by default; change
it with `ONLINE_THRESHOLD_SECONDS`. Missing devices and not-yet-reported sensor
fields are returned as `null`. `/api/dashboard/latest` is an alias.

### `GET /api/devices`

Returns each known `device_id`, online state, last server receive time, boot
counter, and sequence number.

### `GET /api/dashboard/health?device_id=panel-01&from=2026-11-01&to=2026-11-09`

Returns daily record count, expected minutes (1440), coverage, unknown-timestamp
count and observed boot counters, plus timestamp gaps with missing-minute
counts. Unknown timestamps are attributed to the day they reached the server.
The response contains `{ "device_id", "days", "gaps" }`; `days` includes empty
calendar days so missing coverage is visible.

### `GET /healthz`

Checks database connectivity.
