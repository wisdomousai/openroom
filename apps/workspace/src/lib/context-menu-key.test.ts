import { describe, expect, it } from 'vitest';

import { uniqueName } from './context-menu-key';

describe('uniqueName', () => {
  it('keeps the base name when no sibling has it', () => {
    expect(uniqueName('New folder', ['Week 1', 'Homework'])).toBe('New folder');
  });

  it('numbers past every name already taken, ignoring case and spaces', () => {
    expect(uniqueName('New folder', ['new folder ', 'New folder 2', 'Week 1'])).toBe('New folder 3');
  });
});
