import { describe, expect, it } from 'vitest';

import {
  editableOutlineForOpenRoomFile,
  materializeOpenRoomFile,
  mergeOutlines,
  outlineContentHash,
  parseOpenRoomFile,
  stringifyOpenRoomFile,
  updateOpenRoomFileOutline,
  defaultDeckDesign,
  outlineResourceIds,
  type OpenRoomFileV1,
  type Outline,
} from '../src/index.js';

const resourceId = 'a5765fa0-27e6-4dd0-8de6-6b225409f23d';
const sha256 = '8'.repeat(64);

const outline: Outline = {
  version: 1,
  meta: { title: 'French practice' },
  steps: [
    { id: 'welcome', kind: 'title', title: 'Bonjour' },
    { id: 'check', kind: 'interaction', interactionId: 'check' },
  ],
  interactions: [{
    id: 'check',
    type: 'choice',
    prompt: 'Ready?',
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'Not yet' }],
  }],
};

function file(): OpenRoomFileV1 {
  return {
    format: 'openroom-file',
    fileVersion: 1,
    fileId: '4d36e96e-e325-4c02-b17c-9db15d79d884',
    localRevision: 2,
    outline,
  };
}

describe('.openroom file contract', () => {
  it.each([
    { ...outline, design: {} },
    { ...outline, design: { ...defaultDeckDesign(), masters: {} } },
    { ...outline, design: { ...defaultDeckDesign(), masters: [null] } },
    { ...outline, steps: [null] },
  ])('returns validation errors for malformed document structures before resolving media', (invalidOutline) => {
    const parsed = parseOpenRoomFile(JSON.stringify({ ...file(), outline: invalidOutline }));
    expect(parsed).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/^\/outline\//) })]) });
  });

  it('preserves master backgrounds, logos and slide backgrounds through local editing and cloud sync', () => {
    const ids = [resourceId, '4bfd3a43-d9fd-4d17-a861-dbb261bf172d', '2ec03e9e-8ed8-4ddd-94ed-11847531dd8f'];
    const image = (id: string) => ({ kind: 'image' as const, resourceId: id, focal: { x: 20, y: 70 }, overlay: { color: '#FFFFFF', opacity: 0.8 } });
    const design = defaultDeckDesign();
    design.masters[0]!.background = image(ids[0]!);
    design.masters[0]!.logo = { resourceId: ids[1]!, alt: 'Language school' };
    const original: OpenRoomFileV1 = { ...file(), resources: Object.fromEntries(ids.map((id) => [id, {
      path: `resources/${id}.png`, name: 'picture.png', contentType: 'image/png' as const, size: 100, sha256,
    }])), outline: { ...outline, design, steps: [{ ...outline.steps[0]!, design: { background: image(ids[2]!) } }, ...outline.steps.slice(1)] } };
    expect(parseOpenRoomFile(stringifyOpenRoomFile(original)).ok).toBe(true);
    expect(outlineResourceIds(original.outline)).toEqual(ids);
    const editable = editableOutlineForOpenRoomFile(original);
    expect(editable.design?.masters[0]?.background).toMatchObject({ url: `https://local.openroom.invalid/${ids[0]}` });
    expect(editable.design?.masters[0]?.logo).toEqual({ url: `https://local.openroom.invalid/${ids[1]}`, alt: 'Language school' });
    expect(editable.steps[0]?.design?.background).toMatchObject({ url: `https://local.openroom.invalid/${ids[2]}` });
    expect(updateOpenRoomFileOutline(original, editable).outline).toEqual(original.outline);
    expect(materializeOpenRoomFile(original).ok).toBe(false);
    for (const [id, resource] of Object.entries(original.resources!)) resource.online = { kind: 'openroom-asset', assetId: `asset-${id}`, sha256 };
    const cloud = materializeOpenRoomFile(original);
    expect(cloud.ok).toBe(true);
    if (!cloud.ok) return;
    expect(cloud.outline.design?.masters[0]?.logo).toMatchObject({ assetId: `asset-${ids[1]}`, url: `/api/assets/asset-${ids[1]}` });
    expect(updateOpenRoomFileOutline(original, cloud.outline).outline).toEqual(original.outline);
    expect(editableOutlineForOpenRoomFile(original)).toEqual(editable);
    original.resources![ids[0]!]!.contentType = 'audio/mpeg';
    expect(parseOpenRoomFile(stringifyOpenRoomFile(original))).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: '/outline/design/masters/0/background' })] });
  });
  it.each([
    ['https://openroom.app/', true],
    ['http://127.0.0.1:8787/', true],
    ['http://localhost:8787/', true],
    ['http://[::1]:8787/', true],
    ['http://openroom.app/', false],
    ['http://localhost.example.com/', false],
    ['https://name:password@openroom.app/', false],
    ['https://openroom.app/host/', false],
    ['https://openroom.app/?token=secret', false],
    ['https://openroom.app/#deck', false],
  ])('validates the cloud origin %s before a file can be opened', (origin, accepted) => {
    const linked = { ...file(), remote: { origin, deckId: 'deck', baseVersion: 1, baseContentHash: sha256, baseOutline: outline } };
    const parsed = parseOpenRoomFile(stringifyOpenRoomFile(linked));
    expect(parsed.ok).toBe(accepted);
    if (!parsed.ok) expect(parsed.errors).toContainEqual(expect.objectContaining({ path: '/remote/origin' }));
  });

  it('round-trips an embedded resource and requires retained bytes before remote sync', () => {
    const withMedia: OpenRoomFileV1 = {
      ...file(),
      resources: {
        [resourceId]: {
          path: `resources/${resourceId}.jpg`,
          name: 'photo.jpg',
          contentType: 'image/jpeg',
          size: 123,
          sha256,
        },
      },
      outline: {
        ...outline,
        steps: [
          ...outline.steps,
          { id: 'photo', kind: 'media', media: { type: 'image', resourceId, alt: 'Class project' } },
        ],
      },
    };
    const parsed = parseOpenRoomFile(stringifyOpenRoomFile(withMedia));
    expect(parsed.ok).toBe(true);
    expect(materializeOpenRoomFile(withMedia)).toEqual(expect.objectContaining({ ok: false }));

    withMedia.resources![resourceId]!.online = { kind: 'openroom-asset', assetId: 'asset-1', sha256 };
    const materialized = materializeOpenRoomFile(withMedia);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    expect(materialized.outline.steps[2]).toEqual(expect.objectContaining({
      media: expect.objectContaining({ assetId: 'asset-1', url: '/api/assets/asset-1' }),
    }));
  });

  it('rejects package entries outside the resource namespace', () => {
    const escaped = {
      ...file(),
      resources: {
        [resourceId]: {
          path: '../secret.jpg',
          name: 'secret.jpg',
          contentType: 'image/jpeg',
          size: 1,
          sha256,
        },
      },
    };
    const parsed = parseOpenRoomFile(stringifyOpenRoomFile(escaped));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContainEqual(expect.objectContaining({ path: `/resources/${resourceId}/path` }));
  });

  it('round-trips an embedded image and PDF through visual editing', () => {
    const withMedia: OpenRoomFileV1 = {
      ...file(),
      resources: {
        [resourceId]: {
          path: `resources/${resourceId}.pdf`,
          name: 'pages-40-41.pdf',
          contentType: 'application/pdf',
          size: 123,
          sha256,
        },
      },
      outline: {
        ...outline,
        steps: [
          ...outline.steps,
          {
            id: 'handout',
            kind: 'blank',
            elements: [{
              id: 'pdf-1',
              type: 'pdf',
              resourceId,
              title: 'Exercises',
              box: { x: 0, y: 0, w: 100, h: 100 },
            }],
          },
        ],
      },
    };
    const editable = editableOutlineForOpenRoomFile(withMedia);
    const step = editable.steps[2];
    expect(step?.kind === 'blank' ? step.elements?.[0] : undefined).toEqual(expect.objectContaining({
      url: `https://local.openroom.invalid/${resourceId}`,
    }));

    const updated = updateOpenRoomFileOutline(withMedia, {
      ...editable,
      meta: { ...editable.meta, title: 'Edited visually' },
    });
    const stored = updated.outline.steps[2];
    expect(stored?.kind === 'blank' ? stored.elements?.[0] : undefined).toEqual(
      expect.objectContaining({ resourceId }),
    );
    expect(updated.outline.meta.title).toBe('Edited visually');
  });

  it('hashes semantic content independently of object key order', async () => {
    const reordered = { interactions: outline.interactions, steps: outline.steps, meta: outline.meta, version: 1 } as Outline;
    expect(await outlineContentHash(reordered)).toBe(await outlineContentHash(outline));
  });
});

describe('Outline three-way merge', () => {
  it('merges independent edits by stable step id', () => {
    const local = structuredClone(outline);
    const remote = structuredClone(outline);
    (local.steps[0] as { title: string }).title = 'Salut';
    remote.interactions[0]!.prompt = 'Are you ready?';
    const merged = mergeOutlines(outline, local, remote);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect((merged.outline.steps[0] as { title: string }).title).toBe('Salut');
    expect(merged.outline.interactions[0]!.prompt).toBe('Are you ready?');
  });

  it('reports overlapping edits and competing order instead of guessing', () => {
    const local = structuredClone(outline);
    const remote = structuredClone(outline);
    (local.steps[0] as { title: string }).title = 'Salut';
    (remote.steps[0] as { title: string }).title = 'Bonsoir';
    expect(mergeOutlines(outline, local, remote)).toEqual(expect.objectContaining({ ok: false }));

    local.steps.reverse();
    remote.steps = [remote.steps[1]!, { id: 'extra', kind: 'break', title: 'Pause' }, remote.steps[0]!];
    const reordered = mergeOutlines(outline, local, remote);
    expect(reordered.ok).toBe(false);
    if (reordered.ok) return;
    expect(reordered.conflicts).toContainEqual(expect.objectContaining({ reason: 'competing-order' }));
  });
});
