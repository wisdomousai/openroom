import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import type { Io } from '../src/output.js';

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}

let dir: string;
let previousCwd: string;

beforeEach(() => {
  previousCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'openroom-cli-'));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(previousCwd);
});

describe('init → validate roundtrip', () => {
  it('writes a starter session that validates', async () => {
    const first = capture();
    expect(await run(['init'], { io: first.io })).toBe(0);
    expect(readFileSync(join(dir, 'session.yaml'), 'utf8')).toContain('title: My first session');
    expect(readFileSync(join(dir, 'session.yaml'), 'utf8')).toContain('questions:');

    const second = capture();
    expect(await run(['validate', 'session.yaml'], { io: second.io })).toBe(0);
    expect(second.out.join('\n')).toMatch(/^✓ valid \(3 interactions\)$/m);
  });

  it('refuses to overwrite without --force', async () => {
    await run(['init'], { io: capture().io });
    const again = capture();
    expect(await run(['init'], { io: again.io })).toBe(1);
    expect(again.err.join('\n')).toContain('refusing to overwrite');

    const forced = capture();
    expect(await run(['init', '--force'], { io: forced.io })).toBe(0);
  });

  it('--json emits a single object on stdout', async () => {
    await run(['init'], { io: capture().io });
    const cap = capture();
    expect(await run(['validate', 'session.yaml', '--json'], { io: cap.io })).toBe(0);
    expect(cap.out).toHaveLength(1);
    expect(JSON.parse(cap.out[0] as string)).toEqual({
      ok: true,
      errors: [],
      interactionCount: 3,
    });
  });
});

describe('validate errors', () => {
  it('reports E_DISPLAY_MISMATCH with path and exit code 1', async () => {
    const file = join(dir, 'broken.yaml');
    writeFileSync(
      file,
      `version: 1
meta:
  title: Broken
interactions:
  - id: bad-display
    type: scale
    prompt: How sure are you?
    display: pie
    min: 1
    max: 5
`,
      'utf8',
    );

    const cap = capture();
    expect(await run(['validate', 'broken.yaml', '--json'], { io: cap.io })).toBe(1);
    const payload = JSON.parse(cap.out[0] as string) as {
      ok: boolean;
      errors: { code: string; path: string }[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.errors.some((e) => e.code === 'E_DISPLAY_MISMATCH')).toBe(true);
    expect(payload.errors[0]?.path).toContain('/interactions/0');

    const human = capture();
    expect(await run(['validate', 'broken.yaml'], { io: human.io })).toBe(1);
    expect(human.err.join('\n')).toMatch(/E_DISPLAY_MISMATCH \/interactions\/0\/display /);
  });

  it('exits 2 on usage errors', async () => {
    const cap = capture();
    expect(await run(['validate'], { io: cap.io })).toBe(2);
    expect(await run(['nope'], { io: capture().io })).toBe(2);
  });
});

describe('preview', () => {
  // The starter is deliberately plain, so the stripping test brings its own
  // session with every host-only field on board.
  const RICH_SESSION = `version: 1
meta:
  title: Rich preview fixture
interactions:
  - id: quiz
    type: choice
    prompt: Pick one.
    options:
      - id: need-an-idea
        label: The right one
        correct: true
      - id: wrong
        label: The wrong one
        misconception: The classic trap.
    notes: Host eyes only.
  - id: estimate
    type: numeric
    prompt: How many?
    unit: businesses
    correct: 350000
    tolerance: 50000
`;

  it('shows host detail but strips notes/correct from the participant line', async () => {
    writeFileSync(join(dir, 'rich.yaml'), RICH_SESSION);
    const cap = capture();
    expect(await run(['preview', 'rich.yaml'], { io: cap.io })).toBe(0);
    const text = cap.out.join('\n');

    expect(text).toContain('✓ need-an-idea');
    expect(text).toContain('misconception:');
    expect(text).toContain('correct: 350000 businesses ± 50000');
    expect(text).toContain('notes:');

    const participantLines = cap.out.filter((line) => line.includes('participant sees:'));
    expect(participantLines).toHaveLength(2);
    const joined = participantLines.join('\n');
    expect(joined).not.toContain('"notes"');
    expect(joined).not.toContain('"correct"');
    expect(joined).not.toContain('"misconception"');
    expect(joined).not.toContain('"tolerance"');
    expect(joined).toContain('"need-an-idea"');
  });

  it('--json emits session + participantViews', async () => {
    await run(['init'], { io: capture().io });
    const cap = capture();
    expect(await run(['preview', 'session.yaml', '--json'], { io: cap.io })).toBe(0);
    expect(cap.out).toHaveLength(1);
    const payload = JSON.parse(cap.out[0] as string) as {
      session: { interactions: { display: string }[] };
      participantViews: Record<string, unknown>[];
    };
    expect(payload.participantViews).toHaveLength(3);
    // normalized: every interaction has an explicit display
    expect(payload.session.interactions.every((i) => typeof i.display === 'string')).toBe(true);
    expect(JSON.stringify(payload.participantViews)).not.toContain('"correct"');
  });
});
