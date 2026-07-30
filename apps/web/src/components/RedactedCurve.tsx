/**
 * The private yield curve, drawn as structure with no values.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS NOT A CHART AND IT HAS NO DATA SOURCE, WHICH IS THE POINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `.claude/rules/frontend.md` forbids two things that a locked private chart is usually built from:
 * zeroes, and sample data. It also forbids a decorative chart with no real data source. Those look
 * like they cannot all be satisfied at once, and the resolution is that this is not a chart at all —
 * it is a picture of absence, and the shape is generated from the geometry constants below rather
 * than from any measurement.
 *
 * A blur over real numbers would be worse than either, because a blur is reversible in principle and
 * suggests the values are present in the page. Nothing here is derived from a curve, a mandate, an
 * allocation or a rate: there is nothing to recover.
 *
 * `aria-hidden` because there is no information in it to convey. The panels that use it carry the
 * real statement in text alongside — "the curve behind this quote stays private" — which is what a
 * screen reader should read out instead of a description of decoration.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RESOLVED POINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * When a quote has been selected and activated, one point is drawn in Cobalt. That is the thesis in a
 * single mark: many confidential curves exist, exactly one becomes an executable quote. `resolved`
 * is false until a quote genuinely exists, because a cobalt point on a page with no quote would be
 * decoration in the one colour that is never allowed to be decoration.
 */

import type { ReactElement } from "react";

/**
 * The layers, named by their own offset so each path has a stable identity.
 *
 * A list index would do the same job and would be wrong for the same reason it is always wrong: the
 * key would describe a position rather than a thing, and a future edit that reordered or filtered
 * the layers would silently reassign every path's identity.
 */
const LAYER_OFFSETS = [0, 1, 2, 3, 4, 5, 6] as const;
const LAYERS = LAYER_OFFSETS.length;
const SAMPLES = 24;
const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 420;

/**
 * One layer's path.
 *
 * A monotonically rising, decelerating shape — the form a yield curve has — with the layer index
 * shifting amplitude and offset. Deterministic: there is no randomness, so two renders of the same
 * panel are identical and nobody can read a trend into a re-layout.
 */
function layerPath(layer: number): string {
  const amplitude = 0.28 + layer * 0.055;
  const lift = 0.82 - layer * 0.085;
  const points: string[] = [];
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const t = sample / SAMPLES;
    const x = t * VIEW_WIDTH;
    // 1 - (1 - t)^2 rises and decelerates. The vertical axis is inverted in SVG, hence `lift -`.
    const shape = 1 - (1 - t) * (1 - t);
    const y = VIEW_HEIGHT * (lift - amplitude * shape);
    points.push(`${sample === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

export interface RedactedCurveProps {
  readonly className?: string;
  /** Draws the one selected point in Cobalt. Only ever true when a real quote exists. */
  readonly resolved?: boolean;
  /**
   * Where along the curve the selected quote sits, 0 to 1.
   *
   * A POSITION, not a rate. It is derived from the winning leaf's public rate INDEX within the
   * universe's public grid width — both public from activation — so it discloses nothing the quote
   * did not already publish. It is never derived from a price, a spread or an amount.
   */
  readonly at?: number;
  readonly testId?: string;
}

export function RedactedCurve({
  className,
  resolved = false,
  at = 0.62,
  testId,
}: RedactedCurveProps): ReactElement {
  const clamped = Math.min(Math.max(at, 0), 1);
  const pointX = clamped * VIEW_WIDTH;
  // The middle layer, so the resolved point sits inside the field rather than on its edge.
  const middle = Math.floor(LAYERS / 2);
  const shape = 1 - (1 - clamped) * (1 - clamped);
  const pointY = VIEW_HEIGHT * (0.82 - middle * 0.085 - (0.28 + middle * 0.055) * shape);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      data-resolved={resolved}
    >
      {LAYER_OFFSETS.map((layer) => (
        <path
          key={`curve-layer-${layer}`}
          d={layerPath(layer)}
          fill="none"
          stroke="var(--color-ash-text)"
          strokeWidth={1}
          // Reduced opacity per layer: the field reads as many curves at once, none of them legible.
          opacity={0.34 - layer * 0.035}
        />
      ))}

      {resolved ? (
        <circle
          cx={pointX}
          cy={pointY}
          r={7}
          fill="var(--color-cobalt)"
          data-testid="resolved-point"
        />
      ) : null}
    </svg>
  );
}
