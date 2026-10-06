import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { inkHex, isMarkShape, type InkColor, type MarkShape, type ParticipantSnapshot } from '@openroom/sdk';
import { InkMarks, lineBoxes, measureTokens, spanBoxes, tokenKey, useTokenBoxes, TOKEN_SPLIT, spanStyleOf, sliceSpans, type SlideSpanStyle, type TokenBox, type TokenBoxes } from '@openroom/slides';

export type InkMark = NonNullable<ParticipantSnapshot['marks']>[number];

/**
 * The word under the pointer, looked up through whatever is drawn over it.
 *
 * `elementsFromPoint` gives the whole stack at the point, so the ink overlay
 * sitting on top of the plate does not hide the text from the circle tool.
 */
function tokenUnder(clientX: number, clientY: number, fallback: EventTarget | null): HTMLElement | null {
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [];
  for (const element of stack) {
    const token = element.closest?.('[data-token]');
    if (token instanceof HTMLElement) return token;
  }
  const direct = (fallback as HTMLElement | null)?.closest?.('[data-token]');
  return direct instanceof HTMLElement ? direct : null;
}

/** One word the circle tool can name: where it is, and what it says. */
interface TokenHit {
  key: string;
  partKey: string;
  token: number;
  word: string;
  boxes: TokenBox[];
}

/** The word under the pointer, already in the overlay's coordinates. */
function tokenHit(
  clientX: number,
  clientY: number,
  fallback: EventTarget | null,
  root: HTMLElement | null,
): TokenHit | null {
  if (root === null) return null;
  const element = tokenUnder(clientX, clientY, fallback);
  if (element === null || !(root.parentElement ?? root).contains(element)) return null;
  const partKey =
    element.dataset.part ??
    (element.closest('[data-part]') as HTMLElement | null)?.dataset.part ??
    'header';
  const token = Number(element.dataset.token);
  const word = (element.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  if (!Number.isInteger(token) || word === '') return null;
  const frame = root.getBoundingClientRect();
  if (frame.width === 0 || frame.height === 0) return null;
  return {
    key: tokenKey(partKey, token),
    partKey,
    token,
    word,
    boxes: measureTokens(root, [{ partKey, token }])[tokenKey(partKey, token)] ?? [],
  };
}

/** How often the pointer path is hit-tested while dragging over words, in pixels. */
const SAMPLE_STEP_PX = 8;

/** How long a click over an existing mark waits to see whether it is a double-click. */
const DOUBLE_CLICK_GRACE = 220;

/** How close a pointer has to come to a mark's line to be on it, in pixels. */
const ERASE_TOLERANCE_PX = 9;

/** Distance from a point to a segment, both in pixels. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Whether a pointer is *on* a mark — on its line, not merely inside it.
 *
 * That distinction is the whole point: double-clicking a circled word must
 * still reach the word, so only the ring itself erases. A highlight is a wash
 * rather than a line, so there the whole wash counts.
 *
 * Everything is measured in pixels: the overlay's 0–1 space is stretched by the
 * plate's aspect, and a tolerance expressed in it would be wider than it is tall.
 */
export function markHit(
  mark: InkMark,
  point: { x: number; y: number },
  frame: { width: number; height: number },
  boxes: TokenBoxes,
): boolean {
  const px = point.x * frame.width;
  const py = point.y * frame.height;
  const tol = ERASE_TOLERANCE_PX;

  if (mark.kind === 'pen') {
    for (let index = 1; index < mark.points.length; index += 1) {
      const a = mark.points[index - 1];
      const b = mark.points[index];
      if (a === undefined || b === undefined) continue;
      const distance = distanceToSegment(
        px,
        py,
        a.x * frame.width,
        a.y * frame.height,
        b.x * frame.width,
        b.y * frame.height,
      );
      if (distance <= tol) return true;
    }
    return false;
  }

  return spanBoxes(boxes, mark).some((box) => {
    const padX = Math.max(box.w * 0.16, 0.006) * frame.width;
    const padY = Math.max(box.h * 0.3, 0.01) * frame.height;
    const left = box.x * frame.width;
    const top = box.y * frame.height;
    const width = box.w * frame.width;
    const height = box.h * frame.height;
    const midY = top + height / 2;

    switch (mark.kind) {
      case 'circle': {
        const rx = width / 2 + padX;
        const ry = height / 2 + padY;
        if (rx <= 0 || ry <= 0) return false;
        const nx = (px - (left + width / 2)) / rx;
        const ny = (py - midY) / ry;
        const radius = Math.hypot(nx, ny);
        // Turn the normalised overshoot back into pixels along the nearer axis.
        return Math.abs(radius - 1) * Math.min(rx, ry) <= tol;
      }
      case 'rectangle': {
        const x0 = left - padX / 2;
        const y0 = top - padY / 2;
        const x1 = left + width + padX / 2;
        const y1 = top + height + padY / 2;
        const inside = px >= x0 - tol && px <= x1 + tol && py >= y0 - tol && py <= y1 + tol;
        const core = px > x0 + tol && px < x1 - tol && py > y0 + tol && py < y1 - tol;
        return inside && !core;
      }
      case 'underline': {
        const lineY = top + height + padY / 2;
        return px >= left - padX && px <= left + width + padX && Math.abs(py - lineY) <= tol;
      }
      case 'strikethrough':
        return px >= left - padX && px <= left + width + padX && Math.abs(py - midY) <= tol;
      case 'highlight':
        return (
          px >= left - padX / 3 &&
          px <= left + width + padX / 3 &&
          py >= top - padY / 4 &&
          py <= top + height + padY / 4
        );
    }
  });
}

/** Below this much travel a press is a click on one word, not a drag over several. */
const CLICK_SLOP = 6;

export function InkOverlay({
  marks,
  capture,
  color = 'red',
  track = false,
  onCircle,
  onStroke,
  onErase,
  onTarget,
}: {
  marks?: InkMark[];
  capture?: 'none' | MarkShape | 'pen';
  /** Colour the tutor is drawing in right now; committed marks carry their own. */
  color?: InkColor;
  /**
   * Follow the pointer over words even with no tool active, so the console can
   * offer a word to its right-click menu. The projector leaves this off.
   */
  track?: boolean;
  /** `endToken` is the last word of a dragged span; absent marks one word. */
  onCircle?: (partKey: string, token: number, word: string, endToken?: number) => void;
  onStroke?: (points: { x: number; y: number }[]) => void;
  /** Rub out one mark — a double-click on its own line. */
  onErase?: (id: string) => void;
  /** The word a right-click landed on (null when it hit no word). */
  onTarget?: (
    target: { partKey: string; token: number; word: string; endToken?: number } | null,
  ) => void;
}) {
  /** A shape tool is active: press or drag applies it to the words underneath. */
  const shaping = capture !== undefined && capture !== 'none' && isMarkShape(capture);
  /** No tool, but the console still wants to know which word the pointer is on. */
  const tracking = track && !shaping && capture !== 'pen';
  /** Erasing works under any tool, so the overlay listens whenever it can rub out. */
  const erasable = onErase !== undefined;

  const rootRef = useRef<HTMLDivElement>(null);
  // A ref, not a local: a snapshot arriving mid-stroke re-renders this
  // component, and a fresh object would drop the points drawn so far.
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const frameRef = useRef<number | null>(null);
  /**
   * The stroke under the tutor's hand. Drawn locally as it grows and nothing is
   * sent until the pointer lifts — the session hears one `mark.set`, not one per
   * move. It is held until the committed mark comes back on a snapshot, so the
   * line never blinks out while the revision round-trips.
   */
  const [preview, setPreview] = useState<{ x: number; y: number }[]>([]);
  const [drawing, setDrawing] = useState(false);
  /**
   * The words a click would circle: one under the pointer while hovering, or
   * every word the drag has crossed. Drawn as a faint tint so the tutor sees
   * what they are about to ring before the session does.
   */
  const [locked, setLocked] = useState<TokenHit[]>([]);
  /** Live drag over words: where it started, and the words it has crossed. */
  const spanRef = useRef<{
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    hits: Map<string, TokenHit>;
  } | null>(null);
  /** The mark under the pointer — thickened, because a double-click erases it. */
  const [hoveredMark, setHoveredMark] = useState<string | null>(null);
  /**
   * A click that landed on a mark waits a moment before it draws, so the second
   * click of a double-click erases instead of stacking another shape on top.
   */
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!drawing) setPreview([]);
    // Only the arrival of a new mark list retires the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks]);

  const boxes = useTokenBoxes(rootRef, marks);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (pendingClickRef.current !== null) clearTimeout(pendingClickRef.current);
    },
    [],
  );

  function localPoint(event: PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
    const y = box.height === 0 ? 0 : (event.clientY - box.top) / box.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  /**
   * Every word on the straight line between two points.
   *
   * Pointer moves arrive coarsely — a fast drag can jump a whole word between
   * two events, and the browser coalesces them — so the *path* is walked rather
   * than the events, which is what makes dragging across a phrase reliable.
   */
  function collectAlong(
    span: { lastX: number; lastY: number; hits: Map<string, TokenHit> },
    toX: number,
    toY: number,
  ): boolean {
    const distance = Math.hypot(toX - span.lastX, toY - span.lastY);
    const steps = Math.max(1, Math.ceil(distance / SAMPLE_STEP_PX));
    let added = false;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const hit = tokenHit(
        span.lastX + (toX - span.lastX) * t,
        span.lastY + (toY - span.lastY) * t,
        null,
        rootRef.current,
      );
      if (hit === null || span.hits.has(hit.key)) continue;
      span.hits.set(hit.key, hit);
      added = true;
    }
    span.lastX = toX;
    span.lastY = toY;
    return added;
  }

  /** The mark under a client point, topmost (most recently drawn) first. */
  function markUnder(clientX: number, clientY: number): InkMark | null {
    const root = rootRef.current;
    if (root === null) return null;
    const frame = root.getBoundingClientRect();
    if (frame.width === 0 || frame.height === 0) return null;
    const point = {
      x: (clientX - frame.left) / frame.width,
      y: (clientY - frame.top) / frame.height,
    };
    for (let index = (marks ?? []).length - 1; index >= 0; index -= 1) {
      const mark = (marks ?? [])[index];
      if (mark === undefined) continue;
      if (markHit(mark, point, frame, boxes)) return mark;
    }
    return null;
  }

  /** Push the growing stroke to the screen at most once a frame. */
  function schedulePreview(): void {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setPreview([...pointsRef.current]);
    });
  }

  const lockBoxes = lineBoxes(locked.flatMap((hit) => hit.boxes));

  return (
    <div
      ref={rootRef}
      className="ink-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        touchAction: shaping || capture === 'pen' ? 'none' : undefined,
        pointerEvents:
          shaping || tracking || capture === 'pen' || erasable ? 'auto' : 'none',
        cursor: hoveredMark !== null
          ? 'pointer'
          : shaping
            ? locked.length > 0
              ? 'pointer'
              : 'crosshair'
            : tracking && locked.length > 0
              ? 'context-menu'
              : undefined,
      }}
      onContextMenu={(event) => {
        // Report the word under the right-click before the menu opens; the
        // event is not consumed, so the console's menu still appears.
        const span = spanRef.current;
        const hits = span === null ? [] : [...span.hits.values()];
        const hit = tokenHit(event.clientX, event.clientY, event.target, rootRef.current);
        const part = hits[0]?.partKey;
        if (hits.length > 1 && part !== undefined && hits.every((entry) => entry.partKey === part)) {
          const ordered = [...hits].sort((a, b) => a.token - b.token);
          const first = ordered[0];
          const end = ordered[ordered.length - 1];
          if (first !== undefined && end !== undefined) {
            onTarget?.({
              partKey: part,
              token: first.token,
              word: ordered.map((entry) => entry.word).join(' '),
              endToken: end.token,
            });
            return;
          }
        }
        onTarget?.(
          hit === null ? null : { partKey: hit.partKey, token: hit.token, word: hit.word },
        );
        spanRef.current = null;
      }}
      onPointerLeave={() => {
        if (spanRef.current === null) setLocked([]);
        setHoveredMark(null);
      }}
      onPointerCancel={() => {
        pointsRef.current = [];
        spanRef.current = null;
        setDrawing(false); setPreview([]); setLocked([]); setHoveredMark(null);
      }}
      onDoubleClick={(event) => {
        const over = markUnder(event.clientX, event.clientY);
        if (over === null) return;
        // The click that would have drawn is still waiting; drop it and rub out.
        if (pendingClickRef.current !== null) {
          clearTimeout(pendingClickRef.current);
          pendingClickRef.current = null;
        }
        setHoveredMark(null);
        onErase?.(over.id);
      }}
      onPointerDown={(event) => {
        // Secondary buttons belong to the context menu, not to the ink.
        if (event.button !== 0) return;
        if (capture === 'pen') {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointsRef.current = [localPoint(event)];
          setDrawing(true);
          setPreview(pointsRef.current);
        }
        if (shaping) {
          event.currentTarget.setPointerCapture(event.pointerId);
          // The overlay is on top and taking pointer events, so it — not the
          // word — is the event target. Hit-test through it.
          const hit = tokenHit(event.clientX, event.clientY, event.target, rootRef.current);
          const hits = new Map<string, TokenHit>();
          if (hit !== null) hits.set(hit.key, hit);
          spanRef.current = {
            x: event.clientX,
            y: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            hits,
          };
          setLocked(hit === null ? [] : [hit]);
        }
      }}
      onPointerMove={(event) => {
        if (erasable && spanRef.current === null && pointsRef.current.length === 0) {
          const over = markUnder(event.clientX, event.clientY);
          setHoveredMark((current) => (current === (over?.id ?? null) ? current : over?.id ?? null));
        }
        if (shaping || tracking) {
          const span = shaping ? spanRef.current : null;
          if (span === null) {
            const hit = tokenHit(event.clientX, event.clientY, event.target, rootRef.current);
            // Hovering: lock exactly the word a click would take, and only
            // re-render when that word actually changes.
            setLocked((current) =>
              (current[0]?.key ?? null) === (hit?.key ?? null) ? current : hit === null ? [] : [hit],
            );
            return;
          }
          if (!collectAlong(span, event.clientX, event.clientY)) return;
          setLocked([...span.hits.values()]);
          return;
        }
        if (capture !== 'pen' || pointsRef.current.length === 0) return;
        const next = localPoint(event);
        const last = pointsRef.current[pointsRef.current.length - 1];
        if (last && Math.abs(last.x - next.x) + Math.abs(last.y - next.y) < 0.004) return;
        if (pointsRef.current.length < 200) pointsRef.current.push(next);
        schedulePreview();
      }}
      onPointerUp={(event) => {
        if (shaping) {
          const span = spanRef.current;
          spanRef.current = null;
          setLocked([]);
          if (span === null) return;
          // One last sweep: a drag released between two move events still ends
          // on the word under the pointer.
          collectAlong(span, event.clientX, event.clientY);
          const hits = [...span.hits.values()];
          const moved = Math.hypot(event.clientX - span.x, event.clientY - span.y);
          const last = tokenHit(event.clientX, event.clientY, event.target, rootRef.current);
          if (hits.length === 0) return;
          // A press that barely moved is a click on one word, whatever the
          // drag collected on the way; so is a drag that stayed inside a part
          // it cannot span (two parts have no single range between them).
          const part = hits[0]?.partKey;
          const oneRun = moved >= CLICK_SLOP && hits.every((entry) => entry.partKey === part);
          // Over an existing mark, hold the new one back for a moment: the
          // second click of a double-click is an erase, not another shape.
          const overMark = markUnder(event.clientX, event.clientY) !== null;
          const emit = (partKey: string, token: number, word: string, endToken?: number) => {
            if (pendingClickRef.current !== null) clearTimeout(pendingClickRef.current);
            if (!overMark) {
              onCircle?.(partKey, token, word, endToken);
              return;
            }
            pendingClickRef.current = setTimeout(() => {
              pendingClickRef.current = null;
              onCircle?.(partKey, token, word, endToken);
            }, DOUBLE_CLICK_GRACE);
          };
          if (!oneRun || part === undefined) {
            const single = last ?? hits[0];
            if (single !== undefined) emit(single.partKey, single.token, single.word);
            return;
          }
          const ordered = [...hits].sort((a, b) => a.token - b.token);
          const first = ordered[0];
          const end = ordered[ordered.length - 1];
          if (first === undefined || end === undefined) return;
          // The lookup hangs on the first word, so the phrase reads from there.
          const phrase = ordered.map((entry) => entry.word).join(' ');
          emit(part, first.token, phrase, end.token);
          return;
        }
        if (capture !== 'pen') return;
        const points = pointsRef.current;
        pointsRef.current = [];
        setDrawing(false);
        if (points.length < 2) {
          setPreview([]);
          return;
        }
        setPreview(points);
        onStroke?.(points);
      }}
    >
      <InkMarks marks={marks} boxes={boxes} hoveredMark={hoveredMark} />
      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        {preview.length > 1 ? (
          // Not shared yet — the tutor's own hand, a shade lighter than a committed stroke.
          <polyline
            fill="none"
            stroke={inkHex(color)}
            strokeOpacity={0.7}
            strokeWidth="0.008"
            points={preview.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        ) : null}
      </svg>
      {lockBoxes.map((lockBox, index) => (
        // A quiet outline follows each selected line before the mark is sent.
        <span
          key={index}
          aria-hidden="true"
          className="ink-lock"
          style={{
            position: 'absolute',
            left: `${String(lockBox.x * 100)}%`,
            top: `${String(lockBox.y * 100)}%`,
            width: `${String(lockBox.w * 100)}%`,
            height: `${String(lockBox.h * 100)}%`,
            borderColor: inkHex(color),
          }}
        />
      ))}
    </div>
  );
}

export function TokenLine({
  text,
  partKey,
  spans,
}: {
  text: string;
  partKey: string;
  /** Styled spans over `text`. Sliced inside each token span, never around one. */
  spans?: readonly SlideSpanStyle[];
}) {
  let offset = 0;
  return (
    <>
      {text.split(TOKEN_SPLIT).map((chunk, index) => {
        const start = offset;
        offset += chunk.length;
        const sliced = spans === undefined ? undefined : sliceSpans(spans, start, offset);
        if (/^\s+$/.test(chunk)) {
          if (sliced === undefined) return chunk;
          return (
            <span key={`${partKey}-${index}`}>
              {sliced.map((span, spanIndex) => (
                <span key={spanIndex} style={spanStyleOf(span)}>
                  {span.text}
                </span>
              ))}
            </span>
          );
        }
        return (
          <span key={`${partKey}-${index}`} data-part={partKey} data-token={Math.floor(index / 2)}>
            {sliced === undefined
              ? chunk
              : sliced.map((span, spanIndex) => (
                  <span key={spanIndex} style={spanStyleOf(span)}>
                    {span.text}
                  </span>
                ))}
          </span>
        );
      })}
    </>
  );
}
