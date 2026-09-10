# Changelog

## 1.4.1 — 2026-09-09

- Add a **Developers** workspace beside Generator: canonical `?view=developers`
  (aliases `developer`, `reference`), preserving unrelated query params,
  repeated keys, the hash, and `history.state` across navigation. Reference
  section links and browser back/forward (`popstate`) route within the same
  mounted app — the Generator's running search, calibration, hits, and any
  open reveal/password fields stay mounted and untouched while hidden.
- Document the address-derivation pipeline, the fact that the address version
  byte is shared between Qortium/Qortal (not a chain selector), import/export
  compatibility, the Hub v2 backup schema and KDF caveats, the search worker
  protocol, calibration storage, estimator precision (payload-model exact starts-with vs.
  approximate ends-with/anywhere), crypto backend fallback, and worker/CSP/
  download caveats — verified against the current code, with inert
  placeholder fixtures (no real seeds, keys, or ciphertext) and accessible
  copy-to-clipboard buttons (Clipboard API with an `execCommand` fallback).
- Add Home fleet appearance sync: theme, `uiStyle` (classic/modern/fun), all
  six text sizes, and all ten accents applied from query settings over the
  individual Home globals (`_qdnTheme`, `_qdnUiStyle`, `_qdnTextSize`,
  `_qdnAccent`), then live via parent-validated
  `DISPLAY_SETTINGS_CHANGED` messages (accepted only from the embedding
  parent frame). Purely presentational — no change to derivation, backup,
  matcher, coordinator, or randomness. The app remains English-only; the
  Developers reference is explicitly `lang="en" dir="ltr"` regardless of host
  appearance settings.
