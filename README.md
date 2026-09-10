# Qortium Keygen

A QORT vanity address generator that runs entirely in the browser, publishable
as a QDN app on **both** Qortium (`qdn://APP/Keygen/Keygen`) and Qortal
(`qortal://APP/Keygen/default`).

Pick a pattern (starts with / ends with / anywhere, optionally
case-insensitive), see the exact difficulty and a probabilistic time estimate
(median / average / 95th percentile) for your device after a calibration run,
then search across Web Workers. Every hit is independently re-derived with a
second crypto implementation before it is shown.

A **Developers** workspace sits beside the Generator (`?view=developers`,
aliases `developer`/`reference`, which are canonicalized on mount): a technical reference on address
derivation, the Hub backup v2 schema, the search worker protocol, calibration
storage, estimator precision, and crypto/hosting caveats — verified against
the current code, with inert placeholder examples (no real seeds/keys).
Switching workspaces never stops a running search or clears a draft: both
stay mounted, only hidden.

Reference links use `?section=<known-id>` and preserve the host URL fragment,
unknown/repeated query keys, and exact `history.state`; they never put Generator
patterns, hits, seeds, or passwords in the URL. When embedded in a Home-style
shell, Keygen syncs appearance (theme, `uiStyle`, six text sizes, and ten
accents) from query settings over the individual `_qdnTheme`, `_qdnUiStyle`,
`_qdnTextSize`, and `_qdnAccent` globals, then accepts guarded
`DISPLAY_SETTINGS_CHANGED` messages from the embedding parent — see
`src/display/displaySettings.ts`.

## How it derives addresses

Byte-identical to Qortal Hub / Qortal UI `PhraseWallet` v2 and Qortium Core,
pinned by golden-vector tests (`src/crypto/derive.test.ts`):

- **Master-seed mode** (Qortal Hub compatible): random 64-byte master seed →
  `x = int32be(0) ‖ seed64 ‖ int32be(0)`, `h1 = SHA512(x)`, then
  `SHA512(h1 ‖ x)[:32]` → ed25519 → `Base58Check(0x3A ‖ hash160)`.
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
