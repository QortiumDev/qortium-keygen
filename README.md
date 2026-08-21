# Qortium Keygen

A QORT vanity address generator that runs entirely in the browser, publishable
as a QDN app on **both** Qortium (`qdn://APP/Keygen/Keygen`) and Qortal
(`qortal://APP/Keygen/default`).

Pick a pattern (starts with / ends with / anywhere, optionally
case-insensitive), see the exact difficulty and a probabilistic time estimate
(median / average / 95th percentile) for your device after a calibration run,
then search across Web Workers. Every hit is independently re-derived with a
second crypto implementation before it is shown.

## How it derives addresses

Byte-identical to Qortal Hub / Qortal UI `PhraseWallet` v2 and Qortium Core,
pinned by golden-vector tests (`src/crypto/derive.test.ts`):

- **Master-seed mode** (Qortal Hub compatible): random 64-byte master seed →
  `SHA512`-based index-0 derivation → ed25519 → `Base58Check(0x3A ‖ hash160)`.
- **Raw-seed mode** (Qortium Home / CLI): random 32-byte ed25519 seed used
  directly — skips both SHA-512 passes, so it searches faster. Qortal Hub has
  no raw-key import, hence the mode choice in the UI.

The search hot loop is fully synchronous (hash-wasm + libsodium, with pure-JS
fallbacks) and start-anchored patterns are matched **numerically** against
payload intervals, so most candidates are rejected without computing the
checksum or any base58 string.

## Development

```
npm install
npm test          # vitest: golden vectors, estimator math, matcher properties
npm run dev       # local dev server (search works fully offline)
npm run build     # type-check + production bundle in dist/
npm run qdn:publish  # publish dist/ to a local Qortium node (see scripts/)
```

Design notes, review provenance and the phased roadmap live in
`docs/ROADMAP.md`. The app makes **zero network requests** while generating;
seeds never leave the page.

## License

0BSD — see `LICENSE`.
