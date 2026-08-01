/**
 * `/app/start` — four steps between arriving and doing something.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ROLE FIRST, WALLET SECOND
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The order is deliberate and was the wrong way round before. Asking for a wallet first means asking
 * somebody to authorise a connection to a product they have not been told the shape of — and the
 * three shapes are genuinely different: a provider commits capital, a borrower asks for one quote, an
 * auditor reads one frozen value.
 *
 * Choosing a role costs nothing, grants nothing, and can be changed from the header at any time. It
 * is a lens, and saying so on this screen is what stops it reading as a commitment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE READINESS CHECK IS FOR A USER, NOT FOR AN OPERATOR
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Five lines: network, wallet, confidential runtime, market, and whether the chosen role can start.
 * Each is a sentence a non-engineer can act on. The developer view of the same facts still exists —
 * `/proof/deployment` recomputes every address against chain state — and is one link away rather
 * than the default.
 *
 * A failing line never blocks the flow. It says what will not work yet and lets the reader continue,
 * because a readiness screen that refuses to let anybody past is a readiness screen nobody reads.
 */

import { type ReactElement, useEffect, useState } from "react";

import { RedactedCurve } from "../components/RedactedCurve.js";
import { useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layersOf, settlementsOf } from "../lib/records.js";
import { ROLE_COPY, ROLES } from "../lib/role.js";
import { Link, navigate } from "../router/router.js";

export function Start(): ReactElement {
  const kyrve = useKyrve();
  const {
    record,
    publicClient,
    session,
    walletState,
    connect,
    role,
    chooseRole,
    completeOnboarding,
  } = kyrve;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(role === undefined ? 1 : 2);

  // Choosing a role is what advances step one; connecting is what advances step two. Both are read
  // from real state rather than from a click, so a reader who arrives already connected is not asked
  // to connect again.
  useEffect(() => {
    if (step === 2 && session !== undefined) setStep(3);
  }, [step, session]);

  const readiness = useChainRead(async () => {
    const chainId = await publicClient.getChainId();
    const block = await publicClient.getBlockNumber();
    return { chainId, block };
  }, [record.chainId]);

  const layers = layersOf(record);
  const marketReady = layers.length > 0 || settlementsOf(record).length > 0;

  return (
    <div className="start">
      <RedactedCurve className="start-field" resolved={false} testId="start-field" />

      <div className="start-inner">
        <header className="start-head">
          <span className="wordmark">kyrve</span>
          <Link to="/" className="row-link">
            Back to Kyrve
          </Link>
        </header>

        <ol className="steps" data-testid="onboarding-steps">
          {["Choose your role", "Connect your wallet", "Check readiness", "Begin"].map(
            (label, index) => (
              <li
                key={label}
                className={
                  index + 1 === step
                    ? "step step-current"
                    : index + 1 < step
                      ? "step step-done"
                      : "step"
                }
                {...(index + 1 === step ? { "aria-current": "step" as const } : {})}
              >
                <span className="step-number">{index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>

        {step === 1 ? (
          <section data-testid="step-role">
            <h1>Choose your workspace</h1>
            <p className="lede">
              Choose the job you are here to do. This only changes the guidance Kyrve shows first.
              It grants nothing, hides nothing, and you can change it from the account menu.
            </p>
            <div className="role-cards">
              {ROLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="role-card"
                  onClick={() => {
                    chooseRole(option);
                    setStep(session === undefined ? 2 : 3);
                  }}
                  data-testid={`choose-role-${option}`}
                >
                  <strong>{ROLE_COPY[option].label}</strong>
                  <span>{ROLE_COPY[option].promise}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section data-testid="step-wallet">
            <h1>Connect the wallet you will use</h1>
            <p className="lede">
              Your wallet encrypts submissions and decrypts only values you are authorised to view.
              <strong> Kyrve does not send decrypted balances to its server.</strong> They exist in
              this browser's memory and are cleared the moment you lock the session.
            </p>
            <p className="lede">
              Use the wallet that will sign your actions. Kyrve binds each encrypted submission to
              that wallet.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => void connect()}
                disabled={walletState === "connecting"}
                data-testid="start-connect"
              >
                {walletState === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
              </button>
              <button type="button" onClick={() => setStep(1)} data-testid="start-change-role">
                Choose a different role
              </button>
              <button type="button" onClick={() => setStep(3)} data-testid="start-skip-wallet">
                Continue without one
              </button>
            </div>
            <p className="note">
              Settlement evidence, deployment facts and verification all work without a wallet. Only
              your own confidential values need one.
            </p>
          </section>
        ) : null}

        {step === 3 ? (
          <section data-testid="step-readiness">
            <h1>Check your connection</h1>
            <p className="lede">
              A quick check that this deployment can do what you are about to ask of it.
            </p>
            <ul className="readiness" data-testid="readiness">
              <Check
                ok={readiness.value !== undefined && readiness.value.chainId === record.chainId}
                pending={readiness.state !== "done" && readiness.state !== "unavailable"}
                label="Network"
                good={`Connected to ${record.environment}, chain ${record.chainId}`}
                bad="The node did not answer, so nothing on chain can be read yet"
              />
              <Check
                ok={session !== undefined}
                pending={walletState === "connecting"}
                label="Wallet"
                good="Ready to sign and to decrypt your own values"
                bad="Not connected. Public pages work; your own values will not be readable"
              />
              <Check
                ok={record.gatewayUrl !== undefined || record.chainId !== 31337}
                pending={false}
                label="Confidential runtime"
                good="A Nox handle gateway is configured for this deployment"
                bad="No handle gateway is configured for this chain"
              />
              <Check
                ok={marketReady}
                pending={false}
                label="Market"
                good={`${layers.length} settled series available`}
                bad="No settled series yet. You can still submit, but no position can settle until matching runs"
              />
              <Check
                ok={role !== undefined}
                pending={false}
                label="Role"
                good={`Set up for ${role === undefined ? "" : ROLE_COPY[role].label.toLowerCase()}`}
                bad="No role chosen"
              />
            </ul>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => setStep(4)}
                data-testid="start-readiness-continue"
              >
                Continue
              </button>
              <Link to="/proof/deployment" className="row-link">
                See the technical deployment check instead
              </Link>
            </div>
          </section>
        ) : null}

        {step === 4 && role !== undefined ? (
          <section data-testid="step-begin">
            <h1>{ROLE_COPY[role].firstTask}</h1>
            <p className="lede">{ROLE_COPY[role].promise}</p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  completeOnboarding();
                  navigate(ROLE_COPY[role].firstTaskPath);
                }}
                data-testid="start-begin"
              >
                {ROLE_COPY[role].firstTask}
              </button>
              <button
                type="button"
                onClick={() => {
                  completeOnboarding();
                  navigate("/app");
                }}
                data-testid="start-home"
              >
                Go to workspace
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** One readiness line. Never blocks; says what will not work and lets the reader continue. */
function Check({
  ok,
  pending,
  label,
  good,
  bad,
}: {
  ok: boolean;
  pending: boolean;
  label: string;
  good: string;
  bad: string;
}): ReactElement {
  return (
    <li data-testid={`readiness-${label.toLowerCase().replace(/\s+/g, "-")}`} data-ok={ok}>
      <span className="readiness-mark" aria-hidden="true">
        {pending ? "·" : ok ? "◆" : "◇"}
      </span>
      <span className="readiness-label">{label}</span>
      <span className="readiness-detail">{pending ? "checking…" : ok ? good : bad}</span>
    </li>
  );
}
