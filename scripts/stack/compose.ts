/**
 * The Docker sweep, in its own module so importing it cannot start a stack.
 *
 * It lived in `local.ts` first, which was a latent trap: `local.ts` runs `main()` at module scope,
 * so `pnpm stack:local:stop` importing a function from it would have STARTED a stack on the way to
 * stopping one. A shared helper that boots a system as a side effect of being imported is the kind
 * of defect that only shows up in the command written last.
 */

import { run } from "../lib/shell.js";

/**
 * Brings the Nox compose project down regardless of who started it.
 *
 * The project directory belongs to the plugin, not to this repository — the plugin ships its own
 * `offchain-services/` with the compose file and `dev.env` — so the path is resolved rather than
 * hardcoded, and a version bump that moves it degrades to "nothing to sweep" instead of to a
 * confident sweep of the wrong project.
 *
 * Allowed to fail. The usual case is that the chain host already ran `docker compose down` in its
 * own teardown and there is nothing left, and a sweep that threw on success would make every clean
 * shutdown look like a failure.
 */
export function sweepCompose(): void {
  const directory = run("bash", [
    "-c",
    "ls -d node_modules/.pnpm/@iexec-nox+nox-hardhat-plugin@*/node_modules/@iexec-nox/nox-hardhat-plugin/offchain-services 2>/dev/null | head -1",
  ]).stdout.trim();
  if (directory.length === 0) return;

  run(
    "bash",
    [
      "-c",
      `cd ${JSON.stringify(directory)} && docker compose --env-file dev.env down --volumes --remove-orphans`,
    ],
    { allowFailure: true },
  );
}
