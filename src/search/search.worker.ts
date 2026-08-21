// The search worker. All crypto is initialized ONCE (async), then the hot
// loop is fully synchronous, running in bounded batches with a macrotask
// yield between them so stop messages are honored promptly (R1/R4 design).

import { initSyncCrypto, type SyncCrypto } from '../crypto/backends';
import { coreChecksum, coreToAddress, masterSeedToAddressSeed, publicKeyToCore } from '../crypto/derive';
import { CORE_BYTES, PAYLOAD_BYTES } from '../crypto/constants';
import { IntervalMatcher, type MatchSpec } from './matcher';
import type { RunConfig, WorkerRequest, WorkerResponse } from './protocol';

const post = (message: WorkerResponse) => {
  (self as unknown as { postMessage(message: WorkerResponse): void }).postMessage(message);
};

// ---------------------------------------------------------------------------
// Seed randomness: pooled getRandomValues (65536 bytes is the per-call max).
// Views into the pool are only ever used inside one candidate; hits copy the
// seed before the pool can be refilled.
const SEED_POOL = new Uint8Array(65536);
let poolOffset = SEED_POOL.length;

function nextSeedView(byteLength: number): Uint8Array {
  if (poolOffset + byteLength > SEED_POOL.length) {
    crypto.getRandomValues(SEED_POOL);
    poolOffset = 0;
  }
  const view = SEED_POOL.subarray(poolOffset, poolOffset + byteLength);
  poolOffset += byteLength;
  return view;
}

// ---------------------------------------------------------------------------
const enginePromise: Promise<SyncCrypto | null> = initSyncCrypto()
  .then((engine) => {
    post({ type: 'ready', backend: { hashes: engine.info.hashes, ed25519: engine.info.ed25519 } });
    return engine;
  })
  .catch((error: unknown) => {
    post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
    return null;
  });

let activeRunId = -1;
let stopRequested = false;

interface HitResult {
  seed: Uint8Array;
  address: string;
}

function scanOne(
  engine: SyncCrypto,
  config: RunConfig,
  matcher: IntervalMatcher | null,
  regex: RegExp | null,
  payloadScratch: Uint8Array,
): HitResult | null {
  const seedView = nextSeedView(config.mode === 'master-seed' ? 64 : 32);
  const addressSeed = config.mode === 'master-seed' ? masterSeedToAddressSeed(engine, seedView) : seedView;
  const publicKey = engine.ed25519PublicFromSeed(addressSeed);
  const core = publicKeyToCore(engine, publicKey);

  if (matcher !== null) {
    const verdict = matcher.testCore(core);
    if (verdict === 'reject') return null;
    if (verdict === 'needs-checksum') {
      payloadScratch.set(core, 0);
      payloadScratch.set(coreChecksum(engine, core), CORE_BYTES);
      if (!matcher.testPayload(payloadScratch)) return null;
    }
    return { seed: Uint8Array.from(seedView), address: coreToAddress(engine, core) };
  }

  const address = coreToAddress(engine, core);
  if (regex !== null && !regex.test(address)) return null;
  return { seed: Uint8Array.from(seedView), address };
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reviveSpec(spec: MatchSpec): { matcher: IntervalMatcher | null; regex: RegExp | null } {
  if (spec.kind === 'intervals') {
    // Structured clone preserves Uint8Array, but copy defensively.
    const intervals = spec.intervals.map((interval) => ({
      lo: Uint8Array.from(interval.lo),
      hi: Uint8Array.from(interval.hi),
    }));
    return { matcher: new IntervalMatcher(intervals), regex: null };
  }
  return { matcher: null, regex: new RegExp(spec.source, spec.flags) };
}

async function runSearch(config: RunConfig): Promise<void> {
  const engine = await enginePromise;
  if (engine === null) {
    post({ type: 'run-error', runId: config.runId, message: 'Crypto backends failed to initialize.' });
    return;
  }

  activeRunId = config.runId;
  stopRequested = false;

  const { matcher, regex } = reviveSpec(config.spec);
  const payloadScratch = new Uint8Array(PAYLOAD_BYTES);

  let scanned = 0;
  let batchSize = 64;
  const runStart = performance.now();
  let lastReport = runStart;

  try {
    while (!stopRequested && activeRunId === config.runId) {
      const batchStart = performance.now();
      for (let i = 0; i < batchSize; i++) {
        const hit = scanOne(engine, config, matcher, regex, payloadScratch);
        scanned++;
        if (hit !== null) {
          post({ type: 'hit', runId: config.runId, seedHex: toHex(hit.seed), address: hit.address, scanned });
        }
      }

      const batchElapsed = performance.now() - batchStart;
      if (batchElapsed > 0) {
        const scaled = Math.round((batchSize * config.batchMs) / batchElapsed);
        batchSize = Math.max(16, Math.min(65536, scaled));
      }

      const now = performance.now();
      if (now - lastReport >= config.reportMs) {
        post({ type: 'progress', runId: config.runId, scanned, elapsedMs: now - runStart });
        lastReport = now;
      }

      // Macrotask yield: lets queued stop/start messages run between batches.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    post({
      type: 'run-error',
      runId: config.runId,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  post({ type: 'stopped', runId: config.runId, scanned, elapsedMs: performance.now() - runStart });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'start') {
    void runSearch(request.config);
  } else if (request.type === 'stop') {
    if (request.runId === activeRunId) stopRequested = true;
  }
};
