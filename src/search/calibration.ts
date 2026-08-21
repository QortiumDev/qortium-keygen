// Device calibration: measure the REAL production search path (workers,
// crypto RNG, the user's actual match spec) — warm up first, then time a
// steady window (R4 findings 28-32). Results persist in localStorage with
// enough metadata to know when they are stale.

import { SearchCoordinator, type SearchStats } from './coordinator';
import type { MatchSpec } from './matcher';
import type { BackendReport, SeedMode } from './protocol';

export interface CalibrationResult {
  /** Aggregate candidates/sec across all workers, measured after warmup. */
  rate: number;
  workerCount: number;
  mode: SeedMode;
  backend: BackendReport | null;
  measuredMs: number;
  timestamp: number;
  appVersion: string;
  hardwareConcurrency: number | null;
}

const STORAGE_KEY = 'qortium-keygen.calibration.v1';
export const CALIBRATION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export interface CalibrationOptions {
  mode: SeedMode;
  spec: MatchSpec;
  workerCount: number;
  appVersion: string;
  warmupMs?: number;
  measureMs?: number;
  onProgress?(phase: 'warmup' | 'measuring', stats: SearchStats): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runCalibration(options: CalibrationOptions): Promise<CalibrationResult> {
  const warmupMs = options.warmupMs ?? 2000;
  const measureMs = options.measureMs ?? 5000;
  const coordinator = new SearchCoordinator();
  let backend: BackendReport | null = null;
  let phase: 'warmup' | 'measuring' = 'warmup';
  let error: string | null = null;

  coordinator.start({
    workerCount: options.workerCount,
    mode: options.mode,
    spec: options.spec,
    callbacks: {
      onBackend: (report) => {
        backend = report;
      },
      onProgress: (stats) => options.onProgress?.(phase, stats),
      onError: (message) => {
        error = error ?? message;
      },
      // Calibration ignores hits: they are just successful candidates.
    },
    reportMs: 250,
  });

  try {
    await sleep(warmupMs);
    if (error !== null) throw new Error(error);
    phase = 'measuring';
    const before = coordinator.stats();
    await sleep(measureMs);
    if (error !== null) throw new Error(error);
    const after = coordinator.stats();

    const scanned = after.scanned - before.scanned;
    const spanMs = after.elapsedMs - before.elapsedMs;
    if (spanMs <= 0 || scanned <= 0) throw new Error('Calibration measured no work; try again.');

    return {
      rate: (scanned * 1000) / spanMs,
      workerCount: options.workerCount,
      mode: options.mode,
      backend,
      measuredMs: spanMs,
      timestamp: Date.now(),
      appVersion: options.appVersion,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
    };
  } finally {
    await coordinator.stop();
  }
}

export function saveCalibration(result: CalibrationResult): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Storage unavailable (private mode, quota, blocked) — calibration still
    // works for this session; it just will not persist.
  }
}

export function loadCalibration(appVersion: string): CalibrationResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CalibrationResult;
    if (typeof parsed.rate !== 'number' || parsed.rate <= 0) return null;
    if (parsed.appVersion !== appVersion) return null;
    if (Date.now() - parsed.timestamp > CALIBRATION_MAX_AGE_MS) return null;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null;
    if (parsed.hardwareConcurrency !== cores) return null;
    return parsed;
  } catch {
    return null;
  }
}
