/**
 * Session-wide audience Q&A through the worker: command round-trips, snapshot
 * shapes on the wire, exports, and — critically — the results-channel broadcast
 * carve-out that pushes Q&A changes to participant sockets even while the
 * active poll's results are hidden (which must itself stay silent).
 */
import { describe, expect, it } from 'vitest';

import {
  BASE,
  command,
  createLiveSession,
  createSessionWithOutline,
  join,
  SMOKE_OUTLINE,
  stateJson,
  waitFor,
} from './helpers.js';
import worker from '../src/index.js';
import { env } from 'cloudflare:test';

const QNA_OUTLINE = { ...SMOKE_OUTLINE, qna: { enabled: true } };

interface SessionChangedFrame {
  v: 1;
  type: 'session.changed';
  revision: number;
}

async function connect(
  sessionCode: string,
  token: string,
): Promise<{ ws: WebSocket; frames: SessionChangedFrame[] }> {
  const res = await worker.fetch(
    new Request(`${BASE}/api/sessions/${sessionCode}/ws?token=${encodeURIComponent(token)}`, {
      headers: { upgrade: 'websocket' },
    }),
    env as never,
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (ws === null) throw new Error('expected a websocket in the upgrade response');
  ws.accept();
  const frames: SessionChangedFrame[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    frames.push(JSON.parse(event.data as string));
  });
  return { ws, frames };
}

describe('session qna — commands and snapshots', () => {
  it('round-trips ask, upvote, hide and stage placement across the three roles', async () => {
    const session = await createSessionWithOutline(QNA_OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const asker = await join(session.code);
    const voter = await join(session.code);

    const asked = await command(session.sessionCode, asker.participantToken, {
      command: 'qna.ask',
      questionId: 'q-one',
      text: 'When is the exam?',
    });
    expect(asked.status).toBe(200);
    const voted = await command(session.sessionCode, voter.participantToken, {
      command: 'qna.upvote',
      questionId: 'q-one',
    });
    expect(voted.status).toBe(200);

    const participantView = await stateJson(session.sessionCode, voter.participantToken, 'participant');
    expect(participantView.qna.questions).toEqual([
      {
        id: 'q-one',
        text: 'When is the exam?',
        votes: 1,
        own: false,
        votedByYou: true,
        hidden: false,
      },
    ]);

    const repeat = await command(session.sessionCode, voter.participantToken, {
      command: 'qna.upvote',
      questionId: 'q-one',
    });
    expect(repeat.status).toBe(403);

    const spotlight = await command(session.sessionCode, session.hostToken, {
      command: 'qna.stage',
      mode: 'spotlight',
      questionId: 'q-one',
    });
    expect(spotlight.status).toBe(200);
    const stageView = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stageView.qna.stage).toEqual({ mode: 'spotlight', questionId: 'q-one' });
    expect(stageView.qna.questions).toEqual([{ id: 'q-one', text: 'When is the exam?', votes: 1 }]);

    const hidden = await command(session.sessionCode, session.hostToken, {
      command: 'qna.hide',
      questionId: 'q-one',
    });
    expect(hidden.status).toBe(200);
    const hostView = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(hostView.qna.stage).toEqual({ mode: 'list' }); // spotlight fell back
    expect(hostView.qna.questions[0]).toMatchObject({
      id: 'q-one',
      participantId: asker.participantId,
      hidden: true,
      votes: 1,
    });
    expect(JSON.stringify(hostView.qna)).not.toContain('voters');

    const stageAfterHide = await stateJson(session.sessionCode, session.stageToken, 'stage');
    expect(stageAfterHide.qna.questions).toEqual([]);
  });

  it('rejects qna commands when the outline does not enable session Q&A', async () => {
    const session = await createLiveSession();
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const p = await join(session.code);
    const res = await command(session.sessionCode, p.participantToken, {
      command: 'qna.ask',
      questionId: 'q1',
      text: 'hi',
    });
    expect(res.status).toBe(403);
    const view = await stateJson(session.sessionCode, p.participantToken, 'participant');
    expect(view.qna).toBeUndefined();
  });
});

describe('session qna — participant fan-out carve-out', () => {
  // The deliberate settle/silence windows (1.4s + 1.3s) plus two waitFor
  // rounds put this well past the 5s default.
  it('pushes a frame to a participant behind a hidden-results poll after qna.ask, while a plain ballot stays silent', { timeout: 20_000 }, async () => {
    // SMOKE_OUTLINE's warmup normalizes to 'hidden-until-close': ballot ticks must
    // NOT reach participants (websocket.test.ts guards that). Session Q&A ticks
    // MUST, because the question list is a shared surface.
    const session = await createSessionWithOutline(QNA_OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    await command(session.sessionCode, session.hostToken, {
      command: 'interaction.open',
      interactionId: 'warmup',
    });

    const watcher = await join(session.code);
    const { ws, frames } = await connect(session.sessionCode, watcher.participantToken);
    try {
      // Settle past BOTH coalescing intervals (250ms lifecycle, 1s results) so
      // every pending tick from the setup commands and joins has flushed before
      // the silence assertion starts counting.
      await new Promise((resolve) => setTimeout(resolve, 1400));
      frames.length = 0;

      // A hidden-results ballot: still silent for participants.
      const pollVoter = await join(session.code);
      await command(session.sessionCode, pollVoter.participantToken, {
        command: 'answer.submit',
        interactionId: 'warmup',
        answer: { kind: 'choice', optionIds: ['a'] },
      });
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(JSON.stringify(frames)).toBe('[]');

      // A session Q&A ask: must reach the watching participant within the 1s tick.
      const asker = await join(session.code);
      await command(session.sessionCode, asker.participantToken, {
        command: 'qna.ask',
        questionId: 'q-live',
        text: 'Can everyone see this?',
      });
      const sawAsk = await waitFor(() => frames.length > 0, 2500);
      expect(sawAsk).toBe(true);

      // And an upvote too.
      frames.length = 0;
      const upvoter = await join(session.code);
      await command(session.sessionCode, upvoter.participantToken, {
        command: 'qna.upvote',
        questionId: 'q-live',
      });
      const sawVote = await waitFor(() => frames.length > 0, 2500);
      expect(sawVote).toBe(true);
    } finally {
      ws.close();
    }
  });
});

describe('session qna — exports', () => {
  it('includes questions in the JSON export and session-qna rows in the CSV', async () => {
    const session = await createSessionWithOutline(QNA_OUTLINE);
    await command(session.sessionCode, session.hostToken, { command: 'session.start' });
    const asker = await join(session.code);
    await command(session.sessionCode, asker.participantToken, {
      command: 'qna.ask',
      questionId: 'q-x',
      text: 'Exported?',
    });

    const jsonRes = await worker.fetch(
      new Request(
        `${BASE}/api/sessions/${session.sessionCode}/export?format=json&token=${encodeURIComponent(session.hostToken)}`,
      ),
      env as never,
    );
    expect(jsonRes.status).toBe(200);
    const exported = (await jsonRes.json()) as {
      qna?: { questions: { text: string; votes: number }[] };
    };
    expect(exported.qna?.questions[0]).toMatchObject({ text: 'Exported?', votes: 0 });

    const csvRes = await worker.fetch(
      new Request(
        `${BASE}/api/sessions/${session.sessionCode}/export?format=ballots&token=${encodeURIComponent(session.hostToken)}`,
      ),
      env as never,
    );
    expect(csvRes.status).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toContain('"session-qna","Audience Q&A"');
    expect(csv).toContain('Exported? (0 votes)');
  });
});
