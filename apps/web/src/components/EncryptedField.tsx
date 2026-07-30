/**
 * The Encrypted Field: the whole private book, drawn as unreadable data.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT IS AND WHAT IT REFUSES TO BE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A field of small marks whose DENSITY carries the shape of the capital curve while no individual
 * mark carries a value. It is the product's thesis as a picture: a book exists, it has structure, and
 * you cannot read it.
 *
 * It is not a chart. There is no axis, no label, no rate and no capacity in it, and — the part worth
 * being precise about — nothing in it is derived from data of any kind. `build-dither-assets.py`
 * generates it from one seed and a geometric density function, so it is not a redaction of numbers
 * that were computed and then hidden. There is nothing behind it to recover.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE COBALT POINT IS NEVER IN THE RASTER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It is drawn here, in SVG, at runtime, and only when `resolved` is true — which callers set only
 * when a quote is genuinely public. A cobalt mark compiled into an image would appear on every page
 * that used the asset, including pages where no quote exists, and the one thing that mark must never
 * do is claim a public quote that is not there.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A RASTER AND NOT A CANVAS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A field dense enough to read as data is tens of thousands of marks. As runtime SVG that is hundreds
 * of kilobytes of DOM; as a canvas it is a paint loop on a phone for a picture that never changes.
 * AVIF first, WebP second, PNG last, with explicit dimensions so nothing shifts and a mobile
 * derivative so a handset never fetches a 2400px asset.
 */

import type { ReactElement } from "react";

/** Every generated field, with the intrinsic size the build recorded. Kept in step by the gate. */
const FIELDS = {
  hero: { width: 2400, height: 1200, mobile: true },
  "mechanism-1": { width: 1200, height: 700, mobile: true },
  "mechanism-2": { width: 1200, height: 700, mobile: true },
  "mechanism-3": { width: 1200, height: 700, mobile: true },
  close: { width: 2400, height: 1000, mobile: true },
  matching: { width: 1600, height: 800, mobile: true },
  empty: { width: 1200, height: 600, mobile: true },
} as const;

export type FieldName = keyof typeof FIELDS;

export interface EncryptedFieldProps {
  readonly name: FieldName;
  /**
   * Draws the one selected quote point, in Cobalt.
   *
   * Only ever true when a quote is genuinely public. This is the single most load-bearing boolean in
   * the visual system: the mark means "exactly one thing became public", and showing it otherwise
   * would make it decoration in the one colour that is never allowed to be decoration.
   */
  readonly resolved?: boolean;
  /** Where along the field the resolved point sits, 0 to 1. A position, never a price. */
  readonly at?: number;
  /** The hero is above the fold and is fetched eagerly; everything else waits until it is near. */
  readonly priority?: boolean;
  readonly className?: string;
  readonly testId?: string;
}

export function EncryptedField({
  name,
  resolved = false,
  at = 0.68,
  priority = false,
  className,
  testId,
}: EncryptedFieldProps): ReactElement {
  const field = FIELDS[name];
  const clamped = Math.min(Math.max(at, 0), 1);

  return (
    <div className={className} data-testid={testId} data-field={name} data-resolved={resolved}>
      {/*
        `aria-hidden`, because there is no information in it to convey.

        Every panel that uses a field carries the real statement in text beside it — "the curve stays
        private" — which is what a screen reader should read out. An alt description of decoration
        would be noise in the one place a reader cannot skim past.
      */}
      <picture>
        <source
          type="image/avif"
          srcSet={
            field.mobile
              ? `/brand/field/${name}-900.avif 900w, /brand/field/${name}.avif ${field.width}w`
              : `/brand/field/${name}.avif ${field.width}w`
          }
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet={
            field.mobile
              ? `/brand/field/${name}-900.webp 900w, /brand/field/${name}.webp ${field.width}w`
              : `/brand/field/${name}.webp ${field.width}w`
          }
          sizes="100vw"
        />
        <img
          src={`/brand/field/${name}.png`}
          alt=""
          aria-hidden="true"
          width={field.width}
          height={field.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "low"}
          decoding="async"
          className="field-image"
        />
      </picture>

      {resolved ? (
        /*
          The overlay. One point, one colour, drawn over the field rather than into it.

          `preserveAspectRatio="none"` so it stretches with the raster it sits on, and
          `pointer-events: none` from the stylesheet so it never intercepts a click meant for the
          content above it.
        */
        <svg
          className="field-point"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            cx={clamped * 100}
            cy={pointHeight(clamped)}
            r="0.9"
            fill="var(--color-cobalt)"
            data-testid="resolved-point"
          />
        </svg>
      ) : null}
    </div>
  );
}

/**
 * Where the resolved point sits vertically, in the overlay's own 0-100 space.
 *
 * The same rising, decelerating shape the generator uses for its middle layer, so the point lands ON
 * the trace the raster resolved to rather than near it. Two implementations of one curve is a real
 * risk; this is the middle layer of `curve_y` at `layers // 2`, and the gate compares a rendered
 * sample against the generator's own output.
 */
function pointHeight(t: number): number {
  const shape = 1 - (1 - t) * (1 - t);
  return (0.82 - 4 * (0.42 / 8) - (0.28 + 4 * (0.3 / 8)) * shape) * 100;
}
