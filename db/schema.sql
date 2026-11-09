CREATE TABLE IF NOT EXISTS minute_records (
    device_id text NOT NULL,
    boot integer NOT NULL CHECK (boot >= 0),
    seq bigint NOT NULL CHECK (seq >= 0),
    ts timestamptz,
    night boolean NOT NULL,
    n smallint NOT NULL CHECK (n >= 0),
    trk_ok smallint NOT NULL CHECK (trk_ok >= 0),
    fix_ok smallint NOT NULL CHECK (fix_ok >= 0),
    trk_wh real NOT NULL CHECK (trk_wh >= 0),
    fix_wh real NOT NULL CHECK (fix_wh >= 0),
    angle_deg real NOT NULL,
    CHECK (trk_ok <= n),
    CHECK (fix_ok <= n),
    PRIMARY KEY (device_id, boot, seq)
);

CREATE INDEX IF NOT EXISTS minute_records_device_ts_idx
    ON minute_records (device_id, ts DESC);
