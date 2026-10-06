import { useLayoutEffect, useState, type RefObject } from 'react';
import { inkHex, type MarkShape, type SessionMarkView } from '@openroom/sdk';
import { markTokens, measureTokens, spanBoxes, tokenKey, type TokenBox, type TokenBoxes } from './ink-geometry';

/** Re-measure when content reveals, wraps, changes font, or changes view. */
export function useTokenBoxes(rootRef: RefObject<HTMLDivElement | null>, marks: readonly SessionMarkView[] = []): TokenBoxes {
  const targets = marks.flatMap((mark) => mark.kind === 'pen' ? [] : markTokens(mark));
  const signature = targets.map((target) => tokenKey(target.partKey, target.token)).join('|');
  const [boxes, setBoxes] = useState<TokenBoxes>({});
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let active = true;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      if (!active) return;
      const next = measureTokens(root, targets);
      setBoxes((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const mutation = new MutationObserver((records) => {
      if (records.some((record) => record.target !== root && !root.contains(record.target))) schedule();
    });
    if (root.parentElement) mutation.observe(root.parentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    void document.fonts?.ready.then(() => { if (active) schedule(); });
    return () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
    // The set of named words is stable across unrelated session updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, rootRef]);
  return boxes;
}

/** One paint path for projector, tutor mirror and learner views. */
export function InkMarks({ marks = [], boxes, hoveredMark }: { marks?: readonly SessionMarkView[]; boxes: TokenBoxes; hoveredMark?: string | null }) {
  const shapes = marks.filter((mark): mark is Exclude<SessionMarkView, { kind: 'pen' }> => mark.kind !== 'pen');
  return <>
    {shapes.filter((mark) => mark.kind === 'highlight').map((mark) => <div key={mark.id} data-mark-id={mark.id} data-mark-kind={mark.kind}>
      {spanBoxes(boxes, mark).map((box, index) => <TokenHighlight key={index} box={box} color={inkHex(mark.color)} emphasis={hoveredMark === mark.id} />)}
    </div>)}
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
      {marks.filter((mark) => mark.kind === 'pen').map((mark) => <polyline key={mark.id} data-mark-id={mark.id} data-mark-kind="pen"
        fill="none" stroke={inkHex(mark.color)} strokeWidth={hoveredMark === mark.id ? '0.012' : '0.008'} strokeLinecap="round" strokeLinejoin="round"
        points={mark.points.map((point) => `${point.x},${point.y}`).join(' ')} />)}
      {shapes.filter((mark) => mark.kind !== 'highlight').map((mark) => <g key={mark.id} data-mark-id={mark.id} data-mark-kind={mark.kind}>
        {spanBoxes(boxes, mark).map((box, index) => <TokenShape key={index} shape={mark.kind} box={box} color={inkHex(mark.color)} emphasis={hoveredMark === mark.id} />)}
      </g>)}
    </svg>
  </>;
}

export function TokenShape({
  shape,
  box,
  color,
  emphasis = false,
}: {
  shape: MarkShape;
  box: TokenBox;
  color: string;
  /** Thickened while the pointer is on the line — a double-click rubs it out. */
  emphasis?: boolean;
}) {
  const padX = Math.max(box.w * 0.16, 0.006);
  const padY = Math.max(box.h * 0.3, 0.01);
  const midY = box.y + box.h / 2;
  const width = emphasis ? '0.012' : '0.008';

  switch (shape) {
    case 'circle':
      return (
        <ellipse
          cx={box.x + box.w / 2}
          cy={midY}
          rx={box.w / 2 + padX}
          ry={box.h / 2 + padY}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          // The loop does not quite close, the way a hand-drawn one does not.
          strokeDasharray="0.94 0.06"
          pathLength={1}
        />
      );
    case 'rectangle':
      return (
        <rect
          x={box.x - padX / 2}
          y={box.y - padY / 2}
          width={box.w + padX}
          height={box.h + padY}
          rx={0.004}
          ry={0.008}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinejoin="round"
        />
      );
    case 'underline':
      return (
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          // Three points, the middle one low: a rule drawn by hand dips.
          points={[
            `${String(box.x - padX / 2)},${String(box.y + box.h + padY / 3)}`,
            `${String(box.x + box.w / 2)},${String(box.y + box.h + padY / 2)}`,
            `${String(box.x + box.w + padX / 2)},${String(box.y + box.h + padY / 4)}`,
          ].join(' ')}
        />
      );
    case 'strikethrough':
      return (
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          points={[
            `${String(box.x - padX / 2)},${String(midY + box.h * 0.04)}`,
            `${String(box.x + box.w / 2)},${String(midY - box.h * 0.03)}`,
            `${String(box.x + box.w + padX / 2)},${String(midY + box.h * 0.02)}`,
          ].join(' ')}
        />
      );
    case 'highlight':
      // Drawn outside the SVG (`TokenHighlight`) so it can multiply with the
      // words instead of covering them.
      return null;
  }
}

/**
 * The marker swipe: a wash of colour over the words, multiplied into them so
 * black text stays black through red, ochre, and green alike.
 */
export function TokenHighlight({
  box,
  color,
  emphasis = false,
}: {
  box: TokenBox;
  color: string;
  emphasis?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="ink-highlight"
      style={{
        position: 'absolute',
        left: `${String((box.x - 0.002) * 100)}%`,
        top: `${String((box.y - 0.004) * 100)}%`,
        width: `${String((box.w + 0.004) * 100)}%`,
        height: `${String((box.h + 0.008) * 100)}%`,
        backgroundColor: color,
        opacity: emphasis ? 0.5 : 0.35,
        mixBlendMode: 'multiply',
        borderRadius: 2,
        pointerEvents: 'none',
      }}
    />
  );
}
