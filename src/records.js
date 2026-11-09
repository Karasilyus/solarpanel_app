const SMALLINT_MAX = 32767;

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function normalizeRecord(record, index) {
  const prefix = `records[${index}]`;

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`${prefix} must be an object`);
  }

  if (typeof record.device_id !== 'string' || record.device_id.trim() === '') {
    throw new TypeError(`${prefix}.device_id must be a non-empty string`);
  }
  if (!isIntegerInRange(record.boot, 0, 2147483647)) {
    throw new TypeError(`${prefix}.boot must be a non-negative 32-bit integer`);
  }
  if (!Number.isSafeInteger(record.seq) || record.seq < 0) {
    throw new TypeError(`${prefix}.seq must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(record.ts) || record.ts < 0) {
    throw new TypeError(`${prefix}.ts must be Unix epoch seconds or 0`);
  }
  if (record.ts > 0 && !Number.isFinite(new Date(record.ts * 1000).getTime())) {
    throw new TypeError(`${prefix}.ts is outside the supported timestamp range`);
  }
  if (typeof record.night !== 'boolean') {
    throw new TypeError(`${prefix}.night must be a boolean`);
  }

  for (const field of ['n', 'trk_ok', 'fix_ok']) {
    if (!isIntegerInRange(record[field], 0, SMALLINT_MAX)) {
      throw new TypeError(`${prefix}.${field} must be a non-negative smallint`);
    }
  }
  if (record.trk_ok > record.n || record.fix_ok > record.n) {
    throw new TypeError(`${prefix}.trk_ok and fix_ok must not exceed n`);
  }

  for (const field of ['trk_wh', 'fix_wh', 'angle_deg']) {
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) {
      throw new TypeError(`${prefix}.${field} must be a finite number`);
    }
  }
  if (record.trk_wh < 0 || record.fix_wh < 0) {
    throw new TypeError(`${prefix}.trk_wh and fix_wh must not be negative`);
  }

  return [
    record.device_id.trim(),
    record.boot,
    record.seq,
    record.ts === 0 ? null : new Date(record.ts * 1000),
    record.night,
    record.n,
    record.trk_ok,
    record.fix_ok,
    record.trk_wh,
    record.fix_wh,
    record.angle_deg,
  ];
}

function normalizeBatch(body) {
  if (!Array.isArray(body) || body.length === 0 || body.length > 20) {
    throw new TypeError('Request body must be an array containing 1 to 20 records');
  }

  return body.map(normalizeRecord);
}

module.exports = { normalizeBatch };
