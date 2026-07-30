/**
 * The tagline moment: one sentence that resolves word by word as it is read.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE MOTION IS THE ARGUMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The sentence is about a market that settles a price without seeing the book behind it, and the
 * words arrive out of a muted state one at a time — the same thing the product does, performed by
 * the type. It is the one place in Kyrve where motion carries meaning rather than polish, which is
 * why it is the only sustained animation in the interface.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE OBSERVER PER WORD, NEVER A SCROLL LISTENER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `IntersectionObserver` fires off the main thread and does not run on every scroll frame. An
 * unthrottled `scroll` handler over thirty words would run thirty style writes per frame on a phone,
 * for an effect whose whole point is calm.
 *
 * Each word resolves once and stays resolved. A sentence that re-muted on scroll-up would read as a
 * broken effect rather than as a deliberate one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * REDUCED MOTION IS A DIFFERENT DESIGN, NOT A DISABLED ONE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * With `prefers-reduced-motion` the sentence renders fully resolved from the start. It is not the
 * animation with a zero duration — that would still flash — it is simply the finished state, which is
 * what somebody who asked for less motion wanted to see.
 */

import { type ReactElement, useEffect, useRef, useState } from "react";

export interface TaglineRevealProps {
  readonly children: string;
  readonly testId?: string;
}

export function TaglineReveal({ children, testId }: TaglineRevealProps): ReactElement {
  const container = useRef<HTMLParagraphElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    if (query.matches) return;
    const node = container.current;
    if (node === null) return;

    const words = [...node.querySelectorAll<HTMLElement>("[data-word]")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          // The stagger is by index rather than by a timer chain, so a fast scroll past the section
          // still resolves every word instead of leaving a half-lit sentence behind.
          const index = Number(element.dataset["index"] ?? 0);
          element.style.transitionDelay = `${Math.min(index * 45, 900)}ms`;
          element.dataset["lit"] = "true";
          observer.unobserve(element);
        }
      },
      // A band across the middle of the viewport: words light as they pass the reading line, not
      // when the section's top edge appears.
      { rootMargin: "-30% 0px -30% 0px", threshold: 0 },
    );

    for (const word of words) observer.observe(word);
    return () => observer.disconnect();
  }, []);

  const words = children.split(" ");

  return (
    <p className="tagline-reveal" ref={container} data-testid={testId} data-reduced={reduced}>
      {words.map((word, index) => (
        <span
          // The index is part of the key because a sentence legitimately repeats words, and two
          // spans keyed on the same text would collapse into one.
          key={`${word}-${index}`}
          data-word
          data-index={index}
          data-lit={reduced ? "true" : undefined}
        >
          {word}
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
