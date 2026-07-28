---
description: Branching, commits and what must never enter the repository
---

# Git

- **Never commit to `main`.** Work on `phase/NN-name` or `feat/…`, `fix/…`, `test/…`.
- Conventional commits, scoped, one logical change each: `test(midnight): …`, `feat(curve): …`.
- The body explains **what was proven or changed and why**, not a list of files.
- **Never add `Co-Authored-By` trailers.**
- Never use destructive git commands (`push --force`, `reset --hard` on shared history, `clean -fdx`
  over user files). Never overwrite user-authored files.
- Do not push or open a PR unless explicitly asked.
- Never commit: private keys, mnemonics, RPC credentials, Cloudflare API tokens, `.env`,
  funded-wallet material, decrypted values, or Nox handles paired with their plaintext.
- Local Nox test-gateway keys may be committed **only** when clearly labelled as local-only Nox
  infrastructure and unusable on a public network.
- Never edit `hack.md`, `design.md`, or `kyrve-production-prd.md`. Corrections go in
  `docs/day0/PRD-DELTA.md`.
- `vendor/midnight` is a pinned submodule. Never edit its contents. Changing the pin is its own
  commit that also updates `source-lock.json`.
