import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** The embedded slide lays out at this projector height, then scales to the frame. */
export const STAGE_HEIGHT = 720;

/**
 * PowerPoint sizes the add-in's webview differently in edit view, in Slide Show and
 * at each zoom level, and on Mac it reuses one webview for both views. The stage's
 * rail and type have fixed pixel sizes, so laying it out at the frame's own size
 * gives a different slide in each view. Laying out at one size and scaling keeps
 * the slide the same everywhere, like a picture of the projector.
 */
export function ScaledStage({ aspect, children }: { aspect: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const width = Math.round(STAGE_HEIGHT * aspect);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const { width: frameWidth, height: frameHeight } = element.getBoundingClientRect();
      if (frameWidth > 0 && frameHeight > 0) setScale(Math.min(frameWidth / width, frameHeight / STAGE_HEIGHT));
    };
    measure();
    // A reused webview may resize without notifying the observer; window resize is the fallback.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    document.addEventListener('visibilitychange', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('visibilitychange', measure); };
  }, [width]);
  return <div ref={frame} className="scaled-stage">
    <div className="scaled-stage__slide" style={{ width, height: STAGE_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>{children}</div>
  </div>;
}
