// Message protocol between the coordinator and search workers. Every message
// that belongs to a run carries its runId; the coordinator drops anything
// stale, which is what makes stop/restart race-free (a lesson from the old
// Q-Keys driver, which had none of this and double-counted orphaned workers).

import type { MatchSpec } from './matcher';

/** How candidate seeds are generated, matching the wallet the user targets. */
export type SeedMode =
  /** Random 64-byte master seed, index-0 derivation — importable in Qortal Hub (and everywhere else). */
  | 'master-seed'
  /** Random 32-byte ed25519 seed — importable in Qortium Home / CLI; skips both SHA-512 passes. */
  | 'raw-seed';

export interface RunConfig {
  runId: number;
  mode: SeedMode;
  spec: MatchSpec;
  /** Target milliseconds per synchronous batch (worker adapts batch size). */
  batchMs: number;
  /** Milliseconds between progress reports. */
  reportMs: number;
}

export type WorkerRequest =
  | { type: 'start'; config: RunConfig }
  | { type: 'stop'; runId: number };

export interface BackendReport {
  hashes: string;
  ed25519: string;
}

export type WorkerResponse =
  | { type: 'ready'; backend: BackendReport }
  | { type: 'init-error'; message: string }
  | { type: 'progress'; runId: number; scanned: number; elapsedMs: number }
  | { type: 'hit'; runId: number; seedHex: string; address: string; scanned: number }
  | { type: 'stopped'; runId: number; scanned: number; elapsedMs: number }
  | { type: 'run-error'; runId: number; message: string };
