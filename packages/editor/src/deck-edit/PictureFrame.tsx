import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampMediaSize, type OutlineMediaPlace } from '@openroom/schema';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];

function cursorFor(handle: Handle): string {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function nextSize(
  place: OutlineMediaPlace,
  handle: Handle,
  start: number,
  dxPct: number,
  dyPct: number,
): number {
  const growEast = handle.includes('e');
  const growWest = handle.includes('w');
  const growSouth = handle.includes('s');
  const growNorth = handle.includes('n');
  if (place === 'left') {
    if (growEast) return start + dxPct;
    if (growWest) return start - dxPct;
  }
  if (place === 'right' || place === 'fill') {
    if (growWest) return start - dxPct;
    if (growEast) return start + dxPct;
  }
  if (place === 'top') {
    if (growSouth) return start + dyPct;
    if (growNorth) return start - dyPct;
  }
  if (place === 'bottom' || place === 'fill') {
    if (growNorth) return start - dyPct;
    if (growSouth) return start + dyPct;
  }
  const dominant = Math.abs(dxPct) >= Math.abs(dyPct) ? dxPct : dyPct;
  return start + dominant;
}

/**
 * Selection chrome for the picture on the desk: a box and eight handles.
 * Dragging a handle writes `media.size` (percent of the slide).
 */
export function PictureFrame({
  frame,
  place,
  size,
  onSize,
}: {
  frame: HTMLElement;
  place: OutlineMediaPlace;
  size: number;
  onSize: (size: number) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{
    handle: Handle;
    startSize: number;
    startX: number;
    startY: number;
    slideW: number;
    slideH: number;
  } | null>(null);

  const shown = draft ?? size;

  useLayoutEffect(() => {
    const measure = () => {
      const part = frame.querySelector('[data-part="image"]');
      if (!(part instanceof HTMLElement)) {
        setBox(null);
        return;
      }
      const slide = frame.getBoundingClientRect();
      const rect = part.getBoundingClientRect();
      setBox({
        left: rect.left - slide.left,
        top: rect.top - slide.top,
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    const part = frame.querySelector('[data-part="image"]');
    if (part instanceof HTMLElement) observer.observe(part);
    return () => observer.disconnect();
  }, [frame, shown, place]);

  useEffect(() => {
    const stepEl = frame.querySelector('.outline-step');
    if (!(stepEl instanceof HTMLElement)) return;
    stepEl.style.setProperty('--picture-size', `${String(shown)}%`);
  }, [frame, shown]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      const dxPct = ((event.clientX - current.startX) / current.slideW) * 100;
      const dyPct = ((event.clientY - current.startY) / current.slideH) * 100;
      setDraft(clampMediaSize(nextSize(place, current.handle, current.startSize, dxPct, dyPct)));
    };
    const onUp = () => {
      const current = drag.current;
      if (current === null) return;
      drag.current = null;
      setDraft((value) => {
        const next = value ?? current.startSize;
        if (next !== current.startSize) onSize(next);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onSize, place]);

  if (box === null) return null;

  return (
    <div
      className="picture-frame"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      data-slide-decoration=""
    >
      {HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          aria-label={`Resize ${handle}`}
          className={`picture-frame__handle picture-frame__handle--${handle}`}
          style={{ cursor: cursorFor(handle) }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const slide = frame.getBoundingClientRect();
            drag.current = {
              handle,
              startSize: shown,
              startX: event.clientX,
              startY: event.clientY,
              slideW: slide.width,
              slideH: slide.height,
            };
            setDraft(shown);
          }}
        />
      ))}
      {draft !== null && (
        <span className="picture-frame__size" aria-hidden="true">
          {`${String(shown)}%`}
        </span>
      )}
    </div>
  );
}
