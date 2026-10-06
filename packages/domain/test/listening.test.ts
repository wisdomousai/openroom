import { describe, expect, it } from 'vitest';
import { projectOutlineStep, validateOutline, type Outline } from '@openroom/schema';
import { applyCommand, createSession, hostSnapshot, participantSnapshot, stageSnapshot } from '../src/index.js';
import { env, participant, run } from './helpers.js';

const script = 'Der Termin fällt aus. À jeudi !';
const outline: Outline = { version: 1, meta: { title: 'Listen' }, interactions: [], steps: [
  { id: 'audio', kind: 'media', title: 'Listen for the change', media: { type: 'audio', url: 'https://example.org/audio.wav', alt: 'An appointment', listening: { mode: 'room', transcript: script } } },
  { id: 'next', kind: 'title', title: 'What changed?' },
] };
const live = () => run(createSession(outline, 'LISTEN01', 0), env({ command: 'session.start' }));
const set = (mode: 'room' | 'individual', transcriptShown: boolean) => env({ command: 'listening.set', stepId: 'audio', mode, transcriptShown });

describe('listening ownership and transcript release', () => {
  it('carries the presenter choice into the first live snapshot and rejects invalid handoffs before starting', () => {
    const lobby = createSession(outline, 'LISTEN01', 0);
    const started = run(lobby, env({ command: 'session.start', cursor: { stepId: 'audio', shown: 1, listening: { mode: 'individual', transcriptShown: true } } }));
    expect(stageSnapshot(started).listening).toEqual({ stepId: 'audio', mode: 'individual', transcriptShown: true });
    expect(JSON.stringify(participantSnapshot(started, 'lea'))).toContain(script);
    for (const cursor of [
      { stepId: 'next', shown: 1, listening: { mode: 'room', transcriptShown: false } },
      { stepId: 'audio', shown: 1, listening: { mode: 'room', transcriptShown: 'yes' } },
      { stepId: 'audio', shown: 1, listening: null },
      { stepId: 'audio', shown: 1, listening: { mode: 'everywhere', transcriptShown: false } },
    ]) expect(applyCommand(lobby, env({ command: 'session.start', cursor } as never), 0)).toMatchObject({ ok: false, error: { code: 'E_INVALID_OUTLINE_STEP' } });
    expect(lobby.status).toBe('lobby');
  });
  it('requires an explicit mode for audio and keeps transcripts out of static and live audience projections', () => {
    expect(validateOutline(outline).ok).toBe(true);
    const malformed = structuredClone(outline);
    if (malformed.steps[0]?.kind === 'media') delete malformed.steps[0].media.listening;
    expect(validateOutline(malformed).ok).toBe(false);
    const state = live();
    expect(JSON.stringify(hostSnapshot(state))).toContain(script);
    for (const view of [projectOutlineStep(outline.steps[0]!), stageSnapshot(state), participantSnapshot(state, 'lea')]) {
      expect(JSON.stringify(view)).not.toContain(script);
    }
    expect(stageSnapshot(state).listening).toEqual({ stepId: 'audio', mode: 'room', transcriptShown: false });
  });
  it('releases and hides the transcript on both audience surfaces and switches playback mode in one revision', () => {
    const before = live();
    let state = run(before, set('individual', true));
    expect(state.revision).toBe(before.revision + 1);
    for (const view of [stageSnapshot(state), participantSnapshot(state, 'lea')]) {
      expect(view.listening?.mode).toBe('individual');
      expect(JSON.stringify(view.outline)).toContain(script);
    }
    state = run(state, set('room', false));
    expect(JSON.stringify(participantSnapshot(state, 'lea'))).not.toContain(script);
    expect(JSON.stringify(stageSnapshot(state))).not.toContain(script);
    expect(applyCommand(state, { ...set('individual', true), actor: participant('lea') }, 0)).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } });
  });
  it('resets on navigation and content replacement, and rejects a delayed command for the old slide', () => {
    let state = run(live(), set('individual', true));
    state = run(state, env({ command: 'outline.next' }));
    expect(stageSnapshot(state).listening).toBeUndefined();
    expect(applyCommand(state, set('individual', true), 0)).toMatchObject({ ok: false, error: { code: 'E_REVISION_CONFLICT' } });
    state = run(state, env({ command: 'outline.previous' }));
    expect(stageSnapshot(state).listening).toMatchObject({ mode: 'room', transcriptShown: false });
    state = run(state, set('individual', true));
    state = run(state, env({ command: 'outline.replace', stepId: 'audio', step: { ...outline.steps[0]!, title: 'A new recording' } as never }));
    expect(stageSnapshot(state).listening).toMatchObject({ mode: 'room', transcriptShown: false });
    expect(JSON.stringify(stageSnapshot(state))).not.toContain(script);
    expect(applyCommand(state, { ...set('room', false), command: { ...set('room', false).command, mode: 'everywhere' } as never }, 0).ok).toBe(false);
  });
  it('keeps independently changed settings through sequential commands and rejects empty or malformed updates', () => {
    let state = run(live(), set('individual', true));
    state = run(state, env({ command: 'listening.set', stepId: 'audio', mode: 'room' }));
    state = run(state, env({ command: 'listening.set', stepId: 'audio', transcriptShown: false }));
    expect(stageSnapshot(state).listening).toEqual({ stepId: 'audio', mode: 'room', transcriptShown: false });
    expect(JSON.stringify(participantSnapshot(state, 'lea'))).not.toContain(script);
    state = run(state, env({ command: 'listening.set', stepId: 'audio', transcriptShown: true }));
    state = run(state, env({ command: 'listening.set', stepId: 'audio', mode: 'individual' }));
    expect(stageSnapshot(state).listening).toEqual({ stepId: 'audio', mode: 'individual', transcriptShown: true });
    for (const change of [{}, { mode: null }, { mode: 'everywhere' }, { transcriptShown: null }, { transcriptShown: 'yes' }]) {
      expect(applyCommand(state, env({ command: 'listening.set', stepId: 'audio', ...change } as never), 0)).toMatchObject({ ok: false, error: { code: 'E_INVALID_ANSWER' } });
    }
  });
});
