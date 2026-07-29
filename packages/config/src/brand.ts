/**
 * The Kyrve brand, in the one place an application is allowed to read it from.
 *
 * `brand.json` at the repository root is the lock — hand-authored policy plus hashes that
 * `scripts/brand/verify-assets.py` re-checks against the bytes on disk. This module is the typed
 * projection of the parts an application needs at build time: asset paths, the colours that end up
 * in `<meta name="theme-color">`, and the web-app manifest.
 *
 * It is deliberately NOT a component library, a stylesheet, or a design-token export. Phase 1 ships
 * brand assets and the metadata that points at them; the frontend is a later phase. Anything that
 * renders belongs there, not here.
 *
 * The prose that governs use — clear space, minimum sizes, permitted lockups, forbidden
 * modifications — is in `docs/brand/KYRVE-BRAND-LOCK.md` and is binding on anything built from this.
 */

export const BRAND_NAME = "Kyrve";

/** Lowercase in product branding; sentence-case in prose, legal text and documentation. */
export const BRAND_WORDMARK = "kyrve";

export const BRAND_TAGLINE = "One quote. The curve stays private.";

export const BRAND_DESCRIPTION =
  "Confidential fixed-income liquidity. Encrypted lender mandates and borrower requirements " +
  "become one executable offer, while the full yield curve, provider allocations, exposure " +
  "limits, rejected alternatives and beneficial ownership stay private.";

/**
 * The palette, as `design.md` defines it. Contrast against the canvas is recomputed by
 * `pnpm brand:verify` rather than trusted here; these are the values it checks.
 */
export const BRAND_COLOURS = {
  /** Page canvas. Also the `theme-color` and the manifest background. */
  onyx: "#171721",
  /** Card surface — one value step above the canvas. There are no shadows in this system. */
  graphite: "#1e1e2a",
  /** Secondary and tertiary controls. */
  obsidian: "#272735",
  /** Secondary text, labels, units. */
  ash: "#c3c3cc",
  /** Body and headings. Never `#ffffff`. */
  ivory: "#ededf3",
  /** The single primary action per page, and the selected quote. Never decoration. */
  cobalt: "#5266eb",
} as const;

export type BrandColour = keyof typeof BRAND_COLOURS;

/** Paths as served, relative to the site root. `public/` is the document root. */
export const BRAND_ASSETS = {
  logo: {
    png: "/brand/logo/kyrve-logo.png",
    webp: "/brand/logo/kyrve-logo.webp",
  },
  symbol: {
    png: "/brand/logo/kyrve-symbol.png",
    webp: "/brand/logo/kyrve-symbol.webp",
  },
  favicon: {
    ico: "/brand/favicon/favicon.ico",
    png16: "/brand/favicon/favicon-16.png",
    png32: "/brand/favicon/favicon-32.png",
    png48: "/brand/favicon/favicon-48.png",
    png192: "/brand/favicon/favicon-192.png",
    png512: "/brand/favicon/favicon-512.png",
    appleTouchIcon: "/brand/favicon/apple-touch-icon.png",
  },
  social: {
    /** Exactly 1200x630. Crawlers reject or re-crop anything else. */
    openGraph: "/brand/social/kyrve-og-1200x630.png",
    openGraphWebp: "/brand/social/kyrve-og-1200x630.webp",
    master: "/brand/social/kyrve-og.png",
  },
  cta: {
    png: "/brand/cta/kyrve-cta.png",
    webp: "/brand/cta/kyrve-cta.webp",
  },
  manifest: "/site.webmanifest",
} as const;

/**
 * The approved mark is authored for LIGHT backgrounds.
 *
 * Measured across all 45,374 opaque pixels of the symbol master: 100% clear 4.5:1 against white,
 * 0.0% clear it against the Onyx canvas, median 1.30:1. There is no approved asset for the symbol
 * on the product canvas, which is exactly where a header needs one.
 *
 * An application header MUST NOT resolve this by recolouring the mark — the brand lock forbids it
 * and `scripts/brand/verify-assets.py` fails if the mark ever starts clearing 4.5:1 on Onyx. The
 * options are recorded in `docs/brand/KYRVE-BRAND-LOCK.md`; the decision is the owner's.
 */
export const HEADER_MARK_PENDING_OWNER_DECISION = true;

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: "any" | "maskable" | "monochrome";
}

export interface WebAppManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

/**
 * The web app manifest. `pnpm generate` writes this to `public/site.webmanifest`, so the served
 * file and the typed value cannot drift apart.
 *
 * No icon is declared `maskable`. A maskable icon must survive a 20% safe-zone crop on every side,
 * and the approved symbol is not authored with that padding — declaring it anyway would let Android
 * crop into the mark. When a maskable variant is needed it has to be authored, not asserted.
 */
export function webAppManifest(): WebAppManifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: BRAND_COLOURS.onyx,
    theme_color: BRAND_COLOURS.onyx,
    icons: [
      { src: BRAND_ASSETS.favicon.png192, sizes: "192x192", type: "image/png" },
      { src: BRAND_ASSETS.favicon.png512, sizes: "512x512", type: "image/png" },
    ],
  };
}

export interface SiteMetadata {
  title: string;
  description: string;
  themeColor: string;
  manifest: string;
  icons: { rel: string; href: string; sizes?: string; type?: string }[];
  openGraph: {
    type: string;
    siteName: string;
    title: string;
    description: string;
    image: string;
    imageWidth: number;
    imageHeight: number;
    imageAlt: string;
  };
  twitter: {
    card: string;
    title: string;
    description: string;
    image: string;
    imageAlt: string;
  };
}

/**
 * Structured metadata for the document head. Framework-agnostic on purpose: a later phase maps this
 * onto whatever the app uses, and does not re-derive the values.
 *
 * `imageAlt` describes the card for a screen reader, and says what the product is rather than
 * naming the file.
 */
export function siteMetadata(): SiteMetadata {
  const title = `${BRAND_NAME} — ${BRAND_TAGLINE}`;
  return {
    title,
    description: BRAND_DESCRIPTION,
    themeColor: BRAND_COLOURS.onyx,
    manifest: BRAND_ASSETS.manifest,
    icons: [
      { rel: "icon", href: BRAND_ASSETS.favicon.ico, sizes: "any" },
      { rel: "icon", href: BRAND_ASSETS.favicon.png32, sizes: "32x32", type: "image/png" },
      { rel: "icon", href: BRAND_ASSETS.favicon.png192, sizes: "192x192", type: "image/png" },
      { rel: "apple-touch-icon", href: BRAND_ASSETS.favicon.appleTouchIcon, sizes: "180x180" },
    ],
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title,
      description: BRAND_DESCRIPTION,
      image: BRAND_ASSETS.social.openGraph,
      imageWidth: 1200,
      imageHeight: 630,
      imageAlt: `${BRAND_NAME} — confidential fixed-income liquidity`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: BRAND_DESCRIPTION,
      image: BRAND_ASSETS.social.openGraph,
      imageAlt: `${BRAND_NAME} — confidential fixed-income liquidity`,
    },
  };
}
