/**
 * The router. Nineteen routes, five of them parameterised, and no dependency.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS HAND-WRITTEN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Not to avoid a library on principle. Because the route table is fixed and small, every path is
 * known at build time, and the whole matcher fits on one screen — so it can be read and checked
 * rather than trusted. A router dependency would also mean a `source-lock.json` entry and an
 * exact-pin obligation for behaviour this file makes explicit in twenty lines.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT MUST GET RIGHT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   REAL HREFS. Every link is an `<a href>` with a real path. Middle-click, cmd-click and
 *   "open in new tab" work, and a screen reader announces a link rather than a button. The
 *   click handler only intercepts a plain left click with no modifier.
 *
 *   REFRESH IS A FIRST-CLASS ENTRY. `/app/series/0xabc…` typed into the address bar must render
 *   the same page as clicking through to it. There is no client-side-only state in a route, which
 *   is why the parameter is in the path rather than in a store — a refresh check that passes for
 *   a route reached by clicking and fails for one reached by typing is the bug this shape avoids.
 *   The dev server, the preview server and the local production server all need an SPA fallback
 *   for this, and `pnpm verify:web` enters every route directly to check that they do.
 *
 *   NO PRIVATE VALUE IN A PATH. A route parameter is always a public identifier — a series id, a
 *   quote id, a capsule id. Never an amount, never a handle paired with a plaintext, never a
 *   decrypted value. `.claude/rules/security.md` forbids a decrypted value reaching a URL, and a
 *   URL is the one piece of page state that lands in history, in a referrer and in a screenshot.
 */

import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

/** A route pattern. `:name` matches one path segment and captures it. */
export interface RouteDefinition {
  readonly path: string;
  readonly title: string;
  /** One-sentence page description, used for `<meta name="description">`. */
  readonly description: string;
  readonly render: (params: Readonly<Record<string, string>>) => ReactElement;
}

export interface Match {
  readonly route: RouteDefinition;
  readonly params: Readonly<Record<string, string>>;
}

interface Location {
  readonly pathname: string;
  readonly search: string;
}

const LocationContext = createContext<Location>({ pathname: "/", search: "" });

function currentLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Subscribers are notified on `popstate` and on every `navigate`. */
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Pushes a path and tells every subscriber.
 *
 * Exported because a handful of flows navigate as a consequence of a confirmed transaction rather
 * than of a click — submitting a request lands on the request's own page, for instance. Those are
 * always driven by a chain event, never by an optimistic guess about one.
 */
export function navigate(to: string, options: { readonly replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  announce();
}

export function useLocation(): Location {
  return useContext(LocationContext);
}

/** Splits a path into segments, ignoring the leading and trailing slash. */
function segments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Matches a pathname against the table, in declaration order.
 *
 * Order matters and the table is written to depend on it: `/app/quotes` is declared before
 * `/app/quotes/:quoteId`, so the collection page wins its own path and only a longer path reaches
 * the detail route. A static segment always beats a parameter at the same depth, which is checked
 * by segment comparison rather than by a scoring heuristic.
 */
export function matchRoute(
  routes: readonly RouteDefinition[],
  pathname: string,
): Match | undefined {
  const actual = segments(pathname);

  for (const route of routes) {
    const pattern = segments(route.path);
    if (pattern.length !== actual.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index] as string;
      const found = actual[index] as string;
      if (expected.startsWith(":")) {
        // An empty parameter is not a match. `/app/series/` must be a 404, not a detail page
        // rendering with an empty id — which would read the chain for `0x` and report nonsense.
        if (found.length === 0) {
          matched = false;
          break;
        }
        params[expected.slice(1)] = decodeURIComponent(found);
        continue;
      }
      if (expected !== found) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }

  return undefined;
}

export interface RouterProps {
  readonly routes: readonly RouteDefinition[];
  /** Rendered when nothing matches. Receives the pathname that did not match. */
  readonly notFound: (pathname: string) => ReactElement;
  /** Wraps every page. Receives the match so the shell can mark the active navigation item. */
  readonly children: (match: Match | undefined, page: ReactElement) => ReactNode;
}

export function Router({ routes, notFound, children }: RouterProps): ReactElement {
  const [location, setLocation] = useState<Location>(currentLocation);

  useEffect(() => {
    const update = (): void => setLocation(currentLocation());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  const match = matchRoute(routes, location.pathname);
  const page = match === undefined ? notFound(location.pathname) : match.route.render(match.params);

  /**
   * The document title and description follow the route.
   *
   * Set here rather than in each page so a route cannot ship without them: the table requires both
   * fields, and this effect is the only writer. `pnpm verify:web` checks every route's
   * rendered title against the table.
   */
  useEffect(() => {
    const title = match?.route.title ?? "Not found";
    document.title = `${title} — kyrve`;
    const description =
      match?.route.description ??
      "This path does not exist in the Kyrve terminal. Nothing was read and nothing was written.";
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (tag === null) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = description;
  }, [match]);

  return (
    <LocationContext.Provider value={location}>{children(match, page)}</LocationContext.Provider>
  );
}

export interface LinkProps {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
  /** Set when the link is the page's single primary action. Exactly one per page may be cobalt. */
  readonly "data-testid"?: string;
  readonly "aria-current"?: "page";
  /*
    A link that is visually hidden must also leave the tab order and the accessibility tree.
    Opacity does neither, so a faded control stays reachable by keyboard and still announced.
  */
  readonly tabIndex?: number;
  readonly "aria-hidden"?: boolean;
  readonly "data-visible"?: boolean;
}

/**
 * An anchor that navigates without a reload — and stays an anchor.
 *
 * Modified clicks, non-left buttons and defaulted-prevented events all fall through to the
 * browser, so `cmd+click` opens a tab and the middle button does what the middle button does.
 */
export function Link({ to, children, className, ...rest }: LinkProps): ReactElement {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
