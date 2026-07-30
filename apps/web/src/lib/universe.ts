/**
 * The single public universe this terminal quotes into.
 *
 * A universe is the public grid — the set of markets and the rate ticks within each — that mandates
 * and requests are expressed against. It is public by construction: a confidential mandate is only
 * meaningful relative to an agreed grid, and every verifier needs the same grid to check a quote.
 *
 * ONE UNIVERSE, DELIBERATELY. A local stack stands up one, and Phase 6's two issuance stacks share it
 * — that sharing is what makes two epochs over one universe produce two SERIES rather than two quotes
 * on the same one (delta U-1). A universe picker would imply a registry of them that this deployment
 * does not have, and `.claude/rules/frontend.md` forbids an unfinished visible control.
 */

/** The local fixture universe. Public, and the same value every script and test uses. */
export const UNIVERSE = `0x${"11".repeat(32)}` as `0x${string}`;
