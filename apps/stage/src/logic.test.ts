import { afterEach, describe, expect, it } from 'vitest';
import { cornerClockVisible, formatCountdown } from './countdown';
import { modeFromQuery, chartColor, CHART_VARS } from './theme';
import { interpretWebglProbe, shouldRenderAmbient } from './webgl';
import {
  BEAT_MS,
  beatStateOf,
  detectBeat,
  shouldCelebrate,
  type BeatState,
} from './choreography';
import { MOTION, applyMotionPreference, dur, stagger } from './motion';
import { RECIPES, layout, recipeFor, wrap } from './layers/ambient-recipes';
import { THEME_IDS } from '@openroom/ui';

afterEach(() => applyMotionPreference(false));

/* ---------------------------------------------------------------- countdown */

describe('formatCountdown', () => {
  it('uses bare seconds under a minute', () => {
    expect(formatCountdown(0)).toBe('0s');
    expect(formatCountdown(42)).toBe('42s');
  });

  it('uses m:ss at a minute and above', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(80)).toBe('1:20');
  });
});

describe('cornerClockVisible', () => {
  const clock = { stepId: 'think', placement: 'slide' as const };

  it('is hidden when there is no clock', () => {
    expect(cornerClockVisible(undefined, { kind: 'title', id: 't' })).toBe(false);
  });

  it('is hidden on the timer slide while placement is slide', () => {
    expect(cornerClockVisible(clock, { kind: 'timer', id: 'think' })).toBe(false);
  });

  it('is shown on every other slide, and on its own slide when cornered', () => {
    expect(cornerClockVisible(clock, { kind: 'title', id: 't' })).toBe(true);
    expect(cornerClockVisible({ ...clock, placement: 'corner' }, { kind: 'timer', id: 'think' })).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ theme */

describe('modeFromQuery', () => {
  it('follows the system when nothing is pinned', () => {
    expect(modeFromQuery('', true)).toBe('dark');
    expect(modeFromQuery('?session=A', false)).toBe('light');
  });

  it('lets ?mode= override the system in both directions', () => {
    expect(modeFromQuery('?mode=light', true)).toBe('light');
    expect(modeFromQuery('?mode=dark', false)).toBe('dark');
  });

  it('ignores a nonsense mode rather than guessing', () => {
    expect(modeFromQuery('?mode=sepia', true)).toBe('dark');
  });
});

describe('chartColor', () => {
  it('uses the five theme chart tokens verbatim for the first five series', () => {
    for (let i = 0; i < 5; i++) expect(chartColor(i)).toBe(CHART_VARS[i]);
  });

  it('derives later series from the same tokens, never from a literal colour', () => {
    const sixth = chartColor(5);
    expect(sixth).toContain('var(--chart-1)');
    expect(sixth).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});

/* ------------------------------------------------------------------ webgl */

describe('shouldRenderAmbient', () => {
  const base = { themeId: 'default', reduced: false, webgl: true };

  it('renders the atmosphere for an ordinary themed session', () => {
    expect(shouldRenderAmbient(base)).toBe(true);
  });

  it('is skipped entirely without a WebGL context', () => {
    expect(shouldRenderAmbient({ ...base, webgl: false })).toBe(false);
  });

  it('is skipped under prefers-reduced-motion', () => {
    expect(shouldRenderAmbient({ ...base, reduced: true })).toBe(false);
  });

  it('is muted by the projector theme even when everything else is available', () => {
    expect(shouldRenderAmbient({ ...base, themeId: 'projector' })).toBe(false);
  });

  it('stays on for the other four themes', () => {
    for (const themeId of ['default', 'chalkboard', 'paper', 'sherbet']) {
      expect(shouldRenderAmbient({ ...base, themeId })).toBe(true);
    }
  });
});

describe('interpretWebglProbe', () => {
  it('treats a thrown probe as no WebGL', () => {
    expect(interpretWebglProbe({}, true)).toBe(false);
  });

  it('treats a null context as no WebGL', () => {
    expect(interpretWebglProbe(null, false)).toBe(false);
  });

  it('accepts a real context object', () => {
    expect(interpretWebglProbe({ drawArrays() {} }, false)).toBe(true);
  });
});

/* -------------------------------------------------------- ambient scene */

describe('ambient compositions', () => {
  it('gives every built-in theme its own recipe', () => {
    for (const id of THEME_IDS) expect(RECIPES[id]).toBeDefined();
  });

  it('keeps the five themes visibly distinct, not one screensaver restained', () => {
    const signatures = THEME_IDS.map((id) => {
      const r = recipeFor(id);
      return `${r.kind}/${r.solid ? 'solid' : 'hollow'}/${r.count}/${r.spin}`;
    });
    expect(new Set(signatures).size).toBe(THEME_IDS.length);
  });

  it('falls back to the default composition for an unknown theme id', () => {
    expect(recipeFor('not-a-theme')).toBe(RECIPES['default']);
  });

  it('lays a theme out identically every time, so a theme switch is reversible', () => {
    const a = layout(recipeFor('paper'), 'paper', 20, 12);
    const b = layout(recipeFor('paper'), 'paper', 20, 12);
    expect(a).toEqual(b);
    expect(layout(recipeFor('sherbet'), 'sherbet', 20, 12)).not.toEqual(a);
  });

  it('never asks for a hue the recipe did not budget for', () => {
    for (const id of THEME_IDS) {
      const recipe = recipeFor(id);
      const items = layout(recipe, id, 20, 12);
      expect(items).toHaveLength(recipe.count);
      for (const item of items) {
        expect(item.hue).toBeGreaterThanOrEqual(0);
        expect(item.hue).toBeLessThan(recipe.hues);
        expect(recipe.hues).toBeLessThanOrEqual(5);
      }
    }
  });

  it('wraps a drifting shape back inside the frame in both directions', () => {
    for (const value of [-31, -5, 0, 5, 31]) {
      const wrapped = wrap(value, 10);
      expect(wrapped).toBeGreaterThanOrEqual(-5);
      expect(wrapped).toBeLessThan(5);
    }
  });
});

/* ----------------------------------------------------------------- motion */

describe('reduced motion flag', () => {
  it('collapses every duration and stagger to zero', () => {
    applyMotionPreference(true);
    expect(MOTION.reduced).toBe(true);
    expect(dur(0.9)).toBe(0);
    expect(stagger(0.05)).toBe(0);
  });

  it('restores real durations when the preference is off', () => {
    applyMotionPreference(false);
    expect(dur(0.9)).toBeCloseTo(0.9);
    expect(stagger(0.05)).toBeCloseTo(0.05);
  });
});

/* ---------------------------------------------------------- choreography */

const state = (over: Partial<BeatState> = {}): BeatState => ({
  status: 'live',
  interactionId: 'q1',
  interactionStatus: 'open',
  round: null,
  ...over,
});

describe('beatStateOf', () => {
  it('reduces a snapshot to the four fields a beat can depend on', () => {
    expect(
      beatStateOf({
        status: 'live',
        interaction: { id: 'q7' },
        interactionStatus: 'closed',
        round: 2,
      }),
    ).toEqual({ status: 'live', interactionId: 'q7', interactionStatus: 'closed', round: 2 });
  });
});

describe('detectBeat', () => {
  it('plays nothing when a stage reconnects into an already open question', () => {
    expect(detectBeat(null, state())).toBeNull();
  });

  it('plays the open beat when a new question arrives', () => {
    expect(detectBeat(state({ interactionId: 'q0', interactionStatus: 'closed' }), state())).toBe(
      'open',
    );
  });

  it('does not replay the open beat on every new ballot', () => {
    expect(detectBeat(state(), state())).toBeNull();
  });

  it('plays close and reveal exactly once each', () => {
    const open = state();
    const closed = state({ interactionStatus: 'closed' });
    const revealed = state({ interactionStatus: 'revealed' });
    expect(detectBeat(open, closed)).toBe('close');
    expect(detectBeat(closed, closed)).toBeNull();
    expect(detectBeat(closed, revealed)).toBe('reveal');
    expect(detectBeat(revealed, revealed)).toBeNull();
  });

  it('plays its own beat when a peer-instruction question reopens for round 2', () => {
    const closedRound1 = state({ interactionStatus: 'closed', round: 1 });
    const openRound2 = state({ interactionStatus: 'open', round: 2 });
    expect(detectBeat(closedRound1, openRound2)).toBe('revote');
    expect(detectBeat(openRound2, openRound2)).toBeNull();
  });

  it('plays the ended beat once, including on a first snapshot', () => {
    const ended = state({ status: 'ended' });
    expect(detectBeat(null, ended)).toBe('ended');
    expect(detectBeat(state(), ended)).toBe('ended');
    expect(detectBeat(ended, ended)).toBeNull();
  });

  it('stays quiet in the lobby', () => {
    expect(
      detectBeat(null, state({ status: 'lobby', interactionId: null, interactionStatus: null })),
    ).toBeNull();
  });
});

describe('BEAT_MS', () => {
  it('keeps the reveal inside the 600-900ms window the PRD pins it to', () => {
    expect(BEAT_MS.reveal).toBeGreaterThanOrEqual(600);
    expect(BEAT_MS.reveal).toBeLessThanOrEqual(900);
  });

  it('keeps the close beat short enough to feel like a shutter', () => {
    expect(BEAT_MS.close).toBeLessThan(BEAT_MS.reveal);
  });
});

describe('shouldCelebrate', () => {
  it('celebrates a revealed quiz choice that has a correct option', () => {
    expect(
      shouldCelebrate('reveal', { type: 'choice', options: [{ correct: true }, {}] }),
    ).toBe(true);
  });

  it('does not celebrate an opinion poll', () => {
    expect(shouldCelebrate('reveal', { type: 'choice', options: [{}, {}] })).toBe(false);
  });

  it('celebrates a numeric estimation that has a correct value', () => {
    expect(shouldCelebrate('reveal', { type: 'numeric', correct: 42 })).toBe(true);
    expect(shouldCelebrate('reveal', { type: 'numeric' })).toBe(false);
  });

  it('celebrates scored text and ranking modes', () => {
    expect(shouldCelebrate('reveal', { type: 'text', correctAnswers: ['Paris'] })).toBe(true);
    expect(shouldCelebrate('reveal', { type: 'text' })).toBe(false);
    expect(shouldCelebrate('reveal', { type: 'ranking', correctOrder: ['a', 'b'] })).toBe(true);
    expect(shouldCelebrate('reveal', { type: 'ranking' })).toBe(false);
  });

  it('celebrates a fill-the-gaps once its gaps carry answer keys', () => {
    expect(shouldCelebrate('reveal', { type: 'fill-the-gaps', gaps: [{ answers: ['ging'] }, {}] })).toBe(
      true,
    );
    expect(shouldCelebrate('reveal', { type: 'fill-the-gaps', gaps: [{}, { answers: [] }] })).toBe(false);
  });

  it('celebrates a match that has a correct pairing', () => {
    expect(shouldCelebrate('reveal', { type: 'match', correct: { l1: 'r1' } })).toBe(true);
    expect(shouldCelebrate('reveal', { type: 'match', correct: {} })).toBe(false);
    expect(shouldCelebrate('reveal', { type: 'match' })).toBe(false);
  });

  it('never celebrates a beat that is not the reveal', () => {
    expect(shouldCelebrate('open', { type: 'choice', options: [{ correct: true }] })).toBe(false);
    expect(shouldCelebrate(null, { type: 'choice', options: [{ correct: true }] })).toBe(false);
  });
});
