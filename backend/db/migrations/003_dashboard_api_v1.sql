BEGIN;

ALTER TABLE takipli_panel_kayitlari
    ALTER COLUMN gerilim_v DROP NOT NULL,
    ALTER COLUMN servo_azimut_derece DROP NOT NULL,
    ALTER COLUMN servo_yukseklik_derece DROP NOT NULL,
    ALTER COLUMN gunes_azimut_derece DROP NOT NULL;

ALTER TABLE sabit_panel_kayitlari
    ALTER COLUMN gerilim_v DROP NOT NULL;

ALTER TABLE takipli_panel_kayitlari
    RENAME COLUMN akim_a TO akim_ma;
UPDATE takipli_panel_kayitlari SET akim_ma = akim_ma * 1000;
ALTER TABLE takipli_panel_kayitlari
    ALTER COLUMN akim_ma DROP NOT NULL;

ALTER TABLE sabit_panel_kayitlari
    RENAME COLUMN akim_a TO akim_ma;
UPDATE sabit_panel_kayitlari SET akim_ma = akim_ma * 1000;
ALTER TABLE sabit_panel_kayitlari
    ALTER COLUMN akim_ma DROP NOT NULL;

COMMIT;
