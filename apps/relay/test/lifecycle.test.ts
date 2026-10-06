/**
 * Full lifecycle e2e against the real example outline (examples/seg-camp.yaml):
 * create → join → advance through every interaction with submits → reveal →
 * end → export (json + csv).
 *
 * The YAML is inlined at build/transform time via Vite's `?raw` import
 * suffix (no filesystem access at runtime inside workerd), then parsed with
 * the `yaml` package and validated with `@openroom/schema` exactly like the
 * CLI / host app would.
 */
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateSession } from '@openroom/schema';

import { call, command, createSessionWithOutline, join, stateJson } from './helpers.js';
// eslint-disable-next-line import/no-unresolved
import segCampYaml from '../../../examples/seg-camp.yaml?raw';

function buildAnswer(interaction: any, seed: number): Record<string, unknown> {
  switch (interaction.type) {
    case 'choice': {
      const option = interaction.options[seed % interaction.options.length];
      return { kind: 'choice', optionIds: [option.id] };
    }
    case 'scale': {
      const span = interaction.max - interaction.min + 1;
      return { kind: 'scale', value: interaction.min + (seed % span) };
    }
    case 'numeric': {
      const base = typeof interaction.correct === 'number' ? interaction.correct : 50;
      return { kind: 'numeric', value: base + seed };
    }
    case 'text': {
      const cap = typeof interaction.maxLength === 'number' ? interaction.maxLength : 200;
      const text = `p${seed}-answer`.slice(0, Math.max(1, cap));
      return { kind: 'text', text };
    }
    case 'qna':
      return { kind: 'qna', text: `question ${seed} about ${interaction.id}` };
    default:
      throw new Error(`unhandled interaction type: ${interaction.type}`);
  }
}

describe('full lifecycle e2e (examples/seg-camp.yaml)', () => {
  it('validates, runs every interaction end to end, and exports complete data', async () => {
    const parsed = parseYaml(segCampYaml);
    const validated = validateSession(parsed);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const outline = validated.session;
    expect(outline.interactions.length).toBeGreaterThanOrEqual(5);

    const session = await createSessionWithOutline(outline);
    const participants = await Promise.all(Array.from({ length: 5 }, () => join(session.code)));

    await command(session.sessionCode, session.hostToken, { command: 'session.start' });

    for (const interaction of outline.interactions) {
      const open = await command(session.sessionCode, session.hostToken, {
        command: 'interaction.open',
        interactionId: interaction.id,
      });
      expect(open.status).toBe(200);

      if (interaction.type === 'qna') {
        // everyone posts a question, then the second participant upvotes the first's
        for (let i = 0; i < participants.length; i += 1) {
          const actor = participants[i]!;
          const res = await command(session.sessionCode, actor.participantToken, {
            command: 'answer.submit',
            interactionId: interaction.id,
            answer: buildAnswer(interaction, i),
          });
          expect(res.status).toBe(200);
        }
        const voter = participants[1]!;
        const target = participants[0]!;
        const vote = await command(session.sessionCode, voter.participantToken, {
          command: 'qna.vote',
          interactionId: interaction.id,
          targetParticipantId: target.participantId,
        });
        expect(vote.status).toBe(200);
      } else {
        for (let i = 0; i < participants.length; i += 1) {
          const actor = participants[i]!;
          const res = await command(session.sessionCode, actor.participantToken, {
            command: 'answer.submit',
            interactionId: interaction.id,
            answer: buildAnswer(interaction, i),
          });
          expect(res.status).toBe(200);
        }
      }

      const close = await command(session.sessionCode, session.hostToken, {
        command: 'interaction.close',
        interactionId: interaction.id,
      });
      expect(close.status).toBe(200);

      const reveal = await command(session.sessionCode, session.hostToken, {
        command: 'interaction.reveal',
        interactionId: interaction.id,
      });
      expect(reveal.status).toBe(200);
    }

    const hostBeforeEnd = await stateJson(session.sessionCode, session.hostToken, 'host');
    for (const summary of hostBeforeEnd.interactions) {
      expect(summary.status).toBe('revealed');
    }

    const endRes = await command(session.sessionCode, session.hostToken, { command: 'session.end' });
    expect(endRes.status).toBe(200);

    const hostAfterEnd = await stateJson(session.sessionCode, session.hostToken, 'host');
    expect(hostAfterEnd.status).toBe('ended');

    // ---- export: json ----------------------------------------------------
    const jsonExportRes = await call(`/api/sessions/${session.sessionCode}/export?format=json`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(jsonExportRes.status).toBe(200);
    const jsonExport = (await jsonExportRes.json()) as { interactions: any[] };
    expect(jsonExport.interactions).toHaveLength(outline.interactions.length);
    for (const entry of jsonExport.interactions) {
      expect(entry.status).toBe('revealed');
      expect(entry.aggregate).not.toBeNull();
    }
    const exportedIds = jsonExport.interactions.map((entry) => entry.id).sort();
    expect(exportedIds).toEqual(outline.interactions.map((i) => i.id).sort());

    // ---- export: counts csv (free) ----------------------------------------
    const countsRes = await call(`/api/sessions/${session.sessionCode}/export?format=csv`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(countsRes.status).toBe(200);
    const countsText = await countsRes.text();
    expect(countsText.split('\n')[0]).toBe('interactionId,prompt,type,status,total,summary');

    // ---- export: ballots csv (ops / unowned sessions) ------------------------
    const csvExportRes = await call(`/api/sessions/${session.sessionCode}/export?format=ballots`, {
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(csvExportRes.status).toBe(200);
    const csvText = await csvExportRes.text();
    const lines = csvText.split('\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('interactionId,prompt,participantId,handle,answer,hidden');

    const expectedRows = Object.values(hostAfterEnd.ballots as Record<string, Record<string, unknown>>).reduce(
      (sum, ballotsForInteraction) => sum + Object.keys(ballotsForInteraction).length,
      0,
    );
    expect(lines.length - 1).toBe(expectedRows);
    expect(expectedRows).toBeGreaterThan(0);

    // ---- export requires the host token -----------------------------------
    const someParticipant = participants[0]!;
    const participantExportAttempt = await call(`/api/sessions/${session.sessionCode}/export?format=json`, {
      headers: { authorization: `Bearer ${someParticipant.participantToken}` },
    });
    expect(participantExportAttempt.status).toBe(403);
  // This journey performs the complete interaction/answer/export sequence;
  // its timeout is an integration-test budget, not a ballot latency assertion.
  }, 30_000);
});
