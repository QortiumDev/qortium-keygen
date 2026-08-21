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
- [ ] Master-seed hits: password-encrypted Qortal Hub backup JSON (v2 schema:
  bcrypt-over-SHA512 KDF, HMAC-SHA512 MAC, AES-256-CBC) generated
  client-side. Until then the hex master seed is shown with guidance.
  **Verify the v3 (Qortium raw-key) and v2 schemas against current client
  code before implementing — the R2 findings were partly delegated research.**
- [ ] Label exports clearly per network: backup JSONs carry no chain
  discriminator (R2 finding).

## Dual-network publish

- Qortium: `npm run qdn:publish` → `APP/Keygen/Keygen` under QortiumHomeTest
  (script adapted from qortium-paint; QAVS manifest emitted at build time).
- [ ] Qortal publish script: Qortal's ARBITRARY transformer keeps the 64-byte
  `reference` field that the Qortium fork removed — needs its own signing
  path. Target: `APP/Keygen/default` (`qortal://APP/Keygen/default`).

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
