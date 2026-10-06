import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ELEMENT_BOX_MAX, ELEMENT_BOX_MIN, type OutlineElementBox } from '@openroom/schema';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];
const EDGES = ['n', 's', 'e', 'w'] as const;

function cursorFor(handle: Handle): string {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function clampBox(box: OutlineElementBox): OutlineElementBox {
  const w = Math.min(ELEMENT_BOX_MAX, Math.max(ELEMENT_BOX_MIN, Math.round(box.w)));
  const h = Math.min(ELEMENT_BOX_MAX, Math.max(ELEMENT_BOX_MIN, Math.round(box.h)));
  return {
    x: Math.min(ELEMENT_BOX_MAX - w, Math.max(0, Math.round(box.x))),
    y: Math.min(ELEMENT_BOX_MAX - h, Math.max(0, Math.round(box.y))),
    w,
    h,
  };
}

function applyHandle(
  start: OutlineElementBox,
  handle: Handle,
  dxPct: number,
  dyPct: number,
): OutlineElementBox {
  let { x, y, w, h } = start;
  if (handle.includes('e')) w += dxPct;
  if (handle.includes('w')) {
    x += dxPct;
    w -= dxPct;
  }
  if (handle.includes('s')) h += dyPct;
  if (handle.includes('n')) {
    y += dyPct;
    h -= dyPct;
  }
  return clampBox({ x, y, w, h });
}

/**
 * Selection chrome for a freeform object: move the box, drag a handle to resize.
 * Writes percent coordinates, the same numbers an agent authors.
 *
 * The frame interior stays click-through by default so text elements keep
 * in-place editing; the border strips are always grabbable for moving. Pass
 * `moveInterior` for elements with nothing to click through to (image, html),
 * which makes the whole box a drag target.
 */
export function ObjectFrame({
  frame,
  targetKey,
  box,
  onBox,
  moveInterior = false,
}: {
  frame: HTMLElement;
  /** `data-part` of the element this frame wraps — dragged along live. */
  targetKey?: string;
  box: OutlineElementBox;
  onBox: (box: OutlineElementBox) => void;
  moveInterior?: boolean;
}) {
  const [draft, setDraft] = useState<OutlineElementBox | null>(null);
  const drag = useRef<{
    kind: 'move' | Handle;
    start: OutlineElementBox;
    startX: number;
    startY: number;
    slideW: number;
    slideH: number;
  } | null>(null);
  const shown = draft ?? box;

  useLayoutEffect(() => {
    setDraft(null);
  }, [box.x, box.y, box.w, box.h]);

  // Drag the element itself along with the chrome. The draft is written
  // straight onto the element's inline style, then the same numbers are put
  // back from `box` when the drag ends — React re-renders to the committed
  // values on drop, so the element never snaps.
  useLayoutEffect(() => {
    if (targetKey === undefined) return;
    const el = frame.querySelector(`[data-part="${CSS.escape(targetKey)}"]`);
    if (!(el instanceof HTMLElement)) return;
    const value = draft ?? box;
    el.style.left = `${String(value.x)}%`;
    el.style.top = `${String(value.y)}%`;
    el.style.width = `${String(value.w)}%`;
    el.style.height = `${String(value.h)}%`;
  }, [frame, targetKey, draft, box]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      const dxPct = ((event.clientX - current.startX) / current.slideW) * 100;
      const dyPct = ((event.clientY - current.startY) / current.slideH) * 100;
      if (current.kind === 'move') {
        setDraft(clampBox({ ...current.start, x: current.start.x + dxPct, y: current.start.y + dyPct }));
        return;
      }
      setDraft(applyHandle(current.start, current.kind, dxPct, dyPct));
    };
    const onUp = () => {
      const current = drag.current;
      if (current === null) return;
      drag.current = null;
      setDraft((value) => {
        if (value !== null) onBox(value);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onBox]);

  // Percent positioning, the same numbers the element itself is styled with —
  // both resolve against the slide frame, so the chrome can never drift from
  // the object when the frame resizes without a re-render. Pixels are only
  // measured at drag start, to convert pointer deltas into percent.
  return (
    <div
      className={moveInterior ? 'picture-frame picture-frame--move' : 'picture-frame'}
      style={{
        left: `${String(shown.x)}%`,
        top: `${String(shown.y)}%`,
        width: `${String(shown.w)}%`,
        height: `${String(shown.h)}%`,
      }}
      data-slide-decoration=""
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('.picture-frame__handle')) return;
        event.preventDefault();
        event.stopPropagation();
        const slide = frame.getBoundingClientRect();
        drag.current = {
          kind: 'move',
          start: shown,
          startX: event.clientX,
          startY: event.clientY,
          slideW: slide.width,
          slideH: slide.height,
        };
        setDraft(shown);
      }}
    >
      {EDGES.map((edge) => (
        <div key={edge} className={`picture-frame__edge picture-frame__edge--${edge}`} />
      ))}
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
              kind: handle,
              start: shown,
              startX: event.clientX,
              startY: event.clientY,
              slideW: slide.width,
              slideH: slide.height,
            };
            setDraft(shown);
          }}
        />
      ))}
      {draft !== null && drag.current !== null && drag.current.kind !== 'move' && (
        <span className="picture-frame__size" aria-hidden="true">
          {`${String(shown.w)}×${String(shown.h)}`}
        </span>
      )}
    </div>
  );
}
