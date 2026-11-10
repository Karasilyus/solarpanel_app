BEGIN;

DROP TABLE IF EXISTS minute_records;

CREATE TABLE IF NOT EXISTS takipli_panel_kayitlari (
    cihaz_id text NOT NULL,
    acilis_sayaci integer NOT NULL CHECK (acilis_sayaci >= 0),
    kayit_sira_no bigint NOT NULL CHECK (kayit_sira_no >= 0),
    zaman timestamptz,
    gece_modu boolean NOT NULL,
    olcum_sayisi smallint NOT NULL CHECK (olcum_sayisi >= 0),
    gecerli_olcum_sayisi smallint NOT NULL CHECK (gecerli_olcum_sayisi >= 0),
    enerji_wh real NOT NULL CHECK (enerji_wh >= 0),
    guc_w real NOT NULL CHECK (guc_w >= 0),
    max_guc_w real NOT NULL CHECK (max_guc_w >= 0),
    min_guc_w real NOT NULL CHECK (min_guc_w >= 0),
    gerilim_v real NOT NULL CHECK (gerilim_v >= 0),
    akim_a real NOT NULL CHECK (akim_a >= 0),
    servo_1_acisi_derece real NOT NULL,
    servo_2_acisi_derece real NOT NULL,
    gunes_acisi_derece real NOT NULL,
    CHECK (gecerli_olcum_sayisi <= olcum_sayisi),
    CHECK (min_guc_w <= max_guc_w),
    PRIMARY KEY (cihaz_id, acilis_sayaci, kayit_sira_no)
);

CREATE INDEX IF NOT EXISTS takipli_panel_cihaz_zaman_idx
    ON takipli_panel_kayitlari (cihaz_id, zaman DESC);

CREATE TABLE IF NOT EXISTS sabit_panel_kayitlari (
    cihaz_id text NOT NULL,
    acilis_sayaci integer NOT NULL CHECK (acilis_sayaci >= 0),
    kayit_sira_no bigint NOT NULL CHECK (kayit_sira_no >= 0),
    zaman timestamptz,
    gece_modu boolean NOT NULL,
    olcum_sayisi smallint NOT NULL CHECK (olcum_sayisi >= 0),
    gecerli_olcum_sayisi smallint NOT NULL CHECK (gecerli_olcum_sayisi >= 0),
    enerji_wh real NOT NULL CHECK (enerji_wh >= 0),
    guc_w real NOT NULL CHECK (guc_w >= 0),
    max_guc_w real NOT NULL CHECK (max_guc_w >= 0),
    min_guc_w real NOT NULL CHECK (min_guc_w >= 0),
    gerilim_v real NOT NULL CHECK (gerilim_v >= 0),
    akim_a real NOT NULL CHECK (akim_a >= 0),
    CHECK (gecerli_olcum_sayisi <= olcum_sayisi),
    CHECK (min_guc_w <= max_guc_w),
    PRIMARY KEY (cihaz_id, acilis_sayaci, kayit_sira_no)
);

CREATE INDEX IF NOT EXISTS sabit_panel_cihaz_zaman_idx
    ON sabit_panel_kayitlari (cihaz_id, zaman DESC);

COMMIT;
