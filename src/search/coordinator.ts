// Coordinates the worker pool for one search run: run-scoped message
// filtering, absolute per-worker counters, acknowledged stops, and
// independent re-verification of every hit (all direct fixes for the
// defects R1 found in the old Q-Keys driver).

import { referenceCrypto } from '../crypto/backends';
import { addressFromMasterSeed, addressFromRawSeed } from '../crypto/derive';
import type { MatchSpec } from './matcher';
import type { BackendReport, SeedMode, WorkerRequest, WorkerResponse } from './protocol';

export interface SearchHit {
  address: string;
  seedHex: string;
  mode: SeedMode;
  /** True when an independent pure-JS pipeline reproduced the same address. */
  verified: boolean;
}

export interface SearchStats {
  scanned: number;
  elapsedMs: number;
  /** Candidates/sec over the recent window (~5s). */
  recentRate: number;
  /** Candidates/sec over the whole run. */
  overallRate: number;
  workerCount: number;
}

export interface SearchCallbacks {
  onBackend?(backend: BackendReport): void;
  onProgress?(stats: SearchStats): void;
  onHit?(hit: SearchHit): void;
  onError?(message: string): void;
  onStopped?(stats: SearchStats): void;
}

export interface SearchOptions {
  workerCount: number;
  mode: SeedMode;
  spec: MatchSpec;
  callbacks: SearchCallbacks;
  batchMs?: number;
  reportMs?: number;
}

const STOP_ACK_TIMEOUT_MS = 2000;

function seedFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Re-derive a hit with the independent pure-JS pipeline. */
export function verifyHit(mode: SeedMode, seedHex: string, address: string): boolean {
  try {
    const reference = referenceCrypto();
    const seed = seedFromHex(seedHex);
    const derived =
      mode === 'master-seed' ? addressFromMasterSeed(reference, seed) : addressFromRawSeed(reference, seed);
    return derived === address;
  } catch {
    return false;
  }
}

export function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (isMobile) return 1;
  return Math.max(1, Math.min(8, cores - 1));
}

let nextRunId = 1;

export class SearchCoordinator {
  private workers: Worker[] = [];
  private runId = 0;
  private running = false;
  private startedAt = 0;
  private workerScanned: number[] = [];
  private samples: { at: number; total: number }[] = [];
  private callbacks: SearchCallbacks = {};
  private mode: SeedMode = 'raw-seed';
  private stopResolvers: (() => void)[] = [];
  private pendingStopAcks = 0;

  get isRunning(): boolean {
    return this.running;
  }

  start(options: SearchOptions): void {
    if (this.running) throw new Error('A search is already running; stop it first.');
    this.runId = nextRunId++;
    this.running = true;
    this.mode = options.mode;
    this.callbacks = options.callbacks;
    this.startedAt = performance.now();
    this.workerScanned = new Array<number>(options.workerCount).fill(0);
    this.samples = [{ at: this.startedAt, total: 0 }];
    this.pendingStopAcks = 0;

    const config = {
      runId: this.runId,
      mode: options.mode,
      spec: options.spec,
      batchMs: options.batchMs ?? 40,
      reportMs: options.reportMs ?? 500,
    };

    for (let index = 0; index < options.workerCount; index++) {
      const worker = new Worker(new URL('./search.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(index, event.data);
      worker.onerror = (event) => this.callbacks.onError?.(`Worker error: ${event.message}`);
      worker.postMessage({ type: 'start', config } satisfies WorkerRequest);
      this.workers.push(worker);
    }
  }

  /** Request a stop; resolves once every worker acknowledged (or timed out). */
  stop(): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.running = false;
    this.pendingStopAcks = this.workers.length;
    for (const worker of this.workers) {
      worker.postMessage({ type: 'stop', runId: this.runId } satisfies WorkerRequest);
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => finish(), STOP_ACK_TIMEOUT_MS);
      const finish = () => {
        clearTimeout(timeout);
        this.terminateAll();
        this.callbacks.onStopped?.(this.stats());
        resolve();
      };
      this.stopResolvers.push(finish);
    });
  }

  stats(): SearchStats {
    const now = performance.now();
    const total = this.workerScanned.reduce((sum, value) => sum + value, 0);
    const elapsedMs = now - this.startedAt;

    // Recent rate over a ~5s sample window.
    const windowStart = now - 5000;
    let base = this.samples[0];
    for (const sample of this.samples) {
      if (sample.at <= windowStart) base = sample;
      else break;
    }
    const recentSpanMs = now - base.at;
    const recentRate = recentSpanMs > 200 ? ((total - base.total) * 1000) / recentSpanMs : 0;

    return {
      scanned: total,
      elapsedMs,
      recentRate,
      overallRate: elapsedMs > 0 ? (total * 1000) / elapsedMs : 0,
      workerCount: this.workers.length,
    };
  }

  private handleMessage(workerIndex: number, message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.callbacks.onBackend?.(message.backend);
      return;
    }
    if (message.type === 'init-error') {
      this.callbacks.onError?.(`Crypto initialization failed: ${message.message}`);
      return;
    }
    if ('runId' in message && message.runId !== this.runId) return; // stale run

    switch (message.type) {
      case 'progress':
      case 'hit': {
        this.workerScanned[workerIndex] = message.scanned;
        const total = this.workerScanned.reduce((sum, value) => sum + value, 0);
        this.samples.push({ at: performance.now(), total });
        if (this.samples.length > 240) this.samples.splice(0, this.samples.length - 240);
        if (message.type === 'hit') {
          this.callbacks.onHit?.({
            address: message.address,
            seedHex: message.seedHex,
            mode: this.mode,
            verified: verifyHit(this.mode, message.seedHex, message.address),
          });
        } else {
          this.callbacks.onProgress?.(this.stats());
        }
        break;
      }
      case 'stopped': {
        this.workerScanned[workerIndex] = message.scanned;
        if (this.pendingStopAcks > 0 && --this.pendingStopAcks === 0) {
          for (const resolve of this.stopResolvers.splice(0)) resolve();
        }
        break;
      }
      case 'run-error':
        this.callbacks.onError?.(message.message);
        break;
    }
  }

  private terminateAll(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
