/**
 * One encrypted value, in exactly one of the four confidential states `design.md` defines.
 *
 * THE STATE IS NEVER GUESSED. It is derived from `readAcl`, which reads NoxCompute directly, so the
 * interface can never claim a value is readable when the chain says otherwise, and can never show
 * "encrypted" for something that has actually been published.
 *
 * WHAT IS SHOWN WHEN A VALUE CANNOT BE READ. Deliberate redacted structure — never a zero and never
 * sample data. Rendering "0" would be a claim about contents this wallet has no access to, and a
 * plausible-looking number would be worse.
 */

import {
  CONFIDENTIAL_STATE_COPY,
  type ConfidentialState,
  confidentialStateOf,
  type HandleAcl,
} from "@kyrve/nox";

const GLYPH: Record<ConfidentialState | "decrypted-locally", string> = {
  "encrypted-and-unavailable": "▨",
  "available-to-decrypt": "◇",
  "decrypted-locally": "◆",
  "intentionally-public": "○",
};

const LOCAL_COPY = {
  label: "Decrypted locally",
  explanation:
    "Decrypted in this browser. No Kyrve server, log or database received it. Locking the session " +
    "clears it from memory immediately — it does not withdraw any grant, because Nox has none to " +
    "withdraw.",
};

export interface ConfidentialValueProps {
  readonly title: string;
  readonly handle: `0x${string}` | undefined;
  readonly acl: HandleAcl | undefined;
  /** Present only while the session is unlocked and this value has been decrypted. */
  readonly value: bigint | undefined;
  readonly decimals?: number;
  readonly onDecrypt?: () => void;
  readonly busy?: boolean;
  readonly testId?: string;
}

function format(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export function ConfidentialValue({
  title,
  handle,
  acl,
  value,
  decimals = 0,
  onDecrypt,
  busy = false,
  testId,
}: ConfidentialValueProps): React.ReactElement {
  const zeroHandle = handle === undefined || /^0x0+$/.test(handle);

  // A handle that does not exist yet is not an encrypted secret — it is an absence, and saying so
  // is more honest than showing a redaction for something that was never written.
  if (zeroHandle) {
    return (
      <div className="confidential" data-testid={testId}>
        <div className="state">
          <span className="glyph">·</span>
          <span>Nothing recorded</span>
        </div>
        <div className="explanation">
          {title} has no encrypted value on this chain yet. Nothing is hidden here because nothing
          exists here.
        </div>
      </div>
    );
  }

  const state: ConfidentialState | "decrypted-locally" =
    value !== undefined
      ? "decrypted-locally"
      : acl === undefined
        ? "encrypted-and-unavailable"
        : confidentialStateOf(acl);

  const copy = state === "decrypted-locally" ? LOCAL_COPY : CONFIDENTIAL_STATE_COPY[state];
  const canDecrypt = state === "available-to-decrypt" || state === "intentionally-public";

  return (
    <div className="confidential" data-testid={testId} data-state={state}>
      <div className="state">
        <span className="glyph">{GLYPH[state]}</span>
        <span data-testid={testId ? `${testId}-state` : undefined}>{copy.label}</span>
      </div>

      {value !== undefined ? (
        <div className="value" data-testid={testId ? `${testId}-value` : undefined}>
          {format(value, decimals)}
        </div>
      ) : (
        // Structure with no information in it. Not zeroes, not a sample. `role="img"` because it
        // is a picture of absence, and it needs a label a screen reader can read out.
        <div
          className="redacted"
          role="img"
          aria-label={`${title} is encrypted and not readable by this wallet`}
        >
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      <div className="explanation">{copy.explanation}</div>
      <div className="handle">{handle}</div>

      {canDecrypt && value === undefined && onDecrypt !== undefined ? (
        <div>
          <button type="button" onClick={onDecrypt} disabled={busy}>
            {busy ? "Waiting for the Nox runner…" : `Decrypt ${title.toLowerCase()} locally`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
