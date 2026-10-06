import { describe, expect, it } from 'vitest';

import { learnerShareUrl, qnaShareUrl, remoteShareUrl, to } from './destinations';

describe('destinations', () => {
  it('names Home and the Library root without a place', () => {
    expect(to.home()).toEqual({ to: '/' });
    expect(to.library()).toEqual({ to: '/space' });
    expect(to.library({ spaceId: null })).toEqual({ to: '/space' });
  });

  it('carries space, folder, selected item and person into the Library', () => {
    expect(to.library({ spaceId: 'p1' })).toEqual({
      to: '/space/$spaceId',
      params: { spaceId: 'p1' },
      search: { folderId: undefined, itemId: undefined, contextId: undefined },
    });
    expect(to.library({ spaceId: 'p1', folderId: 'f2', itemId: 'd3', contextId: 'c4' })).toEqual({
      to: '/space/$spaceId',
      params: { spaceId: 'p1' },
      search: { folderId: 'f2', itemId: 'd3', contextId: 'c4' },
    });
  });

  it('gives a deck one create route and one editor', () => {
    expect(to.deckNew()).toEqual({
      to: '/decks/new',
      search: { contextId: undefined, spaceId: undefined, folderId: undefined },
    });
    expect(to.deckNew({ contextId: 'l1', spaceId: 'p1', folderId: 'f1' })).toEqual({
      to: '/decks/new',
      search: { contextId: 'l1', spaceId: 'p1', folderId: 'f1' },
    });
    expect(to.deckEditor('d1')).toEqual({ to: '/decks/$deckId/edit', params: { deckId: 'd1' } });
  });

  it('routes the live console and its companion surfaces by join code, token-less by default', () => {
    expect(to.sessionConsole('ABC123')).toEqual({
      to: '/sessions/$sessionCode',
      params: { sessionCode: 'ABC123' },
      search: { token: undefined },
    });
    expect(to.sessionRemote('ABC123', 'tok')).toEqual({
      to: '/sessions/$sessionCode/remote',
      params: { sessionCode: 'ABC123' },
      search: { token: 'tok' },
    });
    expect(to.sessionQna('ABC123')).toEqual({
      to: '/sessions/$sessionCode/qna',
      params: { sessionCode: 'ABC123' },
      search: { token: undefined },
    });
  });

  it('addresses Notes by the durable session id', () => {
    expect(to.sessionNotes('r1')).toEqual({
      to: '/sessions/$sessionKey/record',
      params: { sessionKey: 'r1' },
    });
  });

  it('opens one result document without a live credential or a collection route', () => {
    expect(to.savedResults('FILE1234')).toEqual({ to: '/results/$archiveId', params: { archiveId: 'FILE1234' } });
  });

  it('gives a space its own edit route, distinct from its members list', () => {
    expect(to.lessonExamples('sp-1', { folderId: 'folder-1', contextId: 'learner-1' })).toEqual({
      to: '/space/$spaceId/samples', params: { spaceId: 'sp-1' }, search: { folderId: 'folder-1', contextId: 'learner-1' },
    });
    expect(to.spaceEdit('sp-1')).toEqual({ to: '/space/$spaceId/edit', params: { spaceId: 'sp-1' } });
    expect(to.spaceMembers('sp-1')).toEqual({
      to: '/space/$spaceId/members',
      params: { spaceId: 'sp-1' },
    });
    expect(to.spaceInvite('sp-1')).toEqual({
      to: '/space/$spaceId/members/invite',
      params: { spaceId: 'sp-1' },
    });
    expect(to.spaceMemberEdit('sp-1', 'u2')).toEqual({
      to: '/space/$spaceId/members/$userId/edit',
      params: { spaceId: 'sp-1', userId: 'u2' },
    });
  });

  it('keeps the student surfaces on their own routes', () => {
    expect(to.students()).toEqual({ to: '/tutor/contexts' });
    expect(to.studentNew('sp-1', 'classroom')).toEqual({ to: '/tutor/contexts/new', search: { sourceSpaceId: 'sp-1', experience: 'classroom' } });
    expect(to.student('ctx-1')).toEqual({
      to: '/tutor/contexts/$contextId',
      params: { contextId: 'ctx-1' },
    });
    expect(to.studentEdit('ctx-1')).toEqual({
      to: '/tutor/contexts/$contextId/edit',
      params: { contextId: 'ctx-1' },
    });
    expect(to.studentLinkNew('ctx-1')).toEqual({
      to: '/tutor/contexts/$contextId/links/new',
      params: { contextId: 'ctx-1' },
    });
    expect(to.trash('sp-1')).toEqual({ to: '/tutor/trash', search: { spaceId: 'sp-1' } });
    expect(to.settings('sp-1')).toEqual({ to: '/settings', search: { spaceId: 'sp-1' } });
    expect(to.settingsTokenNew()).toEqual({ to: '/settings/tokens/new' });
    expect(to.learn('orlnk_a_b')).toEqual({ to: '/learn', search: { token: 'orlnk_a_b' } });
    expect(to.learn(null)).toEqual({ to: '/learn', search: { token: undefined } });
  });

});

describe('share URLs', () => {
  it('puts the token in the hash fragment, never on the wire', () => {
    expect(remoteShareUrl('R1', 'ht', 'https://openroom.app', '/host/')).toBe(
      'https://openroom.app/host#/sessions/R1/remote?token=ht',
    );
    expect(qnaShareUrl('R1', 'ht', 'https://openroom.app', '/host')).toBe(
      'https://openroom.app/host#/sessions/R1/qna?token=ht',
    );
    expect(learnerShareUrl('https://openroom.app', '/host/', 'orlnk_a_b')).toBe(
      'https://openroom.app/host#/learn?token=orlnk_a_b',
    );
  });
});
