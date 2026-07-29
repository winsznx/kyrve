/**
 * `@kyrve/curve` — the plaintext side of the confidential curve engine.
 *
 * Nothing here touches Nox, a handle, a gateway or a key. It is the reference model the encrypted
 * engine is checked against, the universe builder both sides validate with, and the transaction
 * schedule the keeper plans from. `scripts/verify/import-boundary.ts` enforces that this package
 * never reaches for `@iexec-nox/*` — only `@kyrve/nox` may.
 */

export * from "./constants.js";
export * from "./fixtures.js";
export * from "./plan.js";
export * from "./reference.js";
export * from "./types.js";
export * from "./universe.js";
