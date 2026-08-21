# Keygen roadmap

Provenance: this app was designed from a four-lane review (2026-08-21) of the
archived Q-Keys app, the Qortal/Qortium wallet import surfaces, the QDN
platform differences, and vanity-search methods. The review reports live in
the maintainer's notes (`~/AGENTS/projects/qdn-vanity-app/`), summarized here
where they shape the code.

## Implementation phases (R4 §7 order)

- [x] **P1 — Exact estimators.** BigInt digit-DP over the 34-char address
  space (exact second-character distribution; case classes with unpaired
  L/l, I/i, O/o), geometric ETA quantiles (p50/mean/p95), 1-year-p95
  infeasibility warning.
- [x] **P2 — Hardened sync worker.** One-time hash-wasm + libsodium init,
  synchronous hot loop in adaptive ~40 ms batches, pooled crypto RNG,
  run-scoped protocol (runId filtering, absolute counters, acknowledged
  stop). No non-cryptographic PRNG exists anywhere in the app.
- [x] **P3 — Numeric early-reject.** Start patterns compile to sorted payload
  intervals; candidates resolve by byte comparison, checksum only on
  boundary candidates, base58 only for hits.
- [x] **P4 — Calibration + probabilistic ETA UI.** Production-path
  calibration (warmup, then timed window), localStorage persistence with
  staleness checks, difficulty/ETA display.
- [ ] **P5 — Fused scalar WASM.** Single WASM module doing
  seed → hash160 (+ numeric match) per batch call. Target: fewer JS/WASM
  crossings; keep cross-backend differential tests.
- [ ] **P6 — SIMD WASM** with `WebAssembly.validate` feature detection and
  scalar fallback.
- [ ] **P7 — Exact anywhere-mode estimator** (digit-DP with KMP state) and
  numeric suffix matching; today anywhere/end use full-encode matching and
  the anywhere estimate is a positional approximation.

## Export formats

- [x] Raw-seed hits: base58 private seed (direct import into Qortium Home /
  Qortium Python CLI) + hex, plain-text download.
- [x] Master-seed hits: password-encrypted Qortal Hub backup JSON (v2)
  generated client-side in a worker. Schema verified natively against
  Qortal-Hub source (kdf.ts, storeWallet.ts, decryptWallet.ts): 16-way
  bcrypt-over-SHA512 with static salts (the random `salt` field is stored but
  unused by the KDF), 31-byte macKey quirk preserved, AES-256-CBC without
  padding, same bcryptjs library as Hub. Tests decrypt the archived real Hub
  fixture AND reproduce its exact ciphertext/MAC byte-for-byte.
- [ ] Label exports clearly per network: backup JSONs carry no chain
  discriminator (R2 finding).

## Dual-network publish

- [x] Qortium: `npm run qdn:publish` → `qdn://APP/Keygen/Keygen` under
  QortiumHomeTest (published 2026-08-21, confirmed height 100106).
- [x] Qortal: `scripts/publish-qortal.sh` → `qortal://APP/Keygen/default`
  under the Keygen name (registered 2026-08-21). Builds REGISTER_NAME
  locally, signs locally (the 64-byte `reference` difference is handled by
  the shared signer's header auto-detection), publishes via
  ext-node.qortal.link with `--fee 0.01`.

## Open runtime acceptance checks (R3)

1. WASM instantiation **inside a worker** on Qortal Core gateway / Qortal Hub
   (per-asset CSP suspected to block it). Fallback already in place: pure-JS
   noble/tweetnacl backends auto-selected when WASM init fails.
2. `<a download>` export behavior inside Qortium Home Android WebView.
3. Worker spawning on all four hosts (file-based classic workers only — never
   blob: workers; Qortal's CSP blocks those).

## Platform notes

- Feature-detect `window.qdnRequest` (Qortium prod) vs `window.qortalRequest`
  (Qortal, Home 2.0). The app needs no bridge calls to function.
- No SharedArrayBuffer anywhere; never rely on `crypto.subtle` for hashing
  (plain-HTTP Qortal gateways are not secure contexts) — only
  `crypto.getRandomValues` is required, and the app fails closed without it.
