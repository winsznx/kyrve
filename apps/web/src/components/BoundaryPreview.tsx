/**
 * The public/private boundary, named before the user signs.
 *
 * `.claude/rules/security.md`: any code or UI that moves a value across the line must say so at the
 * point of action. This is that component, and it is used on every submission in the terminal.
 *
 * The two lists are not written by hand. They are derived from `mandateDisclosure` and
 * `requestDisclosure` in `@kyrve/nox`, which build them from the same field list the encoder uses —
 * so a field cannot be encrypted in one place and described as public in the other, and a field
 * added later cannot be silently omitted from the preview.
 *
 * A permanent-disclosure warning renders with no toggle, no `<details>` and no dismiss control. A
 * reveal warning that can be collapsed is a reveal warning that will be.
 */

import type { DisclosurePreview } from "@kyrve/nox";

export interface BoundaryPreviewProps {
  readonly preview: DisclosurePreview;
  readonly action: string;
  readonly testId?: string;
}

export function BoundaryPreview({
  preview,
  action,
  testId,
}: BoundaryPreviewProps): React.ReactElement {
  return (
    <div data-testid={testId}>
      <div className="boundary">
        <div className="public-side">
          <h4>Public the moment you sign</h4>
          <ul data-testid={testId ? `${testId}-public` : undefined}>
            {preview.publicFields.map((field) => (
              <li key={field.name}>
                <strong>{field.name}</strong> — {field.value}
              </li>
            ))}
          </ul>
        </div>

        <div className="private-side">
          <h4>Encrypted before it leaves this browser</h4>
          <ul data-testid={testId ? `${testId}-private` : undefined}>
            {preview.privateFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      </div>

      {preview.permanentDisclosureWarning !== null ? (
        <div className="reveal-warning" role="alert" data-testid={`${testId}-permanent`}>
          <strong>This {action} makes a value public permanently</strong>
          <p>{preview.permanentDisclosureWarning}</p>
        </div>
      ) : (
        <div className="reveal-warning" role="note" data-testid={`${testId}-permanent`}>
          <strong>Nothing here crosses the boundary</strong>
          <p>
            Every field in the right-hand column is sealed encrypted and stays encrypted. This{" "}
            {action} performs no public decryption, so nothing about it becomes readable by anyone
            else. Wrapping and unwrapping are the only paths in Kyrve that cross the line, and they
            say so on their own screens.
          </p>
        </div>
      )}
    </div>
  );
}
