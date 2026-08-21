import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { base58Encode } from '../crypto/base58';
import { estimatePattern, secondCharacterSet, type AnchorMode } from '../estimator/probability';
import { estimateEta, formatDifficulty, formatDuration } from '../estimator/eta';
import {
  loadCalibration,
  runCalibration,
  saveCalibration,
  type CalibrationResult,
} from '../search/calibration';
import {
  defaultWorkerCount,
  SearchCoordinator,
  type SearchHit,
  type SearchStats,
} from '../search/coordinator';
import { buildMatchSpec, PatternCompileError, type MatchSpec } from '../search/matcher';
import type { BackendReport, SeedMode } from '../search/protocol';
import type { BackupWorkerRequest, BackupWorkerResponse } from '../wallet/backup.worker';

const APP_VERSION = __APP_VERSION__;

// Lazy singleton worker for the deliberately-slow Hub backup KDF.
let backupWorker: Worker | null = null;
let backupRequestId = 0;
function requestHubBackup(seedHex: string, password: string): Promise<{ fileName: string; json: string }> {
  backupWorker ??= new Worker(new URL('../wallet/backup.worker.ts', import.meta.url));
  const worker = backupWorker;
  const requestId = ++backupRequestId;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<BackupWorkerResponse>) => {
      if (event.data.requestId !== requestId) return;
      worker.removeEventListener('message', onMessage);
      if (event.data.ok) resolve({ fileName: event.data.fileName, json: event.data.json });
      else reject(new Error(event.data.message));
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ requestId, seedHex, password } satisfies BackupWorkerRequest);
  });
}

type SearchState = 'idle' | 'calibrating' | 'searching' | 'stopping';

interface HitRecord extends SearchHit {
  id: number;
  revealed: boolean;
}

function seedHexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function hitExportText(hit: SearchHit): string {
  const lines = [
    'Qortium Keygen — vanity address hit',
    `Address: ${hit.address}`,
    '',
  ];
  if (hit.mode === 'raw-seed') {
    lines.push(
      `Private seed (base58): ${base58Encode(seedHexToBytes(hit.seedHex))}`,
      `Private seed (hex): ${hit.seedHex}`,
      '',
      'Import: Qortium Home (or the Qortium Python CLI) accepts this base58',
      'private seed directly.',
    );
  } else {
    lines.push(
      `Master seed (hex): ${hit.seedHex}`,
      '',
      'Import: this is a 64-byte Qortal master seed (index-0 address shown',
      'above). Prefer the password-encrypted Hub backup (.json) download,',
      'which Qortal Hub imports directly; keep this plain hex offline.',
    );
  }
  lines.push('', 'Generated locally in your browser. This seed was never transmitted.', '');
  return lines.join('\n');
}

function HubBackupExport({ hit }: { hit: HitRecord }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const generate = async () => {
    if (password.length < 5) {
      setMessage('Use at least 5 characters.');
      return;
    }
    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const { fileName, json } = await requestHubBackup(hit.seedHex, password);
      downloadText(fileName, json);
      setMessage('Backup downloaded — import it in Qortal Hub with this password.');
      setPassword('');
      setConfirm('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backup">
      <button type="button" className="button small" onClick={() => setOpen(!open)}>
        {open ? 'Hide Hub backup' : 'Hub backup (.json)…'}
      </button>
      {open && (
        <div className="backup-form">
          <p className="muted small">
            Encrypts the seed with a password into a standard Qortal Hub backup file
            (encryption runs locally and takes a few seconds).
          </p>
          <div className="row">
            <input
              type="password"
              className="pattern-input backup-input"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <input
              type="password"
              className="pattern-input backup-input"
              placeholder="Confirm password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <button type="button" className="button" disabled={busy} onClick={() => void generate()}>
              {busy ? 'Encrypting…' : 'Encrypt & download'}
            </button>
          </div>
          {message !== null && <p className="muted small">{message}</p>}
        </div>
      )}
    </div>
  );
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function App() {
  const [pattern, setPattern] = useState('');
  const [mode, setMode] = useState<AnchorMode>('start');
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [seedMode, setSeedMode] = useState<SeedMode>('raw-seed');
  const [workerCount, setWorkerCount] = useState(defaultWorkerCount);
  const [keepSearching, setKeepSearching] = useState(false);

  const [state, setState] = useState<SearchState>('idle');
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [backend, setBackend] = useState<BackendReport | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(() =>
    loadCalibration(APP_VERSION),
  );
  const [hits, setHits] = useState<HitRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const coordinatorRef = useRef<SearchCoordinator | null>(null);
  const hitCounter = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const estimate = useMemo(() => estimatePattern(pattern, mode, ignoreCase), [pattern, mode, ignoreCase]);

  const spec: MatchSpec | null = useMemo(() => {
    if (!estimate.ok) return null;
    try {
      return buildMatchSpec(pattern, mode, ignoreCase);
    } catch (compileError) {
      if (compileError instanceof PatternCompileError) return null;
      throw compileError;
    }
  }, [pattern, mode, ignoreCase, estimate.ok]);

  const knownRate =
    state === 'searching' && stats !== null && stats.recentRate > 0
      ? stats.recentRate
      : calibration !== null && calibration.mode === seedMode && calibration.workerCount === workerCount
        ? calibration.rate
        : null;

  const eta = estimate.ok && knownRate !== null ? estimateEta(estimate.probability, knownRate) : null;

  const maxWorkers = Math.max(1, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4);

  const stopSearch = useCallback(async () => {
    const coordinator = coordinatorRef.current;
    if (coordinator === null) return;
    setState('stopping');
    await coordinator.stop();
    coordinatorRef.current = null;
    setState('idle');
  }, []);

  const startSearch = useCallback(() => {
    if (spec === null || stateRef.current !== 'idle') return;
    setError(null);
    setStats(null);
    const coordinator = new SearchCoordinator();
    coordinatorRef.current = coordinator;
    setState('searching');
    coordinator.start({
      workerCount,
      mode: seedMode,
      spec,
      callbacks: {
        onBackend: setBackend,
        onProgress: setStats,
        onError: (message) => setError(message),
        onHit: (hit) => {
          setHits((existing) => [
            { ...hit, id: ++hitCounter.current, revealed: false },
            ...existing,
          ]);
          if (!keepSearching) void stopSearch();
        },
      },
    });
  }, [spec, workerCount, seedMode, keepSearching, stopSearch]);

  const calibrate = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    // Calibrate against the real spec when valid, else a representative one.
    const calibrationSpec = spec ?? buildMatchSpec('AAAA', 'start', false);
    setError(null);
    setState('calibrating');
    try {
      const result = await runCalibration({
        mode: seedMode,
        spec: calibrationSpec,
        workerCount,
        appVersion: APP_VERSION,
      });
      setCalibration(result);
      saveCalibration(result);
      if (result.backend !== null) setBackend(result.backend);
    } catch (calibrationError) {
      setError(calibrationError instanceof Error ? calibrationError.message : String(calibrationError));
    } finally {
      setState('idle');
    }
  }, [spec, seedMode, workerCount]);

  useEffect(() => {
    return () => {
      void coordinatorRef.current?.stop();
    };
  }, []);

  const patternPlaceholder = mode === 'start' ? 'e.g. myname' : mode === 'end' ? 'e.g. 777' : 'e.g. name';

  return (
    <div className="app">
      <header className="header">
        <h1>
          Qortium <span className="accent">Keygen</span>
        </h1>
        <p className="tagline">
          Search for a QORT address containing your chosen text — entirely in your browser, on both
          Qortium and Qortal.
        </p>
      </header>

      <section className="card">
        <h2>How Q addresses work</h2>
        <ul className="facts">
          <li>
            Every address is exactly <strong>34 characters</strong> and starts with <strong>Q</strong>.
          </li>
          <li>
            Characters come from the base58 alphabet — <strong>0, O, I and l never appear</strong>{' '}
            (case-insensitive matching maps them to o, i and L).
          </li>
          <li>
            The character right after Q is always one of <code>{secondCharacterSet()}</code>.
          </li>
          <li>Each extra character multiplies the search time by roughly 58×.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Pattern</h2>
        <div className="row">
          <div className="segmented" role="radiogroup" aria-label="Match position">
            {(['start', 'end', 'anywhere'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={mode === option ? 'segment active' : 'segment'}
                onClick={() => setMode(option)}
              >
                {option === 'start' ? 'Starts with' : option === 'end' ? 'Ends with' : 'Anywhere'}
              </button>
            ))}
          </div>
        </div>
        <div className="row pattern-row">
          {mode === 'start' && <span className="q-chip" title="Every address starts with Q">Q</span>}
          <input
            className="pattern-input"
            value={pattern}
            placeholder={patternPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => setPattern(event.target.value.replace(/\s/g, ''))}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(event) => setIgnoreCase(event.target.checked)}
            />
            Ignore case
          </label>
        </div>
        {pattern.length > 0 && (
          <div className="estimate">
            {estimate.ok ? (
              <>
                <span className="difficulty">
                  Difficulty: <strong>{formatDifficulty(estimate.difficulty)}</strong>
                  {estimate.approximate ? ' (approximate)' : ''}
                </span>
                {eta !== null ? (
                  <span className={eta.infeasible ? 'eta warn' : 'eta'}>
                    {eta.infeasible
                      ? `Practically infeasible on this device (95% chance needs ${formatDuration(eta.p95Seconds)})`
                      : `50% chance by ${formatDuration(eta.medianSeconds)} · average ${formatDuration(eta.meanSeconds)} · 95% by ${formatDuration(eta.p95Seconds)}`}
                  </span>
                ) : (
                  <span className="eta muted">Calibrate below to estimate the search time.</span>
                )}
              </>
            ) : (
              estimate.issues.map((issue) => (
                <span key={issue} className="issue">
                  {issue}
                </span>
              ))
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Target wallet</h2>
        <div className="choices">
          <label className={seedMode === 'raw-seed' ? 'choice active' : 'choice'}>
            <input
              type="radio"
              name="seed-mode"
              checked={seedMode === 'raw-seed'}
              onChange={() => setSeedMode('raw-seed')}
            />
            <span>
              <strong>Qortium</strong> — fastest. Produces a base58 private seed that Qortium Home and
              the Qortium CLI import directly.
            </span>
          </label>
          <label className={seedMode === 'master-seed' ? 'choice active' : 'choice'}>
            <input
              type="radio"
              name="seed-mode"
              checked={seedMode === 'master-seed'}
              onChange={() => setSeedMode('master-seed')}
            />
            <span>
              <strong>Qortal Hub compatible</strong> — produces a full 64-byte master seed (slower per
              attempt). Works everywhere, including Qortal Hub.
            </span>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Device speed</h2>
        <div className="row">
          <label className="field">
            Workers
            <input
              type="number"
              min={1}
              max={maxWorkers}
              value={workerCount}
              onChange={(event) =>
                setWorkerCount(Math.max(1, Math.min(maxWorkers, Number(event.target.value) || 1)))
              }
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={state !== 'idle'}
            onClick={() => void calibrate()}
          >
            {state === 'calibrating' ? 'Calibrating…' : 'Calibrate (~7 s)'}
          </button>
          {calibration !== null && (
            <span className="muted">
              {Math.round(calibration.rate).toLocaleString()} addresses/s with {calibration.workerCount}{' '}
              worker{calibration.workerCount === 1 ? '' : 's'}
              {calibration.mode !== seedMode || calibration.workerCount !== workerCount
                ? ' (recalibrate for the current settings)'
                : ''}
            </span>
          )}
        </div>
        {backend !== null && (
          <p className="muted small">
            Crypto backend: hashes via {backend.hashes}, ed25519 via {backend.ed25519}.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Search</h2>
        <div className="row">
          {state === 'searching' || state === 'stopping' ? (
            <button type="button" className="button stop" onClick={() => void stopSearch()}>
              {state === 'stopping' ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button
              type="button"
              className="button start"
              disabled={spec === null || state !== 'idle'}
              onClick={startSearch}
            >
              Start search
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={keepSearching}
              onChange={(event) => setKeepSearching(event.target.checked)}
            />
            Keep searching after a hit
          </label>
        </div>
        {stats !== null && (state === 'searching' || state === 'stopping') && (
          <p className="progress">
            Scanned {stats.scanned.toLocaleString()} · {Math.round(stats.recentRate).toLocaleString()}
            /s · running {formatDuration(stats.elapsedMs / 1000)}
          </p>
        )}
        {error !== null && <p className="issue">{error}</p>}

        {hits.length > 0 && (
          <ul className="hits">
            {hits.map((hit) => (
              <li key={hit.id} className="hit">
                <div className="hit-address">
                  <code>{hit.address}</code>
                  <span className={hit.verified ? 'badge ok' : 'badge bad'}>
                    {hit.verified ? 'verified' : 'VERIFICATION FAILED — do not use'}
                  </span>
                </div>
                {hit.verified && (
                  <div className="hit-actions">
                    <button
                      type="button"
                      className="button small"
                      onClick={() =>
                        setHits((existing) =>
                          existing.map((entry) =>
                            entry.id === hit.id ? { ...entry, revealed: !entry.revealed } : entry,
                          ),
                        )
                      }
                    >
                      {hit.revealed ? 'Hide seed' : 'Reveal seed'}
                    </button>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => downloadText(`keygen-${hit.address}.txt`, hitExportText(hit))}
                    >
                      Download
                    </button>
                  </div>
                )}
                {hit.revealed && (
                  <code className="seed">
                    {hit.mode === 'raw-seed'
                      ? base58Encode(seedHexToBytes(hit.seedHex))
                      : hit.seedHex}
                  </code>
                )}
                {hit.verified && hit.mode === 'master-seed' && <HubBackupExport hit={hit} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        <p>
          Keygen {APP_VERSION} · Seeds are generated with your device&apos;s cryptographic random number
          generator and never leave this page.
        </p>
      </footer>
    </div>
  );
}
