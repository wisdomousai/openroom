import { describe, expect, it } from 'vitest';
import { parseSpaceSettings, readSpaceSettings } from '../src/space-settings.js';

describe('space settings', () => {
  it('keeps experience independent of optional or invalid languages', () => {
    expect(parseSpaceSettings({ experience: 'training' })).toEqual({ experience: 'training' });
    expect(parseSpaceSettings({ experience: 'tutoring', languages: { taught: 'fr', native: 'en' } }))
      .toEqual({ experience: 'tutoring', languages: { taught: 'fr', native: 'en' } });
    expect(parseSpaceSettings({ experience: 'training', languages: { taught: 'unknown', native: 'en' } }))
      .toEqual({ experience: 'training' });
  });

  it('narrows malformed storage and does not turn arbitrary settings into capabilities', () => {
    expect(readSpaceSettings('broken')).toEqual({ experience: 'classroom' });
    expect(parseSpaceSettings({ experience: 'admin', team: true, languages: { taught: 'de', native: 'en' } }))
      .toEqual({ experience: 'classroom', languages: { taught: 'de', native: 'en' } });
  });
});
