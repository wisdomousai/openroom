import { describe, expect, it } from 'vitest';
import { savedResultsHtml, type SavedResults } from '@openroom/schema';
import { call, command, createSessionWithOutline, join } from './helpers';

describe('saved result documents', () => {
  it('captures readable labels for every question type without identities, hidden text, or teaching guidance', async () => {
    const session = await createSessionWithOutline({ version: 1, meta: { title: '<script>unsafe()</script>' }, qna: { enabled: true }, interactions: [
      { id: 'choice', type: 'choice', prompt: 'Choose', options: [{ id: 'a', label: 'Small pilot', correct: true }, { id: 'b', label: 'Full launch' }], notes: 'PRIVATE_NOTE' },
      { id: 'scale', type: 'scale', prompt: 'Confidence', min: 1, max: 5 },
      { id: 'number', type: 'numeric', prompt: 'Estimate' },
      { id: 'rank', type: 'ranking', prompt: 'Priorities', options: [{ id: 'a', label: 'Learn' }, { id: 'b', label: 'Launch' }] },
      { id: 'gap', type: 'fill-the-gaps', prompt: 'Say {{hello}}', gaps: [{ id: 'hello', answers: ['Bonjour'] }] },
      { id: 'match', type: 'match', prompt: 'Match', left: [{ id: 'l1', label: 'Un' }, { id: 'l2', label: 'Deux' }], right: [{ id: 'r1', label: 'One' }, { id: 'r2', label: 'Two' }], correct: { l1: 'r1', l2: 'r2' } },
      { id: 'text', type: 'text', prompt: 'Suggestion' },
      { id: 'qna', type: 'qna', prompt: 'Question' },
    ] });
    const learner = await join(session.code), hidden = await join(session.code);
    await command(session.code, session.hostToken, { command: 'session.start' });
    const answers = [
      ['choice', { kind: 'choice', optionIds: ['a'] }], ['scale', { kind: 'scale', value: 3 }], ['number', { kind: 'numeric', value: 7 }],
      ['rank', { kind: 'ranking', optionIds: ['b', 'a'] }], ['gap', { kind: 'fill-the-gaps', gaps: { hello: 'Salut' } }],
      ['match', { kind: 'match', pairs: { l1: 'r2', l2: 'r1' } }], ['text', { kind: 'text', text: '<img src=x onerror=unsafe()>' }], ['qna', { kind: 'qna', text: 'Can we try again?' }],
    ] as const;
    for (const [id, answer] of answers) {
      expect((await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: id })).status).toBe(200);
      const response = await command(session.code, learner.participantToken, { command: 'answer.submit', interactionId: id, answer });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    await command(session.code, session.hostToken, { command: 'interaction.open', interactionId: 'text' });
    await command(session.code, hidden.participantToken, { command: 'answer.submit', interactionId: 'text', answer: { kind: 'text', text: 'HIDDEN_RESPONSE' } });
    await command(session.code, session.hostToken, { command: 'text.hide', interactionId: 'text', participantId: hidden.participantId });
    const response = await call(`/api/sessions/${session.code}/export?format=json`, { headers: { authorization: `Bearer ${session.hostToken}` } });
    const { summary } = await response.json() as { summary: SavedResults };
    expect(summary.questions).toMatchObject([
      { rows: [{ label: 'Small pilot', value: 1 }, { label: 'Full launch', value: 0 }] },
      { rows: [1, 2, 3, 4, 5].map((value) => ({ label: String(value), value: value === 3 ? 1 : 0 })) }, { rows: [{ label: 'Mean', value: 7 }, { label: 'Median', value: 7 }] },
      { measure: 'Points', rows: [{ label: 'Launch', value: 2 }, { label: 'Learn', value: 1 }] },
      { prompt: 'Say ____ (1)', rows: [{ label: 'Blank 1: Salut', value: 1 }] },
      { rows: [{ label: 'Un → Two', value: 1 }, { label: 'Deux → One', value: 1 }] },
      { entries: ['<img src=x onerror=unsafe()>'] }, { entries: ['Can we try again?'] },
    ]);
    for (const secret of [learner.participantId, hidden.participantId, 'PRIVATE_NOTE', 'HIDDEN_RESPONSE', 'Bonjour', 'correct']) expect(JSON.stringify(summary)).not.toContain(secret);
    const html = savedResultsHtml(summary);
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=unsafe()&gt;');
    expect(html).not.toContain('<img'); expect(html).not.toContain('<script');
  });
});
