import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { CopyButton } from './CopyButton';

interface Section {
  id: string;
  title: string;
}

const SECTIONS: Section[] = [
  { id: 'derivation', title: 'Address derivation pipeline' },
  { id: 'address-version', title: 'Address version is not a chain selector' },
  { id: 'exports', title: 'Import / export compatibility' },
  { id: 'hub-backup-schema', title: 'Hub backup v2 schema & KDF' },
  { id: 'search-protocol', title: 'Search worker protocol' },
  { id: 'calibration-storage', title: 'Calibration storage' },
  { id: 'estimator-precision', title: 'Estimator precision' },
  { id: 'crypto-backends', title: 'Crypto backend capability & fallback' },
  { id: 'hosting-caveats', title: 'Worker, CSP & download caveats' },
];

const SECTION_IDS = new Set(SECTIONS.map((section) => section.id));

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

interface SectionLinkProps {
  sectionId: string;
  onNavigateSection: (sectionId: string) => void;
  hrefForSection: (sectionId: string) => string;
  children: ReactNode;
}

function SectionLink({ sectionId, onNavigateSection, hrefForSection, children }: SectionLinkProps) {
  return (
    <a
      href={hrefForSection(sectionId)}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return; // let modifier/middle clicks open a new tab as usual
        event.preventDefault();
        onNavigateSection(sectionId);
      }}
    >
      {children}
    </a>
  );
}

const HUB_BACKUP_EXAMPLE = `{
  "address0": "<QORT address>",
  "encryptedSeed": "<base58 AES-256-CBC ciphertext, no padding>",
  "salt": "<base58 32-byte salt — stored, NOT consumed by the KDF>",
  "iv": "<base58 16-byte IV>",
  "version": 2,
  "mac": "<base58 HMAC-SHA512 over encryptedSeed>",
  "kdfThreads": 16
}`;

const RUN_CONFIG_EXAMPLE = `// WorkerRequest sent to start a run
// Inert notation: lo/hi are Uint8Array values sent by structured clone, not JSON strings.
{
  "type": "start",
  "config": {
    "runId": 7,
    "mode": "raw-seed",       // or "master-seed"
    "spec": { "kind": "intervals", "intervals": [{ "lo": "<25-byte Uint8Array>", "hi": "<25-byte Uint8Array>" }] },
    "batchMs": 40,             // target ms per synchronous batch (adaptive)
    "reportMs": 500            // progress message cadence
  }
}`;

const WORKER_RESPONSE_EXAMPLE = `// WorkerResponse variants (see src/search/protocol.ts)
{ "type": "ready", "backend": { "hashes": "hash-wasm", "ed25519": "libsodium" } }
{ "type": "progress", "runId": 7, "scanned": 123456, "elapsedMs": 4021 }
{ "type": "hit", "runId": 7, "seedHex": "<hex seed>", "address": "<QORT address>", "scanned": 123999 }
{ "type": "stopped", "runId": 7, "scanned": 200000, "elapsedMs": 6000 }`;

const CALIBRATION_STORAGE_EXAMPLE = `// localStorage["qortium-keygen.calibration.v1"]
{
  "rate": 42000,
  "workerCount": 4,
  "mode": "raw-seed",
  "backend": { "hashes": "hash-wasm", "ed25519": "libsodium" },
  "measuredMs": 5000,
  "timestamp": 1700000000000,
  "appVersion": "1.4.1",
  "hardwareConcurrency": 8
}`;

export function DevelopersWorkspace({
  section,
  onNavigateSection,
  hrefForSection,
}: {
  section: string;
  onNavigateSection: (sectionId: string) => void;
  hrefForSection: (sectionId: string) => string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!SECTION_IDS.has(section)) return;
    const container = scrollRef.current;
    if (container === null) return;
    const target = document.getElementById(section);
    if (target === null || !container.contains(target)) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    // Move only the app's bounded scroller. Browser-wide scrolling can move
    // the embedding Home page as well, which violates the QDN host contract.
    container.scrollTop += targetRect.top - containerRect.top;
  }, [section]);

  return (
    <div className="developers-scroll" ref={scrollRef} lang="en" dir="ltr">
      <section className="card">
        <h2>Developer reference</h2>
        <p className="muted small">
          Technical reference for how Keygen derives addresses, what it exports, and how its search
          and calibration machinery behaves. Every fact below is drawn directly from this app&apos;s
          source (file paths in each section) — nothing here is aspirational. Examples use
          placeholders like <code>&lt;32-byte seed&gt;</code> instead of real seeds, keys, or
          ciphertext.
        </p>
        <nav aria-label="Reference sections">
          <ol className="reference-toc">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <SectionLink sectionId={section.id} onNavigateSection={onNavigateSection} hrefForSection={hrefForSection}>
                  {section.title}
                </SectionLink>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      <section className="card reference-section" id="derivation">
        <h2>{SECTIONS[0].title}</h2>
        <p>
          Two independent pipelines produce an address, chosen by <strong>seed mode</strong> (
          <code>src/crypto/derive.ts</code>):
        </p>
        <ul className="facts">
          <li>
            <strong>Raw-seed</strong> (Qortium Home / CLI import): a random <strong>32-byte</strong>{' '}
            ed25519 seed is used directly as the address seed — no SHA-512 passes.
          </li>
          <li>
            <strong>Master-seed</strong> (Qortal Hub compatible): a random <strong>64-byte</strong>{' '}
            master seed goes through <code>masterSeedToAddressSeed</code> — <code>x = int32be(0) ‖ seed64
            ‖ int32be(0)</code>. Let <code>h1 = SHA512(x)</code>; the address seed is the first 32
            bytes of <code>SHA512(h1 ‖ x)</code>. This exact concatenation is the second pass, not{' '}
            <code>SHA512(SHA512(x))</code>, and produces the wallet&apos;s <strong>index-0</strong> address seed.
          </li>
          <li>
            From there both pipelines are identical: ed25519 public key from the 32-byte address
            seed → <code>version(0x3A) ‖ RIPEMD160(SHA256(publicKey))</code> (the 21-byte &quot;core&quot;)
            → append a 4-byte double-SHA256 checksum → base58-encode the 25-byte payload.
          </li>
        </ul>
      </section>

      <section className="card reference-section" id="address-version">
        <h2>{SECTIONS[1].title}</h2>
        <p>
          <code>ADDRESS_VERSION</code> is <code>0x3A</code> (<code>src/crypto/constants.ts</code>) — the
          same byte Qortium and Qortal both use. The 25-byte payload encodes only version + hash160 +
          checksum; it carries <strong>no network/chain discriminator</strong>. An address string alone
          cannot tell you whether it belongs to Qortium or Qortal — that is determined entirely by which
          network&apos;s node/API you submit a transaction to, not by anything in the address bytes.
        </p>
      </section>

      <section className="card reference-section" id="exports">
        <h2>{SECTIONS[2].title}</h2>
        <ul className="facts">
          <li>
            <strong>Raw-seed hits</strong> export as a base58 private seed (plus hex) — Qortium Home and
            the Qortium Python CLI import this directly. Qortal Hub has no raw-key import path.
          </li>
          <li>
            <strong>Master-seed hits</strong> export as a password-encrypted Qortal Hub backup (v2)
            JSON, generated client-side in a Web Worker, or as unencrypted 64-byte hex. Plain hex
            requires a client that accepts master-seed input; it is not a Hub backup file.
          </li>
          <li>Raw-seed and master-seed exports are not interchangeable: a Hub backup always carries a 64-byte master seed, never a 32-byte raw seed.</li>
        </ul>
      </section>

      <section className="card reference-section" id="hub-backup-schema">
        <h2>{SECTIONS[3].title}</h2>
        <p>
          Byte-compatible with Qortal Hub&apos;s wallet-backup format (verified against Hub source;
          see <code>src/wallet/backup.ts</code>). Fields are base58 except <code>version</code> and{' '}
          <code>kdfThreads</code>, which are plain numbers:
        </p>
        <div className="schema-block">
          <CopyButton text={HUB_BACKUP_EXAMPLE} label="Copy schema" />
          <pre className="code-block">
            <code>{HUB_BACKUP_EXAMPLE}</code>
          </pre>
        </div>
        <p className="muted small">KDF caveats, preserved intentionally for compatibility:</p>
        <ul className="facts">
          <li>
            16-way <code>bcrypt(base64(SHA512(staticSalt + password + nonce))[0:72], staticBcryptSalt)</code>
            , then <code>SHA512(staticSalt + concat(results))</code> — both salts are fixed constants
            baked into the app, not the per-file <code>salt</code> field.
          </li>
          <li>
            The per-file <code>salt</code> field is <strong>stored but not consumed</strong> by the KDF —
            a Hub quirk this app reproduces exactly rather than &quot;fixing&quot;.
          </li>
          <li>
            <code>encryptionKey = key[0:32]</code>, <code>macKey = key[32:63]</code> — the mac key is 31
            bytes, not 32; another intentional Hub quirk.
          </li>
          <li><code>encryptedSeed = AES-256-CBC(seed64)</code> with padding disabled; <code>mac = HMAC-SHA512(macKey, encryptedSeed)</code>.</li>
          <li>The MAC covers ciphertext only; the IV, salt, address, version, and KDF metadata are not authenticated by it.</li>
          <li>The KDF is deliberately slow (bcrypt ×16); this app always runs it in a Web Worker, never on the main thread.</li>
        </ul>
      </section>

      <section className="card reference-section" id="search-protocol">
        <h2>{SECTIONS[4].title}</h2>
        <p>
          The coordinator (<code>src/search/coordinator.ts</code>) and each search worker (
          <code>src/search/search.worker.ts</code>) exchange a small run-scoped protocol (
          <code>src/search/protocol.ts</code>):
        </p>
        <div className="schema-block">
          <CopyButton text={RUN_CONFIG_EXAMPLE} label="Copy start message" />
          <pre className="code-block">
            <code>{RUN_CONFIG_EXAMPLE}</code>
          </pre>
        </div>
        <div className="schema-block">
          <CopyButton text={WORKER_RESPONSE_EXAMPLE} label="Copy response shapes" />
          <pre className="code-block">
            <code>{WORKER_RESPONSE_EXAMPLE}</code>
          </pre>
        </div>
        <ul className="facts">
          <li>
            Progress, hit, stopped, and run-error messages carry the numeric <code>runId</code> they
            belong to; the coordinator drops mismatches, so a stop followed immediately by a new
            start can never double-count or resurrect a stale worker. Startup <code>ready</code> and
            <code>init-error</code> messages have no run id.
          </li>
          <li>
            <code>batchMs</code> targets milliseconds of synchronous work per batch; each worker adapts
            its batch size after every batch to hit that target. <code>reportMs</code> paces progress
            messages independently of batch size.
          </li>
          <li>
            Stopping is acknowledged: the coordinator posts <code>stop</code> to every worker and waits
            for a <code>stopped</code> reply from each — but only up to <strong>2 seconds</strong>; after
            that it terminates every worker unconditionally so the UI never hangs on a stuck worker.
          </li>
          <li>Every hit is independently re-derived with a second, pure-JS crypto pipeline before it is ever shown or exported.</li>
        </ul>
      </section>

      <section className="card reference-section" id="calibration-storage">
        <h2>{SECTIONS[5].title}</h2>
        <p>
          Calibration (<code>src/search/calibration.ts</code>) runs the real search path (warmup, then a
          timed measurement window) and persists only performance metadata to{' '}
          <code>localStorage["qortium-keygen.calibration.v1"]</code>:
        </p>
        <div className="schema-block">
          <CopyButton text={CALIBRATION_STORAGE_EXAMPLE} label="Copy stored shape" />
          <pre className="code-block">
            <code>{CALIBRATION_STORAGE_EXAMPLE}</code>
          </pre>
        </div>
        <ul className="facts">
          <li>No seed, pattern, or address is ever written to storage — only the rate, worker count, seed mode, backend, timing, app version, and hardware-concurrency hint above.</li>
          <li>
            A stored result is ignored (falls back to &quot;uncalibrated&quot;) once the app version
            changes, <code>hardwareConcurrency</code> changes, or it is older than 30 days.
          </li>
        </ul>
      </section>

      <section className="card reference-section" id="estimator-precision">
        <h2>{SECTIONS[6].title}</h2>
        <p>Difficulty is computed differently per anchor mode (<code>src/estimator/probability.ts</code>) — they are not equally exact:</p>
        <ul className="facts">
          <li>
            <strong>Starts-with</strong>: exact under the payload model. A BigInt digit-DP counts real
            matching payload integers in the checksum-constrained range, so second-character bias and
            base58 boundary effects are exact within that model; checksum/address rendering remains a
            separate approximation.
          </li>
          <li>
            <strong>Ends-with</strong>: an independent per-character product, assuming each
            checksum-influenced trailing character is uniform over the 58-letter alphabet. Close in
            practice, but not an exact enumeration — the API does not flag it as approximate, so treat
            it as &quot;very good, not exact&quot;.
          </li>
          <li>
            <strong>Anywhere</strong>: a positional rare-event (Poisson) approximation, explicitly
            reported as <code>approximate: true</code>. An exact digit-DP + automaton estimator is on the
            roadmap but not implemented (<code>docs/ROADMAP.md</code> P7).
          </li>
          <li>
            The ETA shown (median / mean / 95th percentile) comes from the geometric distribution of a
            memoryless random search — it is a probability spread, never a deadline promise.
          </li>
        </ul>
      </section>

      <section className="card reference-section" id="crypto-backends">
        <h2>{SECTIONS[7].title}</h2>
        <p>
          <code>src/crypto/backends.ts</code> initializes hash-wasm + libsodium once at startup; if
          either fails or times out (5 s), the app falls back to pure-JS <code>@noble/hashes</code> +{' '}
          <code>tweetnacl</code> automatically — the search hot loop itself never awaits, and every hit
          is re-verified with the independent pure-JS pipeline regardless of which backend searched for
          it.
        </p>
        <ul className="facts">
          <li>
            The app feature-detects <code>window.qdnRequest</code> (Qortium) and{' '}
            <code>window.qortalRequest</code> (Qortal / Home 2.0) only for platform awareness — no bridge
            call is required for address generation, calibration, or export; the app works fully offline
            with only <code>crypto.getRandomValues</code>.
          </li>
          <li>There is no SharedArrayBuffer use anywhere, and hashing never relies on <code>crypto.subtle</code> (plain-HTTP gateways are not secure contexts).</li>
        </ul>
      </section>

      <section className="card reference-section" id="hosting-caveats">
        <h2>{SECTIONS[8].title}</h2>
        <ul className="facts">
          <li>
            Search and backup workers are bundled as <strong>classic (non-module)</strong> workers loaded
            from a bundled asset URL (<code>vite.config.ts</code> <code>worker.format: 'iife'</code>) — never{' '}
            <code>blob:</code> workers, since Qortal&apos;s CSP blocks those.
          </li>
          <li>
            Whether WASM can instantiate <em>inside a worker</em> on every QDN host&apos;s per-asset CSP
            is an open runtime acceptance check (<code>docs/ROADMAP.md</code>); the pure-JS fallback above
            exists specifically so generation still works if it cannot.
          </li>
          <li>
            Every export (raw-seed text, Hub backup JSON) is delivered via a same-page{' '}
            <code>&lt;a download&gt;</code> click on an object URL. That only <strong>triggers</strong> a
            save — the page has no way to confirm the browser (or a WebView&apos;s save sheet) actually
            wrote the file, or that the user did not cancel it. Do not treat a triggered download as proof
            a backup was saved; verify the file exists before trusting it as your only copy.
          </li>
        </ul>
      </section>
    </div>
  );
}
