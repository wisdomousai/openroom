import { describe, expect, it } from 'vitest';
import { numberedLabels } from './WorkspaceUpdates';

describe('write-notes prompts', () => {
  it('numbers prompts that would read the same and leaves the others alone', () => {
    const rows = [
      { contextName: 'Léa', title: 'Au café' },
      { contextName: 'Léa', title: 'Au café' },
      { contextName: 'Noor', title: 'Au café' },
    ];
    expect(numberedLabels(rows).map(({ label }) => label)).toEqual([
      'Write the notes for Léa’s session, Au café',
      'Write the notes for Léa’s session, Au café · 2',
      'Write the notes for Noor’s session, Au café',
    ]);
  });
});
