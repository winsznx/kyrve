---
description: Design-system fidelity and confidential-state UI rules
globs: ["apps/web/**", "apps/status/**", "apps/docs/**", "packages/react/**", "**/*.tsx", "**/*.css"]
---

# Frontend

`design.md` is the visual source of truth and is **immutable**. Follow it exactly — UX is an
explicit judging criterion. Use the tokens; never hardcode a hex value that has a token.

## Non-negotiable design rules

- Canvas `#171721`, cards `#1e1e2a` at 12px radius / 32px padding, **no shadows** — separation comes
  from the one-step value lift alone.
- Cobalt `#5266eb` is the **only** chromatic note, reserved for the single primary action per page.
  Never as decoration, icon fill, or secondary button. Never two cobalt elements within 32px.
- Body text is Ivory `#ededf3`, never `#ffffff`. Muted is Ash `#c3c3cc`.
- Headings at weight 480 — never 700+. Body 16px/1.5 at weight 400.
- Pill radius (32px / 40px) on all interactive controls. Sharp corners are structural only.
- 72px vertical rhythm between major sections.

## Confidential state

Four states, each with a consistent icon, label and explanation: **encrypted and unavailable**,
**available to decrypt**, **decrypted locally**, **intentionally public**.

- A locked private chart shows a deliberate redacted structure — **never zeroes and never sample
  data**.
- Privacy lock clears decrypted values from in-memory state immediately.
- Critical reveal warnings cannot be collapsed or hidden during signing.
- Never display an exact provider count where the count is meant to be private — only the
  privacy-floor boolean.

## Honesty

- No fake metrics, no placeholder proofs, no decorative charts without a real data source.
- Loading states name the actual async phase (input proof submitted, event confirmed, runner queued,
  output stored, decryption ready) — never one indefinite spinner.
- Errors distinguish public transaction failure, invalid proof, pending Nox output, public invariant
  failure, private no-fill, and service availability. A private no-fill must never reveal which
  provider or rule caused it.
- Avoid bento grids, glassmorphism, neon network art, generic gradients, token bubbles and robot
  illustrations. This is an institutional fixed-income terminal.
