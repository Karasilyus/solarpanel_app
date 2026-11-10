const SMALLINT_MAX = 32767;

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function canonicalRecord(record) {
  return {
    ...record,
    cihaz_id: record.cihaz_id ?? record.device_id,
    acilis_sayaci: record.acilis_sayaci ?? record.boot,
    kayit_sira_no: record.kayit_sira_no ?? record.seq,
    zaman_saniye: record.zaman_saniye ?? record.ts,
    gece_modu: record.gece_modu ?? record.night,
    olcum_sayisi: record.olcum_sayisi ?? record.n,
    takipli_gecerli_olcum_sayisi:
      record.takipli_gecerli_olcum_sayisi ?? record.trk_ok,
    sabit_gecerli_olcum_sayisi:
      record.sabit_gecerli_olcum_sayisi ?? record.fix_ok,
    calisma_suresi_saniye: record.calisma_suresi_saniye ?? record.uptime_s,
    servo_azimut_derece: record.servo_azimut_derece ?? record.servo_az,
    servo_yukseklik_derece: record.servo_yukseklik_derece ?? record.servo_el,
    gunes_azimut_derece: record.gunes_azimut_derece ?? record.sun_az,
    gunes_yukseklik_derece: record.gunes_yukseklik_derece ?? record.sun_el,
    takipli_panel: record.takipli_panel ?? {
      wh: record.trk_wh,
      power_w: record.trk_power_w,
      v: record.trk_v,
      ma: record.trk_ma,
    },
    sabit_panel: record.sabit_panel ?? {
      wh: record.fix_wh,
      power_w: record.fix_power_w,
      v: record.fix_v,
      ma: record.fix_ma,
    },
  };
}

function normalizePanel(panel, prefix) {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) {
    throw new TypeError(`${prefix} must be an object`);
  }

  const energy = panel.enerji_wh ?? panel.wh;
  if (typeof energy !== 'number' || !Number.isFinite(energy) || energy < 0) {
    throw new TypeError(`${prefix}.enerji_wh must be a non-negative finite number`);
  }
  const power = panel.guc_w ?? panel.power_w ?? energy * 60;
  if (typeof power !== 'number' || !Number.isFinite(power) || power < 0) {
    throw new TypeError(`${prefix}.guc_w must be a non-negative finite number`);
  }
  const maxPower = panel.max_guc_w ?? power;
  const minPower = panel.min_guc_w ?? power;
  if (
    typeof maxPower !== 'number' ||
    !Number.isFinite(maxPower) ||
    maxPower < 0 ||
    typeof minPower !== 'number' ||
    !Number.isFinite(minPower) ||
    minPower < 0 ||
    minPower > maxPower
  ) {
    throw new TypeError(`${prefix}.min_guc_w and max_guc_w are invalid`);
  }

  const voltage = panel.gerilim_v ?? panel.v ?? null;
  if (voltage !== null &&
      (typeof voltage !== 'number' || !Number.isFinite(voltage) || voltage < 0)) {
    throw new TypeError(`${prefix}.gerilim_v must be a non-negative finite number or null`);
  }

  let current = panel.akim_ma ?? panel.ma ?? null;
  if (current === null && panel.akim_a !== undefined) current = panel.akim_a * 1000;
  if (current !== null &&
      (typeof current !== 'number' || !Number.isFinite(current) || current < 0)) {
    throw new TypeError(`${prefix}.akim_ma must be a non-negative finite number or null`);
  }

  return {
    enerji_wh: energy,
    guc_w: power,
    max_guc_w: maxPower,
    min_guc_w: minPower,
    gerilim_v: voltage,
    akim_ma: current,
  };
}

function normalizeRecord(inputRecord, index) {
  if (!inputRecord || typeof inputRecord !== 'object' || Array.isArray(inputRecord)) {
    throw new TypeError(`records[${index}] must be an object`);
  }
  const record = canonicalRecord(inputRecord);
  const prefix = `records[${index}]`;

  if (typeof record.cihaz_id !== 'string' || record.cihaz_id.trim() === '') {
    throw new TypeError(`${prefix}.device_id must be a non-empty string`);
  }
  if (!isIntegerInRange(record.acilis_sayaci, 0, 2147483647)) {
    throw new TypeError(`${prefix}.boot must be a non-negative 32-bit integer`);
  }
  if (!Number.isSafeInteger(record.kayit_sira_no) || record.kayit_sira_no < 0) {
    throw new TypeError(`${prefix}.seq must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(record.zaman_saniye) || record.zaman_saniye < 0) {
    throw new TypeError(`${prefix}.ts must be Unix epoch seconds or 0`);
  }
  if (
    record.zaman_saniye > 0 &&
    !Number.isFinite(new Date(record.zaman_saniye * 1000).getTime())
  ) {
    throw new TypeError(`${prefix}.ts is outside the supported timestamp range`);
  }
  if (typeof record.gece_modu !== 'boolean') {
    throw new TypeError(`${prefix}.night must be a boolean`);
  }
  if (!isIntegerInRange(record.olcum_sayisi, 0, SMALLINT_MAX)) {
    throw new TypeError(`${prefix}.n must be a non-negative smallint`);
  }
  for (const [field, value] of [
    ['trk_ok', record.takipli_gecerli_olcum_sayisi],
    ['fix_ok', record.sabit_gecerli_olcum_sayisi],
  ]) {
    if (!isIntegerInRange(value, 0, record.olcum_sayisi)) {
      throw new TypeError(`${prefix}.${field} must be between 0 and n`);
    }
  }

  for (const field of [
    'servo_azimut_derece',
    'servo_yukseklik_derece',
    'gunes_azimut_derece',
    'gunes_yukseklik_derece',
  ]) {
    const value = record[field];
    if (value !== null && value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError(`${prefix}.${field} must be a finite number or null`);
    }
  }
  const uptime = record.calisma_suresi_saniye ?? null;
  if (uptime !== null && (!Number.isSafeInteger(uptime) || uptime < 0)) {
    throw new TypeError(`${prefix}.uptime_s must be a non-negative integer or null`);
  }

  return {
    ortak: [
      record.cihaz_id.trim(),
      record.acilis_sayaci,
      record.kayit_sira_no,
      record.zaman_saniye === 0 ? null : new Date(record.zaman_saniye * 1000),
      record.gece_modu,
      record.olcum_sayisi,
      uptime,
    ],
    takipli: {
      gecerli_olcum_sayisi: record.takipli_gecerli_olcum_sayisi,
      ...normalizePanel(record.takipli_panel, `${prefix}.trk`),
      servo_azimut_derece: record.servo_azimut_derece ?? null,
      servo_yukseklik_derece: record.servo_yukseklik_derece ?? null,
      gunes_azimut_derece: record.gunes_azimut_derece ?? null,
      gunes_yukseklik_derece: record.gunes_yukseklik_derece ?? null,
    },
    sabit: {
      gecerli_olcum_sayisi: record.sabit_gecerli_olcum_sayisi,
      ...normalizePanel(record.sabit_panel, `${prefix}.fix`),
    },
  };
}

function normalizeBatch(body) {
  if (!Array.isArray(body) || body.length === 0 || body.length > 20) {
    throw new TypeError('Request body must be an array containing 1 to 20 records');
  }
  const records = body.map(normalizeRecord);
  const keys = new Set();
  for (const record of records) {
    const key = `${record.ortak[0]}\u0000${record.ortak[1]}\u0000${record.ortak[2]}`;
    if (keys.has(key)) {
      throw new TypeError('Batch contains duplicate device_id, boot, and sequence keys');
    }
    keys.add(key);
  }
  return records;
}

module.exports = { normalizeBatch };
