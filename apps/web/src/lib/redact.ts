/**
 * Redaction, on the client side of the boundary.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AT ALL, AND WHY IT IS A SEPARATE COPY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * U-F1: an Alchemy API key reached stdout twice, from two different scripts, because viem's error
 * formatting includes the full request URL and every script had a top-level `console.error(error)`.
 * `scripts/lib/env.ts` fixed that for Node with `redactUrls` / `safeErrorMessage`.
 *
 * The browser hits the identical failure mode through the identical library, and it hits it in a
 * worse place: a viem transport error rendered into the DOM is a credential in a screenshot, in a
 * bug report, and in whatever the user pastes into a support channel. `scripts/lib/env.ts` cannot be
 * imported here — it reads `process.env` and loads a `.env` file — so this is a deliberate second
 * implementation of the same rule rather than a shared module that would drag Node into the bundle.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES NOT CLAIM
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * This is not a sanitiser for arbitrary secrets. It removes the path and query of every URL in a
 * string, because that is where provider credentials live, and it truncates. It cannot know that a
 * bespoke error message embedded a bearer token in prose, so `scripts/verify/privacy-scan.ts` still
 * carries the structural rule that no decrypted value reaches a log, a metric or a URL — this
 * function narrows one measured hole rather than closing a category.
 */

/** Every URL reduced to scheme and host. The path and query are where credentials live. */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"')\]]+/g, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/***`;
    } catch {
      return "<url redacted>";
    }
  });
}

/**
 * The displayable form of an unknown thrown value.
 *
 * Redacted, then truncated. The truncation is not cosmetic: viem serialises the entire request body
 * into a transport error, and an encrypted input proof is kilobytes of hex that would push the
 * actual reason off the screen.
 */
export function safeErrorMessage(error: unknown, limit = 400): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactUrls(raw);
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit)}…`;
}

/**
 * The name a custom Solidity error reverted with, when one can be recovered.
 *
 * Delta U-10 in one function: a refusal asserted by prose proves nothing, because a call that failed
 * for an unrelated reason produces prose too. The interface says "refused: ResidualExceeded" only
 * when it can name the error, and says it could not decode one otherwise — never a paraphrase that
 * would read as a decoded name.
 */
export function revertErrorName(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  // viem formats a decoded custom error as `Error: Name(arg, arg)` inside its long message.
  const named = /Error:\s*([A-Z][A-Za-z0-9]*)\(/.exec(message);
  if (named?.[1] !== undefined) return named[1];
  const bare =
    /reverted with (?:the following )?(?:custom error|reason)[:\s]+'?([A-Z][A-Za-z0-9]*)/.exec(
      message,
    );
  return bare?.[1];
}
