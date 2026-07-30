/**
 * A path that does not exist.
 *
 * It says what it did NOT do, which matters more here than on an ordinary site: nothing was read from
 * the chain and nothing was written, so a mistyped series id cannot have left a trace. The path is
 * echoed so a broken link can be reported, and it is echoed as text rather than interpolated into
 * anything — a 404 that reflected its own path into markup would be a cross-site scripting hole on
 * the one page nobody reviews.
 */

import type { ReactElement } from "react";

import { Link } from "../router/router.js";

export function NotFound({ pathname }: { pathname: string }): ReactElement {
  return (
    <section className="band">
      <h1>This path does not exist</h1>
      <p className="lede" data-testid="not-found">
        Nothing was read from the chain and nothing was written.{" "}
        <span className="mono">{pathname}</span> is not a route in this terminal.
      </p>
      <p className="lede">
        A series, quote or capsule identifier belongs in the path — <code>/app/series/0x…</code>,{" "}
        <code>/app/quotes/0x…</code>, <code>/proof/capsule/0x…</code> — and an identifier this
        deployment does not know renders as "not on this deployment" rather than falling back to
        another one.
      </p>
      <div className="actions">
        <Link to="/app" className="ghost">
          Overview
        </Link>
        <Link to="/proof" className="ghost">
          Verify
        </Link>
      </div>
    </section>
  );
}
