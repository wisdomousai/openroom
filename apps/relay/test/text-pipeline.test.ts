/**
 * Text pipeline: blocklist, hide/unhide, freeze/unfreeze.
 */
import { describe, expect, it } from 'vitest';

import { command, createSessionWithOutline, join, stateJson } from './helpers.js';

const OUTLINE = {
  version: 1,
  meta: { title: 'Text pipeline outline' },
  interactions: [
    {
      id: 'discuss',
      type: 'text',
      prompt: 'Say anything',
      resultVisibility: 'live',
    },
  ],
};

describe('text pipeline', () => {
  it('hides a blocklisted submission from the stage but flags it (visible) on the host', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const clean = await join(session.code);
    const rude = await join(session.code);

    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'discuss' });

    await command(session.sessionCode, clean.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'This session is great so far' },
    });
    // 'shit' is a real SUBSTRING_TERMS entry in packages/domain/src/blocklist.ts
    const rudeRes = await command(session.sessionCode, rude.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'this outline is total shit' },
    });
    expect(rudeRes.status).toBe(200); // submission is accepted, just hidden

    const stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    const stageTexts = stage.aggregate.entries.map((e: any) => e.text);
    expect(stageTexts).toContain('This session is great so far');
    expect(stageTexts.some((t: string) => t.includes('shit'))).toBe(false);
    expect(stage.aggregate.entries).toHaveLength(1);

    const host = await stateJson(session.sessionCode, session.hostToken, 'host');
    const hostBallots = host.ballots.discuss as Record<string, any>;
    expect(hostBallots[rude.participantId].hidden).toBe(true);
    expect(hostBallots[rude.participantId].text).toContain('shit');
    expect(hostBallots[clean.participantId].hidden).toBe(false);
  });

  it('text.hide / text.unhide roundtrips are reflected on the stage', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'discuss' });
    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'a perfectly normal comment' },
    });

    let stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.aggregate.entries).toHaveLength(1);

    const hideRes = await command(session.sessionCode, session.hostToken, {
      command: 'text.hide',
      interactionId: 'discuss',
      participantId: participant.participantId,
    });
    expect(hideRes.status).toBe(200);
    stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.aggregate.entries).toHaveLength(0);

    const unhideRes = await command(session.sessionCode, session.hostToken, {
      command: 'text.unhide',
      interactionId: 'discuss',
      participantId: participant.participantId,
    });
    expect(unhideRes.status).toBe(200);
    stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.aggregate.entries).toHaveLength(1);
  });

  it('freezing hides ALL stage text (even non-hidden) and blocks new submissions with 422 E_FROZEN; unfreeze restores', async () => {
    const session = await createSessionWithOutline(OUTLINE);
    const participant = await join(session.code);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, { command: 'interaction.open', interactionId: 'discuss' });
    await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'visible before freeze' },
    });

    let stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.aggregate.entries).toHaveLength(1);

    const freezeRes = await command(session.sessionCode, session.hostToken, { command: 'session.freeze' });
    expect(freezeRes.status).toBe(200);

    stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.frozen).toBe(true);
    expect(stage.aggregate.entries).toHaveLength(0);

    const blockedSubmit = await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'trying to sneak one in' },
    });
    expect(blockedSubmit.status).toBe(422);
    const blockedBody = (await blockedSubmit.json()) as { error: { code: string } };
    expect(blockedBody.error.code).toBe('E_FROZEN');

    const unfreezeRes = await command(session.sessionCode, session.hostToken, { command: 'session.unfreeze' });
    expect(unfreezeRes.status).toBe(200);

    stage = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stage.frozen).toBe(false);
    expect(stage.aggregate.entries).toHaveLength(1);

    const allowedSubmit = await command(session.sessionCode, participant.participantToken, {
      command: 'answer.submit',
      interactionId: 'discuss',
      answer: { kind: 'text', text: 'back online' },
    });
    expect(allowedSubmit.status).toBe(200);
  });
});
