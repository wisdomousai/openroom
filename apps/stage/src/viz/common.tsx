import { useEffect, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { EASE, SECONDS, dur } from '../motion';

/**
 * Every visualization is wrapped here so it always ships an aria-live text
 * summary that matches the drawn state (STAGE-06 / STAGE-10). The summary is
 * computed from the exact aggregate, never from a tweened value, so a screen
 * reader gets the truth while the pixels are still catching up.
 */
export function Frame({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <figure className="viz">
      <div className="viz__body">{children}</div>
      <figcaption className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------- motion primitives */

/**
 * A number that counts to its target instead of teleporting (STAGE-08).
 *
 * The tween writes straight into the DOM node rather than through React state:
 * a 500-participant burst would otherwise re-render the whole chart sixty times
 * a second. The rendered fallback text keeps SSR-less first paint correct.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const proxy = { n: current.current };
    const tween = gsap.to(proxy, {
      n: value,
      duration: dur(SECONDS.base),
      ease: EASE.out,
      onUpdate: () => {
        current.current = proxy.n;
        el.textContent = format(proxy.n);
      },
      onComplete: () => {
        current.current = value;
        el.textContent = format(value);
      },
    });
    return () => {
      tween.kill();
    };
    // `format` is a render-stable formatter in every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className} aria-hidden="true">
      {format(current.current)}
    </span>
  );
}
