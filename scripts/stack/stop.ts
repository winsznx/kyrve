/**
 * `pnpm stack:local:stop` — stop a running stack, or clean up after one that died badly.
 *
 * Two jobs, and the second is the reason this exists as a separate command rather than as Ctrl+C.
 *
 * When the orchestrator is alive, SIGTERM is all that is needed: its own handler tears the children
 * down in order, gives the chain host time to run `docker compose down`, and removes the manifest.
 *
 * When it is not — a crash, a killed terminal, a laptop that slept — there is no handler to run, and
 * what is left behind is six Docker containers and a manifest that says a stack is up. So this
 * command sweeps compose directly and removes the manifest regardless. Sweeping when there is
 * nothing to sweep is harmless; not sweeping leaves the next `pnpm stack:local` failing on a bound
 * port, one process ago.
 */

import { run } from "../lib/shell.js";
import { sweepCompose } from "./compose.js";
import { MANIFEST_PATH, pidAlive, readManifest, removeManifest } from "./manifest.js";

/** The ports `stack:local` binds. Fixed, so a sweep knows exactly what to look for. */
const STACK_PORTS = [4173, 8788, 8789, 8790, 8791] as const;

/**
 * Kills a leftover child that is still holding one of the stack's ports.
 *
 * NARROW ON PURPOSE. It kills a process only when it is bound to one of our ports AND its command
 * line is one of the three things this stack starts. Killing whatever holds a port would eventually
 * kill somebody's editor or their own dev server, and a cleanup command that does that is worse than
 * the orphan it was cleaning up.
 *
 * This is a backstop. The orchestrator puts every child in its own process group and signals the
 * group, which is what should make this find nothing — but "should" is how the orphan got there in
 * the first place: `npx` is an intermediate process, so SIGTERM to the child reaped `npx` and left a
 * `vite preview` holding port 4173 with its parent already exited.
 */
function sweepPorts(): void {
  for (const port of STACK_PORTS) {
    // `-nP -iTCP:<port> -sTCP:LISTEN -t`, not `-ti :<port>`. The short form matches a port in either
    // direction and silently returned nothing here for a listener it should have found; the explicit
    // form asks the one question that matters — who is LISTENING on this port.
    const pids = run("bash", ["-c", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`])
      .stdout.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const pid of pids) {
      const command = run("bash", ["-c", `ps -o command= -p ${pid} 2>/dev/null || true`]).stdout;
      /*
       * Recognised by what this stack actually launches, which is not what it types.
       *
       * `wrangler dev` execs a `workerd` binary, so a process holding port 8788 shows as
       * `@cloudflare/workerd-darwin-arm64/…/workerd` with no mention of wrangler at all. Matching
       * the typed command left every Worker orphaned while reporting "held by something this stack
       * did not start" — a sweep that politely declined to clean up after itself.
       */
      const ours =
        /vite[/\\].*preview|vite\.js preview/.test(command) ||
        /workerd/.test(command) ||
        /wrangler/.test(command) ||
        /hardhat/.test(command);
      if (!ours) {
        console.log(
          `  port ${port} is held by something this stack did not start; leaving it alone`,
        );
        continue;
      }
      /*
       * The whole group, and the supervisor with it.
       *
       * `wrangler dev` is a supervisor: killing the `workerd` child it spawned makes it start
       * another, so the port stays bound and the sweep reports success. Measured — four ports were
       * still listening after four "killed leftover" lines. So the listener's process GROUP goes,
       * and the wrangler invocation for this exact port goes with it.
       */
      console.log(`  killing leftover on port ${port}: pid ${pid}`);
      run("bash", ["-c", `pkill -9 -f "wrangler dev --local --port ${port}" 2>/dev/null || true`], {
        allowFailure: true,
      });
      run("bash", ["-c", `kill -9 -$(ps -o pgid= -p ${pid} | tr -d ' ') 2>/dev/null || true`], {
        allowFailure: true,
      });
      run("bash", ["-c", `kill -9 ${pid} 2>/dev/null || true`], { allowFailure: true });
    }
  }
}

async function main(): Promise<void> {
  const manifest = readManifest();

  if (manifest === undefined) {
    console.log(
      "\n  no runtime manifest. Sweeping the Docker stack and the stack's ports anyway,\n" +
        "  in case a previous run was killed before it could clean up.\n",
    );
    sweepCompose();
    sweepPorts();
    console.log("  done\n");
    return;
  }

  if (pidAlive(manifest.orchestratorPid)) {
    console.log(
      `\n  stopping instance ${manifest.instanceId} (orchestrator pid ${manifest.orchestratorPid})`,
    );
    process.kill(manifest.orchestratorPid, "SIGTERM");

    // Its handler removes the manifest as its first act, so the file disappearing is the signal that
    // the orderly path is running. Waiting on the pid alone would not distinguish "shutting down
    // cleanly" from "wedged".
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      if (readManifest() === undefined && !pidAlive(manifest.orchestratorPid)) {
        // Even on the clean path, sweep. The orchestrator signals process groups now, so this
        // should find nothing — and a cleanup that only runs on the failure path is a cleanup
        // nobody exercises until the day it is needed.
        sweepPorts();
        console.log("  stopped cleanly\n");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("  the orchestrator did not stop in time; sweeping directly");
  } else {
    console.log(
      `\n  the manifest names orchestrator pid ${manifest.orchestratorPid}, which is gone. It is ` +
        "stale: sweeping whatever it left behind.",
    );
  }

  sweepCompose();
  sweepPorts();
  removeManifest();
  console.log(`  removed ${MANIFEST_PATH}\n`);
}

await main();
