/**
 * Reveal security through the wire (API-06, STAGE-03).
 *
 * The sentinel strings below must never appear in a participant/stage
 * response before the interaction is revealed, and `notes` must NEVER
 * appear in a participant/stage response at all.
 */
import { describe, expect, it } from 'vitest';

import { command, createSessionWithOutline, join, stateJson } from './helpers.js';

const NOTES_SENTINEL = 'SENTINEL_NOTES_XYZ';
const MISC_SENTINEL = 'SENTINEL_MISC_XYZ';

const OUTLINE = {
  version: 1,
  meta: { title: 'Reveal security outline' },
  interactions: [
    {
      id: 'closed-choice',
      type: 'choice',
      prompt: 'Hidden-until-close choice',
      resultVisibility: 'hidden-until-close',
      notes: NOTES_SENTINEL,
      options: [
        { id: 'a', label: 'A', correct: true },
        { id: 'b', label: 'B', misconception: MISC_SENTINEL },
      ],
    },
    {
      id: 'live-choice',
      type: 'choice',
      prompt: 'Live choice',
      resultVisibility: 'live',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    {
      id: 'numeric-q',
      type: 'numeric',
      prompt: 'Guess the number',
      correct: 42,
      tolerance: 5,
    },
    {
      id: 'text-q',
      type: 'text',
      prompt: 'Capital?',
      correctAnswers: ['Paris'],
    },
    {
      id: 'rank-q',
      type: 'ranking',
      prompt: 'Order',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOrder: ['b', 'a'],
    },
  ],
};

function bodyText(json: unknown): string {
  return JSON.stringify(json);
}

describe('reveal security', () => {
  it('never leaks notes/correct/misconception pre-reveal, and reveals correctly (never leaks notes at all)', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);

    // ---- lobby phase --------------------------------------------------
    const lobbyParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(bodyText(lobbyParticipant)).not.toContain(NOTES_SENTINEL);
    expect(bodyText(lobbyParticipant)).not.toContain(MISC_SENTINEL);

    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'closed-choice' });

    // ---- open phase -----------------------------------------------------
    const openParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    const openStage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    for (const snap of [openParticipant, openStage]) {
      expect(bodyText(snap)).not.toContain(NOTES_SENTINEL);
      expect(bodyText(snap)).not.toContain(MISC_SENTINEL);
      expect(bodyText(snap)).not.toContain('"correct":true');
    }
    // hidden-until-close: no aggregate while merely open
    expect(openParticipant.aggregate).toBeNull();
    expect(openStage.aggregate).toBeNull();

    // host sees everything, always, including notes
    const openHost = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(bodyText(openHost)).toContain(NOTES_SENTINEL);

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'closed-choice',
      answer: { kind: 'choice', optionIds: ['b'] },
    });

    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: 'closed-choice' });

    // ---- closed phase (still hidden) ------------------------------------
    const closedParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    const closedStage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    for (const snap of [closedParticipant, closedStage]) {
      expect(bodyText(snap)).not.toContain(NOTES_SENTINEL);
      expect(bodyText(snap)).not.toContain(MISC_SENTINEL);
      expect(snap.aggregate).toBeNull();
    }

    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: 'closed-choice' });

    // ---- revealed phase ---------------------------------------------------
    const revealedParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    const revealedStage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    for (const snap of [revealedParticipant, revealedStage]) {
      // notes are host-only forever, even after reveal
      expect(bodyText(snap)).not.toContain(NOTES_SENTINEL);
      // correctness / misconception DO appear once revealed (API-06)
      expect(bodyText(snap)).toContain(MISC_SENTINEL);
      expect(snap.aggregate).not.toBeNull();
    }
    expect(revealedStage.interaction.options.find((o: any) => o.id === 'a').correct).toBe(true);
    expect(revealedStage.interaction.options.find((o: any) => o.id === 'b').misconception).toBe(MISC_SENTINEL);

    const revealedHost = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(bodyText(revealedHost)).toContain(NOTES_SENTINEL);
    expect(bodyText(revealedHost)).toContain(MISC_SENTINEL);
  });

  it('shows a live aggregate to participant and stage while an interaction is merely open', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'live-choice' });

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'live-choice',
      answer: { kind: 'choice', optionIds: ['a'] },
    });

    const openParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    const openStage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(openParticipant.aggregate).not.toBeNull();
    expect(openStage.aggregate).not.toBeNull();
    expect(openStage.aggregate.counts.a).toBe(1);
  });

  it('never leaks numeric correct/tolerance pre-reveal, and reveals them afterwards', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'numeric-q' });

    const openParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(openParticipant.interaction.correct).toBeUndefined();
    expect(openParticipant.interaction.tolerance).toBeUndefined();
    expect(bodyText(openParticipant)).not.toContain('"correct":42');

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'numeric-q',
      answer: { kind: 'numeric', value: 40 },
    });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: 'numeric-q' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: 'numeric-q' });

    const revealedParticipant = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(revealedParticipant.interaction.correct).toBe(42);
    expect(revealedParticipant.interaction.tolerance).toBe(5);
    expect(revealedParticipant.aggregate.values).toContain(40);
  });

  it('never leaks text correctAnswers pre-reveal, and reveals them afterwards', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'text-q' });

    const open = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(open.interaction.correctAnswers).toBeUndefined();
    expect(bodyText(open)).not.toContain('Paris');

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'text-q',
      answer: { kind: 'text', text: 'Paris' },
    });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: 'text-q' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: 'text-q' });

    const revealed = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(revealed.interaction.correctAnswers).toEqual(['Paris']);
  });

  it('never leaks ranking correctOrder pre-reveal, and reveals it afterwards', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'rank-q' });

    const open = await stateJson(session.sessionCode, participant.participantToken, 'participant');
    expect(open.interaction.correctOrder).toBeUndefined();

    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'rank-q',
      answer: { kind: 'ranking', optionIds: ['a', 'b'] },
    });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.close', interactionId: 'rank-q' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.reveal', interactionId: 'rank-q' });

    const revealed = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(revealed.interaction.correctOrder).toEqual(['b', 'a']);
  });
});
