import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeSession, parseSession, parseOutline, participantView } from '../src/index.js';

const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));
const tutoringDir = join(examplesDir, 'tutoring');
const tutoringFiles = readdirSync(tutoringDir).filter(
  (name) => name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json'),
);

const files = readdirSync(examplesDir).filter(
  (name) => name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json'),
);

describe('examples/', () => {
  it('contains the documented example sessions', () => {
    expect(files.sort()).toEqual(
      [
        '00-simple.yaml',
        '01-first-poll.yaml',
        '02-class-checkin.yaml',
        '03-quick-quiz.yaml',
        '04-type-answer.yaml',
        '05-correct-order.yaml',
        '06-true-false.yaml',
        'estimation.yaml',
        'exit-ticket.yaml',
        'peer-instruction.yaml',
        'ranking.yaml',
        'seg-camp.yaml',
      ].sort(),
    );
  });

  it.each(files)('%s validates, normalizes and projects cleanly', (name) => {
    const text = readFileSync(join(examplesDir, name), 'utf8');
    const result = parseSession(text);
    if (!result.ok) {
      throw new Error(`${name} failed validation: ${JSON.stringify(result.errors, null, 2)}`);
    }
    const normalized = normalizeSession(result.session);
    expect(normalized.interactions.length).toBeGreaterThan(0);
    for (const interaction of normalized.interactions) {
      const view = participantView(normalized, interaction.id);
      expect(view).not.toBeNull();
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('"notes"');
      expect(serialized).not.toContain('"correct"');
      expect(serialized).not.toContain('"misconception"');
      expect(serialized).not.toContain('"tolerance"');
      expect(serialized).not.toContain('"correctAnswers"');
      expect(serialized).not.toContain('"correctOrder"');
    }
  });
});

describe('examples/tutoring/ — the worked Outline v1 references', () => {
  it('has at least one tutoring outline', () => {
    expect(tutoringFiles.length).toBeGreaterThan(0);
  });

  it.each(tutoringFiles)('%s validates as an Outline and compiles to a session', (name) => {
    const text = readFileSync(join(tutoringDir, name), 'utf8');
    const result = parseOutline(text);
    if (!result.ok) {
      throw new Error(`${name} failed validation: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.session.interactions.length).toBeGreaterThan(0);
  });
});
