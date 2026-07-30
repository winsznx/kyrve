/**
 * `pnpm stack:local:status` — is a local stack running, and is the manifest describing it true?
 *
 * Exits 0 when the stack is live and every health check passes, and 1 otherwise. A consumer that
 * needs a stack can gate on this rather than parsing prose.
 *
 * It reports each service separately, because "the stack is down" and "the keeper is down" call for
 * different actions and a single boolean cannot tell them apart.
 */

import {
  MANIFEST_PATH,
  pidAlive,
  probe,
  probeChainId,
  readLiveManifest,
  readManifest,
} from "./manifest.js";

async function main(): Promise<void> {
  const manifest = readManifest();
  if (manifest === undefined) {
    console.log("\n  no local stack — `.runtime/local-stack.json` does not exist\n");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`  instance     ${manifest.instanceId}`);
  console.log(`  started      ${manifest.startedAt}`);
  console.log(`  manifest     ${MANIFEST_PATH}`);
  console.log(
    `  orchestrator pid ${manifest.orchestratorPid} ${pidAlive(manifest.orchestratorPid) ? "alive" : "GONE"}`,
  );
  console.log(
    `  chain host   pid ${manifest.hostPid} ${pidAlive(manifest.hostPid) ? "alive" : "GONE"}`,
  );
  console.log("");

  for (const service of manifest.services) {
    const healthy = await probe(`${service.url}${service.health}`);
    console.log(`  ${healthy ? "up  " : "DOWN"}  ${service.name.padEnd(14)} ${service.url}`);
  }

  const chainId = await probeChainId(manifest.rpcUrl);
  console.log("");
  console.log(
    chainId === manifest.chainId
      ? `  the node answers chain ${chainId}, which is the chain the manifest names`
      : `  the node answers chain ${chainId ?? "nothing"}, but the manifest names ${manifest.chainId}`,
  );

  const live = await readLiveManifest();
  console.log("");
  if (live.live) {
    console.log("  READY — every check passed\n");
    return;
  }
  console.log(`  NOT READY — ${live.reason}\n`);
  process.exitCode = 1;
}

await main();
