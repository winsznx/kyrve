/**
 * `/proof/deployment` — every address in the record, checked against the chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * "THERE IS CODE AT THIS ADDRESS" IS A REAL CHECK AND A SMALL ONE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `getCode` proves the record does not name an empty account, which is the failure mode of a record
 * describing a deployment that was replaced. It does NOT prove the code is the code that was
 * audited, and this page does not claim it does — bytecode comparison against locally compiled
 * artifacts is `pnpm verify:deployed-bytecode`, which runs against a compiled tree a browser does
 * not have. That is stated rather than glossed.
 *
 * Etherscan source verification is in the same category and is worse: the record carries a count of
 * verified contracts, and this browser did not call Etherscan. It is reported as
 * `reported-not-verified` rather than dropped, because dropping it hides a claim and listing it as
 * verified would misstate who checked.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONFIDENTIAL LAYER HAS NO STATIC ANALYSIS AND THIS PAGE SAYS SO ON EVERY RENDER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * crytic-compile cannot be made to drive solc 0.8.36 (delta U-5). That gap is open, and P7-1 requires
 * Phase 7 not to let a green page imply otherwise. It appears here as a check with the
 * `reported-not-verified` verdict so it lands in the downloadable artefact too.
 */

import type { ReactElement } from "react";

import { Facts } from "../components/Facts.js";
import { VerifyPanel } from "../components/VerifyPanel.js";
import type { Check } from "../lib/artefact.js";
import { useKyrve } from "../lib/context.js";
import { layersOf } from "../lib/records.js";
import { Link } from "../router/router.js";

export function ProofDeployment(): ReactElement {
  const { record, publicClient } = useKyrve();
  const layers = layersOf(record);

  async function run(): Promise<readonly Check[]> {
    const found: Check[] = [];

    // ── 1. the chain the browser reached is the chain the record names ─────────────────────
    const chainId = await publicClient.getChainId();
    found.push(
      chainId === record.chainId
        ? {
            id: "chain",
            claim: "the node this browser reached serves the chain the record names",
            verdict: "verified",
            detail: "the chain id matches",
            measured: { "chain id": String(chainId), environment: record.environment },
          }
        : {
            id: "chain",
            claim: "the node this browser reached serves the chain the record names",
            verdict: "failed",
            detail:
              "the node serves a different chain than the record describes. Every address below " +
              "would be read on the wrong chain, and an interface answering from the wrong chain is " +
              "worse than one that is down.",
            measured: {
              "on chain": String(chainId),
              "in the record": String(record.chainId),
            },
          },
    );

    // ── 2. every named address holds deployed code ────────────────────────────────────────
    const named: {
      readonly group: string;
      readonly name: string;
      readonly address: `0x${string}`;
    }[] = Object.entries(record.addresses).map(([name, address]) => ({
      group: "confidential books",
      name,
      address: address as `0x${string}`,
    }));

    for (const layer of layers) {
      for (const [name, address] of Object.entries(layer.series.addresses)) {
        named.push({ group: `${layer.label} series`, name, address: address as `0x${string}` });
      }
      for (const [name, address] of Object.entries(layer.market?.addresses ?? {})) {
        if (address === undefined) continue;
        named.push({ group: `${layer.label} market`, name, address: address as `0x${string}` });
      }
    }

    const empty: string[] = [];
    for (const entry of named) {
      const code = await publicClient.getCode({ address: entry.address });
      if (code === undefined || code === "0x") empty.push(`${entry.name} (${entry.address})`);
    }

    found.push(
      empty.length === 0
        ? {
            id: "code",
            claim: "every address the record names holds deployed code on this chain",
            verdict: "verified",
            detail:
              "checked with getCode. This proves the record does not name an empty account. It does " +
              "NOT prove the code is the code that was audited — bytecode comparison against locally " +
              "compiled artifacts is `pnpm verify:deployed-bytecode`, which needs a compiled tree a " +
              "browser does not have.",
            measured: { "addresses checked": String(named.length) },
          }
        : {
            id: "code",
            claim: "every address the record names holds deployed code on this chain",
            verdict: "failed",
            detail:
              "one or more addresses in the record are empty accounts on this chain. The record is " +
              "describing a deployment that is not here.",
            measured: {
              "addresses checked": String(named.length),
              "empty accounts": empty.join(", "),
            },
          },
    );

    // ── 3. the two layers share no contract ──────────────────────────────────────────────
    if (layers.length < 2) {
      found.push({
        id: "layer-separation",
        claim: "the two issuance stacks share no contract",
        verdict: "unavailable",
        detail:
          "this deployment has fewer than two issuance stacks, so there is no separation to check. " +
          "One custody vault serves exactly one series, and a second needs a whole second stack.",
        measured: { "layers in the record": String(layers.length) },
      });
    } else {
      const first = new Set(
        Object.values(layers[0]?.series.addresses ?? {}).map((a) => String(a).toLowerCase()),
      );
      const shared = Object.entries(layers[1]?.series.addresses ?? {})
        .filter(([, address]) => first.has(String(address).toLowerCase()))
        .map(([name]) => name);
      found.push({
        id: "layer-separation",
        claim: "the two issuance stacks share no contract",
        verdict: shared.length === 0 ? "verified" : "failed",
        detail:
          shared.length === 0
            ? "zero shared addresses. A roll between two 'series' that shared a custody vault or an " +
              "engine would prove nothing, and one shared address is enough to make the claim false."
            : "the two layers share at least one contract, so they are not two independent stacks",
        measured:
          shared.length === 0
            ? {
                "contracts per layer": String(
                  Object.keys(layers[0]?.series.addresses ?? {}).length,
                ),
              }
            : { shared: shared.join(", ") },
      });
    }

    // ── 4. compiler pins: reported, not verified here ────────────────────────────────────
    found.push({
      id: "compiler-pins",
      claim: "the settlement layer is solc 0.8.34 and the confidential layer is solc 0.8.36",
      verdict: "reported-not-verified",
      detail:
        "The two pins are mutually exclusive and deliberate: nox-protocol-contracts requires ^0.8.35 " +
        "while the Midnight substrate is pinned at 0.8.34 for bytecode comparability. This browser " +
        "did not compile anything and cannot check it — `pnpm verify:deployed-bytecode` and " +
        "`pnpm verify:curve-abi` are what do.",
      measured: {
        "settlement layer": "solc 0.8.34, evm osaka, via-ir, bytecode_hash none",
        "confidential layer": "solc 0.8.36, evm osaka, via-ir",
      },
    });

    // ── 5. static analysis: the gap, named on every render ───────────────────────────────
    found.push({
      id: "slither",
      claim: "static analysis over the confidential contract layer",
      verdict: "reported-not-verified",
      detail:
        "UNVERIFIED BY SLITHER. crytic-compile will not drive solc 0.8.36 (delta U-5, with the exact " +
        "reproduction). The compensating evidence is real — direct 0.8.36 compilation, the full unit " +
        "and integration suite against real Nox, the attack suite, contract-size and gas-cap checks — " +
        "and it is not the same thing. The settlement layer, which Slither CAN reach, is analysed.",
      measured: { "confidential layer": "no static-analysis coverage" },
    });

    return found;
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">Verification</span>
        <h1>Deployment</h1>
        <p className="lede">
          The record names which addresses to ask about. Everything below is what this chain
          answered.
        </p>
        <Facts
          testId="deployment-facts"
          facts={[
            { label: "Environment", value: record.environment },
            { label: "Chain id in the record", value: String(record.chainId) },
            { label: "NoxCompute", value: <span className="mono">{record.noxCompute}</span> },
            { label: "Issuance stacks", value: String(layers.length) },
          ]}
        />
        <p className="note">
          <Link to="/proof" className="row-link">
            Everything else this deployment can verify
          </Link>
        </p>
      </section>

      <VerifyPanel
        subject="deployment"
        subjectId={record.environment}
        layer={undefined}
        run={run}
        deps={[record.chainId, layers.length]}
      />
    </>
  );
}
