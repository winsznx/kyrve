/**
 * Reads the deployed settlement layer back from chain state and checks it against the manifest.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A MANIFEST IS A CLAIM. THIS IS THE CHECK.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `deploy:settlement` writes what it believes it deployed. This asks the chain, and asks it about
 * the four things that can silently be wrong:
 *
 *   CODE          every address holds code, and its keccak matches BOTH the manifest and the local
 *                 artifact's `deployedBytecode`. A hash matching the manifest but not the artifact
 *                 means the repository no longer describes what is deployed.
 *   SIZE          every deployed runtime is inside EIP-170. The local Nox node allows unlimited
 *                 contract size and cannot be made not to (delta R-10), so the only thing that
 *                 catches an oversize contract before a real chain refuses it is a measurement.
 *   WIRING        every immutable, read from the contract's own getter. A ratifier pointed at
 *                 another deployment's registry would deploy, verify on Etherscan and refuse every
 *                 quote for a reason nothing explains.
 *   BINDINGS      all three one-shot bindings are set. An unbound activator produces a layer that
 *                 looks healthy and reverts `ActivatorNotBound` on the first activation.
 *
 * And `DEPLOYMENT_ID`, recomputed from `(chainId, registry, midnight)` rather than trusted: it is
 * folded into every quote id, so a wrong one means every quote binds to an identity no other
 * contract in the deployment agrees with.
 *
 * Read-only. It sends no transaction and needs no key.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
} from "viem";
import { hardhat, sepolia } from "viem/chains";

import { sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";
const MAX_RUNTIME_BYTES = 24_576;

type Environment = "local" | "sepolia";

interface Deployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly midnight: Address;
  readonly deploymentId: Hex;
  readonly curve: Readonly<Record<string, Address>>;
  readonly addresses: Readonly<Record<string, Address>>;
  readonly runtimeHashes: Readonly<Record<string, Hex>>;
  readonly wiringVerified: readonly string[];
  readonly bindings: readonly string[];
}

interface ImmutableReference {
  readonly start: number;
  readonly length: number;
}

interface Artifact {
  readonly abi: readonly unknown[];
  readonly deployedBytecode: {
    readonly object: Hex;
    readonly immutableReferences?: Readonly<Record<string, readonly ImmutableReference[]>>;
  };
}

/**
 * Replaces every immutable slot with `00` bytes, in both the artifact and the on-chain code.
 *
 * Offsets are in BYTES from the start of the runtime code, so each maps to two hex characters after
 * the `0x` prefix.
 */
function maskImmutables(
  bytecode: Hex,
  references: Readonly<Record<string, readonly ImmutableReference[]>> | undefined,
): string {
  const body = bytecode.slice(2).toLowerCase().split("");
  for (const slots of Object.values(references ?? {})) {
    for (const slot of slots) {
      for (let index = 0; index < slot.length * 2; index += 1) {
        const position = slot.start * 2 + index;
        if (position < body.length) body[position] = "0";
      }
    }
  }
  return body.join("");
}

function artifact(name: string): Artifact {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact for ${name} at ${path}; run \`forge build\``);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

/** The getters whose value must equal a specific other address in this deployment. */
const WIRING: readonly {
  readonly contract: string;
  readonly getter: string;
  readonly target: string;
}[] = [
  { contract: "KyrveQuoteRegistry", getter: "MIDNIGHT", target: "midnight" },
  { contract: "KyrveSettlementRatifier", getter: "REGISTRY", target: "KyrveQuoteRegistry" },
  { contract: "KyrveSettlementRatifier", getter: "MIDNIGHT", target: "midnight" },
  {
    contract: "KyrvePublicResultVerifier",
    getter: "CURVE_VERIFIER",
    target: "curve:CurveResultVerifier",
  },
  { contract: "KyrvePublicResultVerifier", getter: "GRAPH", target: "curve:CurveGraphRegistry" },
  { contract: "KyrvePublicResultVerifier", getter: "ENGINE", target: "curve:NoxCurveEngine" },
  { contract: "KyrvePublicResultVerifier", getter: "EPOCHS", target: "curve:QuoteEpochController" },
  { contract: "QuoteActivator", getter: "REGISTRY", target: "KyrveQuoteRegistry" },
  { contract: "QuoteActivator", getter: "VERIFIER", target: "KyrvePublicResultVerifier" },
  { contract: "QuoteActivator", getter: "UNIVERSES", target: "curve:CurveUniverseRegistry" },
  { contract: "QuoteActivator", getter: "RATIFIER", target: "KyrveSettlementRatifier" },
  { contract: "KyrveQuoteExpiryController", getter: "REGISTRY", target: "KyrveQuoteRegistry" },
  { contract: "KyrveSeriesFactory", getter: "REGISTRY", target: "KyrveQuoteRegistry" },
  { contract: "KyrveSeriesFactory", getter: "ACTIVATOR", target: "QuoteActivator" },
  {
    contract: "KyrveSeriesFactory",
    getter: "EXPIRY_CONTROLLER",
    target: "KyrveQuoteExpiryController",
  },
];

/** The three one-shot bindings, and the getter that proves each landed. */
const BINDINGS: readonly {
  readonly contract: string;
  readonly getter: string;
  readonly target: string;
}[] = [
  { contract: "KyrveQuoteRegistry", getter: "activator", target: "QuoteActivator" },
  {
    contract: "KyrveQuoteRegistry",
    getter: "expiryController",
    target: "KyrveQuoteExpiryController",
  },
  { contract: "QuoteActivator", getter: "factory", target: "KyrveSeriesFactory" },
];

async function main(): Promise<void> {
  const environment: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const path = repoPath(`deployments/${environment}/settlement.json`);
  if (!existsSync(path)) {
    throw new Error(
      `no settlement deployment at ${path}. Deploy with \`pnpm deploy:settlement ${environment}\` — ` +
        "reporting PASS over a missing manifest would be verifying nothing.",
    );
  }
  const deployment = readJson<Deployment>(path);

  const isSepolia = environment === "sepolia";
  const rpc = isSepolia ? sepoliaRpc() : { url: LOCAL_RPC, redacted: LOCAL_RPC };
  const publicClient = createPublicClient({
    chain: isSepolia ? sepolia : hardhat,
    transport: http(rpc.url),
    cacheTime: 0,
  });

  console.log(`verify:settlement — ${environment}\n`);
  console.log(`  RPC       ${rpc.redacted}`);

  const observed = await publicClient.getChainId();
  if (observed !== deployment.chainId) {
    throw new Error(
      `connected chain is ${observed}, but the manifest records ${deployment.chainId}`,
    );
  }

  function resolve(target: string): Address {
    if (target === "midnight") return deployment.midnight;
    if (target.startsWith("curve:")) {
      const key = target.slice("curve:".length);
      const address = deployment.curve[key];
      if (address === undefined)
        throw new Error(`the manifest records no curve address for ${key}`);
      return address;
    }
    const address = deployment.addresses[target];
    if (address === undefined) throw new Error(`the manifest records no address for ${target}`);
    return address;
  }

  // ── Code, hash and size ──────────────────────────────────────────────────────────────────
  console.log("\n  code, runtime hash and EIP-170:");
  for (const [name, address] of Object.entries(deployment.addresses)) {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") throw new Error(`${name} at ${address} has no code`);

    const onChain = keccak256(code);
    const recorded = deployment.runtimeHashes[name];
    if (onChain !== recorded) {
      throw new Error(
        `${name} runtime hash is ${onChain} on chain but ${recorded} in the manifest — the ` +
          "repository no longer describes what is deployed",
      );
    }
    /**
     * The comparison, with IMMUTABLE SLOTS MASKED OUT.
     *
     * Foundry's `deployedBytecode` carries zeroed placeholders wherever an immutable value will be
     * written at construction; the code on chain has the real addresses and hashes in those bytes.
     * A byte-for-byte comparison therefore fails for every contract that has an immutable — which is
     * all six of these — and a first version of this check duly reported the freshly deployed
     * `KyrvePublicResultVerifier` as "not produced by this repository".
     *
     * `immutableReferences` gives the exact offsets and lengths, so both sides are masked and the
     * remaining code — every instruction, every constant, every string — is compared exactly. The
     * immutables themselves are not skipped: the wiring checks below read each one back through its
     * own getter, which is a stronger statement than a byte match anyway.
     */
    const localArtifact = artifact(name);
    const local = localArtifact.deployedBytecode.object;
    const masked = maskImmutables(local, localArtifact.deployedBytecode.immutableReferences);
    const maskedOnChain = maskImmutables(code, localArtifact.deployedBytecode.immutableReferences);
    if (masked !== maskedOnChain) {
      throw new Error(
        `${name} deployed code differs from the local artifact outside its immutable slots. The ` +
          "source in this repository did not produce the code on chain; rebuild, or the deployment " +
          "is from another revision.",
      );
    }

    const bytes = (code.length - 2) / 2;
    if (bytes > MAX_RUNTIME_BYTES) {
      throw new Error(`${name} is ${bytes} bytes, over EIP-170 by ${bytes - MAX_RUNTIME_BYTES}`);
    }
    console.log(
      `  ${name.padEnd(28)} ${String(bytes).padStart(6)} bytes  ${MAX_RUNTIME_BYTES - bytes} to spare`,
    );
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────────────────
  console.log("\n  immutable wiring, read from each contract's own getter:");
  for (const rule of WIRING) {
    const actual = (await publicClient.readContract({
      address: resolve(rule.contract),
      abi: artifact(rule.contract).abi as never,
      functionName: rule.getter,
    })) as Address;
    const expected = resolve(rule.target);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}`);
    }
  }
  console.log(`  ${WIRING.length}/${WIRING.length} checks PASS`);

  // ── Bindings ─────────────────────────────────────────────────────────────────────────────
  console.log("\n  one-shot bindings:");
  for (const rule of BINDINGS) {
    const actual = (await publicClient.readContract({
      address: resolve(rule.contract),
      abi: artifact(rule.contract).abi as never,
      functionName: rule.getter,
    })) as Address;
    const expected = resolve(rule.target);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}. An unbound layer ` +
          "looks healthy and refuses every call.",
      );
    }
    console.log(`  ${rule.contract}.${rule.getter}() -> ${expected}`);
  }

  // ── Deployment id, recomputed ────────────────────────────────────────────────────────────
  const registry = resolve("KyrveQuoteRegistry");
  const onChainId = (await publicClient.readContract({
    address: registry,
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "DEPLOYMENT_ID",
  })) as Hex;
  const recomputed = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }],
      [BigInt(deployment.chainId), registry, deployment.midnight],
    ),
  );
  if (onChainId !== recomputed || onChainId !== deployment.deploymentId) {
    throw new Error(
      `DEPLOYMENT_ID is ${onChainId} on chain, ${recomputed} recomputed and ` +
        `${deployment.deploymentId} in the manifest. It is folded into every quote id.`,
    );
  }
  console.log(`\n  deployment id ${onChainId} (recomputed, matches)`);

  // ── The ratifier's copy of the deployment id ──────────────────────────────────────────────
  const ratifierId = (await publicClient.readContract({
    address: resolve("KyrveSettlementRatifier"),
    abi: artifact("KyrveSettlementRatifier").abi as never,
    functionName: "DEPLOYMENT_ID",
  })) as Hex;
  if (ratifierId !== onChainId) {
    throw new Error(
      `the ratifier's DEPLOYMENT_ID is ${ratifierId}, not the registry's ${onChainId} — it would ` +
        "refuse every quote as unbound",
    );
  }

  console.log(
    `\nverify:settlement PASS — ${Object.keys(deployment.addresses).length} contracts, ` +
      `${WIRING.length} wiring checks, ${BINDINGS.length} bindings, deployment id recomputed\n`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `\nverify:settlement FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
