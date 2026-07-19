/**
 * Выбор стратегии импорта: per-row FTS vs bulk (триггеры off + rebuild в конце).
 * Малый инкремент — точечные обновления FTS; крупный — как при полной переиндексации.
 */

function readBoundedInt(envName, fallback, min, max) {
  const raw = Number.parseInt(String(process.env[envName] ?? ''), 10);
  const n = Number.isFinite(raw) ? raw : fallback;
  return Math.max(min, Math.min(max, n));
}

function readBoundedRatio(envName, fallback) {
  const raw = Number.parseFloat(String(process.env[envName] ?? ''));
  const n = Number.isFinite(raw) ? raw : fallback;
  return Math.max(0.01, Math.min(1, n));
}

/**
 * @param {{ incremental?: boolean, toProcess?: number, total?: number }} opts
 * @returns {{ ftsBulkMode: boolean, useFastSqlite: boolean, incrementalBulk: boolean }}
 */
export function resolveIndexImportMode({ incremental = false, toProcess = 0, total = 0 } = {}) {
  const n = Math.max(0, Math.floor(Number(toProcess) || 0));
  const t = Math.max(0, Math.floor(Number(total) || 0));

  if (n <= 0) {
    return { ftsBulkMode: false, useFastSqlite: false, incrementalBulk: false };
  }

  if (!incremental) {
    return { ftsBulkMode: true, useFastSqlite: true, incrementalBulk: false };
  }

  const minRatio = readBoundedRatio('INDEX_INCREMENTAL_BULK_RATIO', 0.12);
  const minItems = readBoundedInt('INDEX_INCREMENTAL_BULK_MIN', 2, 1, 10_000);
  const ratio = t > 0 ? n / t : 0;
  const incrementalBulk = n >= minItems && ratio >= minRatio;

  return {
    ftsBulkMode: incrementalBulk,
    useFastSqlite: true,
    incrementalBulk
  };
}
