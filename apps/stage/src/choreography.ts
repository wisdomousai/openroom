/**
 * The moment layer's score.
 *
 * Everything dramatic on the stage happens on a *beat* — a transition the session
 * just made — and every beat is choreographed here so the whole show keeps one
 * sense of timing. Components never invent a duration; they ask for a beat and
 * get a GSAP timeline built from the shared vocabulary in `motion.ts`.
 *
 * Beat detection is a pure function of two snapshots, which is the only part
 * worth unit-testing: if the stage fires "reveal" on a re-poll of an already
 * revealed question, the projector strobes at the class.
 */
import { gsap } from 'gsap';
import { EASE, dur, stagger, timeline } from './motion';

export type Beat = 'open' | 'close' | 'reveal' | 'revote' | 'ended';

/** The only parts of a snapshot that can start a beat. */
export interface BeatState {
  status: 'lobby' | 'live' | 'ended';
  interactionId: string | null;
  interactionStatus: 'pending' | 'open' | 'closed' | 'revealed' | null;
  round: 1 | 2 | null;
}

export function beatStateOf(snapshot: {
  status: 'lobby' | 'live' | 'ended';
  interaction: { id: string } | null;
  interactionStatus: 'pending' | 'open' | 'closed' | 'revealed' | null;
  round?: 1 | 2;
}): BeatState {
  return {
    status: snapshot.status,
    interactionId: snapshot.interaction?.id ?? null,
    interactionStatus: snapshot.interactionStatus ?? null,
    round: snapshot.round ?? null,
  };
}

/**
 * Which beat, if any, the session just played. Returns `null` for a snapshot that
 * changed in some way the moment layer does not care about (a new ballot, a
 * participant joining) — those are the data layer's business.
 *
 * The first snapshot after a page load deliberately produces no beat for an
 * already-open question: a stage that reconnects mid-question should slide in
 * quietly, not replay the fanfare. It *does* honour a session that is already
 * ended, because that screen is a state, not a flourish.
 */
export function detectBeat(prev: BeatState | null, next: BeatState): Beat | null {
  if (next.status === 'ended') {
    return prev === null || prev.status !== 'ended' ? 'ended' : null;
  }
  if (next.interactionId === null || next.interactionStatus === null) return null;

  const sameQuestion = prev !== null && prev.interactionId === next.interactionId;

  // A revote reopens the same question in round 2 — its own beat, because the
  // session needs to understand that the numbers just reset on purpose.
  if (sameQuestion && next.interactionStatus === 'open' && prev.round !== next.round) {
    return 'revote';
  }

  if (next.interactionStatus === 'open') {
    if (!sameQuestion) return prev === null ? null : 'open';
    return prev.interactionStatus === 'open' ? null : 'open';
  }

  if (prev === null) return null;
  if (next.interactionStatus === 'closed') {
    return prev.interactionStatus === 'closed' ? null : 'close';
  }
  if (next.interactionStatus === 'revealed') {
    return prev.interactionStatus === 'revealed' ? null : 'reveal';
  }
  return null;
}

/**
 * Beat durations in milliseconds. Exported (and asserted in the tests) because
 * the PRD pins the reveal to a staged 600–900ms — long enough to land, short
 * enough that a host never waits for the software.
 */
export const BEAT_MS: Record<Beat, number> = {
  open: 780,
  close: 420,
  reveal: 860,
  revote: 620,
  ended: 700,
};

/**
 * The wipe is a solid bar 34% of the viewport wide, parked one full width off
 * the left edge (`xPercent: -100`). Clearing the right edge therefore means
 * translating it 134vw, which is 394% of its own width — 400 rounds it off and
 * puts the trailing edge safely outside the frame.
 */
const SWEEP_EXIT = 400;

export interface MomentNodes {
  /** Full-bleed wash used for flashes and dimming. */
  wash: HTMLElement;
  /** Big centred word ("Results", "Round 2", "Time's up"). */
  title: HTMLElement;
  /** Thin sweeping bar that wipes across the stage. */
  sweep: HTMLElement;
  /** Container for celebration particles; may be empty. */
  spark: HTMLElement;
}

/**
 * Build the timeline for a beat. The caller owns the returned timeline and must
 * kill it on unmount. Under reduced motion every duration is 0, so the timeline
 * still runs and still leaves the DOM in its resting state — instantly.
 */
export function buildBeat(
  beat: Beat,
  nodes: MomentNodes,
  opts: { celebrate?: boolean } = {},
): gsap.core.Timeline {
  const tl = timeline();
  const rest = { autoAlpha: 0 };

  gsap.set([nodes.wash, nodes.title, nodes.sweep], rest);
  gsap.set(nodes.sweep, { xPercent: -100 });
  gsap.set(nodes.title, { scale: 0.94, y: 8 });

  switch (beat) {
    case 'open':
      // A hard cut on, one travel, a hard cut off. Nothing fades in this world.
      tl.set(nodes.sweep, { autoAlpha: 1 })
        .to(nodes.sweep, { xPercent: SWEEP_EXIT, duration: dur(0.52), ease: EASE.inOut })
        .set(nodes.sweep, { autoAlpha: 0 });
      break;

    case 'revote':
      tl.to(nodes.wash, { autoAlpha: 0.35, duration: dur(0.14) })
        .to(nodes.title, { autoAlpha: 1, scale: 1, y: 0, duration: dur(0.3), ease: EASE.hero }, '<')
        .to({}, { duration: dur(0.12) })
        .to([nodes.wash, nodes.title], { autoAlpha: 0, duration: dur(0.24), ease: EASE.in });
      break;

    case 'close':
      // The freeze pulse: one short breath of the whole surface, so the session
      // feels the shutter close without anything moving out from under it.
      tl.to(nodes.wash, { autoAlpha: 0.5, duration: dur(0.12), ease: EASE.out })
        .to(nodes.wash, { autoAlpha: 0, duration: dur(0.3), ease: EASE.in });
      break;

    case 'reveal':
      // The money shot, staged in four: dim, name it, wipe, release.
      tl.to(nodes.wash, { autoAlpha: 0.62, duration: dur(0.16) })
        .to(nodes.title, { autoAlpha: 1, scale: 1, y: 0, duration: dur(0.34), ease: EASE.hero }, '-=0.04')
        .set(nodes.sweep, { autoAlpha: 1 }, '-=0.1')
        .to(nodes.sweep, { xPercent: SWEEP_EXIT, duration: dur(0.42), ease: EASE.inOut }, '<')
        .set(nodes.sweep, { autoAlpha: 0 })
        .to([nodes.wash, nodes.title], { autoAlpha: 0, duration: dur(0.26), ease: EASE.in }, '-=0.08');
      if (opts.celebrate) tl.add(celebration(nodes.spark), '-=0.42');
      break;

    case 'ended':
      // Curtain: cover, name it, then hand the screen to the ended state that
      // the body renders underneath. The overlay must not linger — a projector
      // left showing a translucent wash for the rest of the outline is a bug.
      tl.to(nodes.wash, { autoAlpha: 0.92, duration: dur(0.26) })
        .to(nodes.title, { autoAlpha: 1, scale: 1, y: 0, duration: dur(0.3), ease: EASE.out }, '-=0.14')
        .to({}, { duration: dur(0.1) })
        .to([nodes.wash, nodes.title], { autoAlpha: 0, duration: dur(0.24), ease: EASE.in });
      break;
  }

  return tl;
}

/**
 * A quiz's correct answer earns a small burst: solid squares thrown straight
 * out along a ring and cut, with no fade, no scale-down and no sparkle. Strictly
 * decoration on the moment layer — the correct answer is *also* marked in the 2D
 * chart and named in the text summary, so nothing here carries meaning on its
 * own (STAGE-10).
 */
function celebration(spark: HTMLElement): gsap.core.Timeline {
  const pieces = Array.from(spark.children) as HTMLElement[];
  const tl = timeline();
  if (pieces.length === 0) return tl;
  gsap.set(pieces, { autoAlpha: 0, x: 0, y: 0, rotation: 0 });
  tl.set(pieces, { autoAlpha: 1, stagger: stagger(0.01) })
    .to(
      pieces,
      {
        x: (i: number) => Math.cos((i / pieces.length) * Math.PI * 2) * (160 + (i % 5) * 44),
        y: (i: number) => Math.sin((i / pieces.length) * Math.PI * 2) * (120 + (i % 4) * 38),
        rotation: (i: number) => (i % 2 === 0 ? 90 : -90),
        duration: dur(0.6),
        ease: EASE.celebrate,
        stagger: stagger(0.008),
      },
      '<',
    )
    .set(pieces, { autoAlpha: 0 });
  return tl;
}

/** Does this beat deserve a celebration? Pure, so the rule stays visible. */
export interface CelebrationCandidate {
  type?: string;
  options?: readonly { label?: string; correct?: boolean }[];
  correct?: number | Record<string, string>;
  correctAnswers?: readonly string[];
  correctOrder?: readonly string[];
  gaps?: readonly { answers?: readonly string[] }[];
}

export function shouldCelebrate(
  beat: Beat | null,
  interaction: CelebrationCandidate | null,
): boolean {
  if (beat !== 'reveal' || interaction === null) return false;
  if (interaction.type === 'choice') {
    return (interaction.options ?? []).some((o) => o.correct === true);
  }
  if (interaction.type === 'numeric') return typeof interaction.correct === 'number';
  if (interaction.type === 'text') {
    return (interaction.correctAnswers?.length ?? 0) > 0;
  }
  if (interaction.type === 'ranking') {
    return (interaction.correctOrder?.length ?? 0) > 0;
  }
  // FillTheGaps and match only carry their answer keys once the session is revealed, so
  // the presence of a key is the same question as "was this one scored?".
  if (interaction.type === 'fill-the-gaps') {
    return (interaction.gaps ?? []).some((g) => (g.answers?.length ?? 0) > 0);
  }
  if (interaction.type === 'match') {
    const pairs = interaction.correct;
    return typeof pairs === 'object' && pairs !== null && Object.keys(pairs).length > 0;
  }
  return false;
}

/** The word the moment layer puts on screen for a beat. */
export function beatTitle(beat: Beat | null, round: 1 | 2 | null): string {
  switch (beat) {
    case 'reveal':
      return 'Results';
    case 'revote':
      return round === 2 ? 'Round 2' : 'Vote';
    case 'ended':
      return 'Session ended';
    default:
      return '';
  }
}
