BEGIN;

ALTER TABLE takipli_panel_kayitlari
    RENAME COLUMN servo_1_acisi_derece TO servo_azimut_derece;
ALTER TABLE takipli_panel_kayitlari
    RENAME COLUMN servo_2_acisi_derece TO servo_yukseklik_derece;
ALTER TABLE takipli_panel_kayitlari
    RENAME COLUMN gunes_acisi_derece TO gunes_azimut_derece;

ALTER TABLE takipli_panel_kayitlari
    ADD COLUMN gunes_yukseklik_derece real,
    ADD COLUMN calisma_suresi_saniye bigint CHECK (calisma_suresi_saniye >= 0),
    ADD COLUMN alindi_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE sabit_panel_kayitlari
    ADD COLUMN alindi_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS takipli_panel_cihaz_alindi_idx
    ON takipli_panel_kayitlari (cihaz_id, alindi_at DESC);
CREATE INDEX IF NOT EXISTS sabit_panel_cihaz_alindi_idx
    ON sabit_panel_kayitlari (cihaz_id, alindi_at DESC);

COMMIT;
