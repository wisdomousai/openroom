import { useEffect, useRef } from 'react';
import { buildBeat, type Beat } from '../choreography';

const SPARKS = 26;

export interface MomentProps {
  /** The beat to play, or null for a quiet stage. */
  beat: Beat | null;
  /** Bumped on every beat so the same beat twice in a row still replays. */
  token: number;
  title: string;
  celebrate: boolean;
}

/**
 * The top layer: nothing but choreography.
 *
 * It renders four inert nodes and hands them to `buildBeat`, which owns all the
 * timing. Nothing here is interactive and nothing here carries information that
 * is not also in the data layer and its text summary, so it is `aria-hidden`
 * and `pointer-events: none` — the audience can look away from it entirely and lose
 * nothing (STAGE-10).
 */
export function MomentLayer({ beat, token, title, celebrate }: MomentProps) {
  const wash = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLDivElement>(null);
  const spark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (beat === null) return;
    if (!wash.current || !heading.current || !sweep.current || !spark.current) return;
    const tl = buildBeat(
      beat,
      { wash: wash.current, title: heading.current, sweep: sweep.current, spark: spark.current },
      { celebrate },
    );
    return () => {
      tl.kill();
    };
  }, [beat, token, celebrate]);

  return (
    <div className="moment" aria-hidden="true">
      <div className="moment__wash" ref={wash} />
      <div className="moment__sweep" ref={sweep} />
      <div className="moment__title" ref={heading}>
        {title}
      </div>
      <div className="moment__spark" ref={spark}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <span
            key={i}
            className="moment__piece"
            style={{ background: `var(--chart-${(i % 5) + 1})` }}
          />
        ))}
      </div>
    </div>
  );
}
