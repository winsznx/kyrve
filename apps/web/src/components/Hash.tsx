/**
 * Every address, transaction and identifier on screen, linked where a link exists.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS ONE COMPONENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The product was rendering dozens of hex strings as plain monospace text. Every one of them is a
 * real thing on a real chain, and a reader who wants to check a claim had to select the text, copy
 * it, find an explorer and paste it. That is the difference between "verifiable in principle" and
 * "verifiable" — and this product's entire argument is the second one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A LINK IS ONLY OFFERED WHERE IT RESOLVES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A local chain has no explorer. On chain 31337 these render as plain text with a copy control and
 * no link, because a link to an explorer that does not know this chain is worse than no link: it
 * looks like verification and produces a "not found" page.
 *
 * The `kind` also decides the path. An address and a transaction hash are both 0x-prefixed hex and
 * they go to different places; a series id or a handle goes nowhere at all, because it is a Kyrve or
 * a Nox identifier and no block explorer has ever heard of it. Those render with a copy control and
 * the honest absence of a link.
 */

import { type ReactElement, useState } from "react";

import { useKyrve } from "../lib/context.js";

/** Where a value lives, which decides whether a link exists and what it points at. */
export type HashKind =
  /** An account or contract. Resolves on an explorer. */
  | "address"
  /** A transaction. Resolves on an explorer. */
  | "tx"
  /** A block. Resolves on an explorer. */
  | "block"
  /**
   * A Kyrve or Nox identifier — a series id, quote id, capsule id, graph root, epoch id or handle.
   *
   * No explorer knows these. They are copyable and never linked, because a link that 404s teaches a
   * reader that verification does not work here.
   */
  | "id";

/** Explorers by chain. Absent means no explorer, which is the honest state for a local node. */
const EXPLORER: Readonly<Record<number, string>> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  421614: "https://sepolia.arbiscan.io",
};

export interface HashProps {
  readonly value: string | undefined;
  readonly kind: HashKind;
  /** Shows the whole value rather than an abbreviation. For a page's subject. */
  readonly full?: boolean;
  /** Overrides the chain, for a value that belongs to a chain other than the connected one. */
  readonly chainId?: number;
  readonly testId?: string;
}

export function Hash({ value, kind, full = false, chainId, testId }: HashProps): ReactElement {
  const { record } = useKyrve();
  const [copied, setCopied] = useState(false);

  if (value === undefined || value.length === 0) {
    return <span className="tagline">— not recorded</span>;
  }

  const chain = chainId ?? record.chainId;
  const base = EXPLORER[chain];
  const shown = full || value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;

  const href =
    base === undefined || kind === "id"
      ? undefined
      : kind === "address"
        ? `${base}/address/${value}`
        : kind === "tx"
          ? `${base}/tx/${value}`
          : `${base}/block/${value}`;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value as string);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // A clipboard permission refusal is not an error worth surfacing: the value is on screen and
      // selectable, which is what the copy control was a convenience for.
    }
  }

  return (
    <span className="hashref" data-testid={testId} data-kind={kind}>
      {href === undefined ? (
        <span className="mono" title={value}>
          {shown}
        </span>
      ) : (
        <a
          className="mono hashref-link"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`${value} — opens ${new URL(base as string).host}`}
        >
          {shown}
        </a>
      )}
      <button
        type="button"
        className="hashref-copy"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : `Copy ${kind === "id" ? "identifier" : kind}`}
      >
        {copied ? "copied" : "copy"}
      </button>
      {href === undefined && kind !== "id" ? (
        <span className="hashref-note" title={`Chain ${chain} has no block explorer`}>
          local
        </span>
      ) : null}
    </span>
  );
}
