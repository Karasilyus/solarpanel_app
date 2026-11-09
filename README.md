# Solar panel backend

## Database

Apply `db/schema.sql` to the PostgreSQL database before starting the API. The
backend uses one pooled PostgreSQL connection pool and the `minute_records`
table.

## Run

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

## API

### `POST /api/records`

Send a JSON array with 1–20 records. A record contains:

```json
{
  "device_id": "panel-01",
  "boot": 3,
  "seq": 142,
  "ts": 1794268800,
  "night": false,
  "n": 5,
  "trk_ok": 5,
  "fix_ok": 5,
  "trk_wh": 0.42,
  "fix_wh": 0.31,
  "angle_deg": 18.5
}
```

`ts` is Unix epoch time in seconds; `0` is stored as SQL `NULL`. Duplicate
`(device_id, boot, seq)` records are ignored. A successful response is HTTP 200
and includes `received`, `inserted`, and `duplicates`. Invalid records fail
before insertion; a database failure rolls back the complete batch and returns
HTTP 500 so the device can retry.

### `GET /api/dashboard/daily?device_id=panel-01&date=2026-11-09`

Returns daily `trk_wh`/`fix_wh` totals, tracker gain and complete-minute count.
The date boundary uses `Europe/Istanbul`; only records with `trk_ok = n`,
`fix_ok = n`, a known timestamp, and `night = false` contribute to the energy
totals.

### `GET /api/dashboard/status?device_id=panel-01`

Returns the latest record's `night` value and timestamp separately from energy
calculations. `night` and `ts` are `null` when the device has no records.

### `GET /healthz`

Checks database connectivity.
