import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brandPaletteIssues, defaultDeckDesign, type BrandKit, type DeckDesign } from '@openroom/schema';
import { getSpaceTree } from '../api';
import { getBrandKit, listBrandKits, restoreBrandKit, saveBrandKit, trashBrandKit } from '../api/brand-kits';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import { BrandKitPreview } from '../components/BrandKitPreview';
import { to } from '../destinations';
import { DeckDesignPanel } from './deck-edit/properties/deck-design';
import { LoadState, PageHeading, messageOf } from './tutor/shared';

export function BrandKitsPage({ spaceId, trashed = false }: { spaceId: string; trashed?: boolean }) {
  const query = useQuery({ queryKey: ['brand-kits', spaceId, trashed], queryFn: () => listBrandKits(spaceId, trashed) });
  if (!query.data) return <LoadState error={query.error ? messageOf(query.error, 'Could not load brand kits') : null} />;
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <PageHeading title={trashed ? 'Brand kit trash' : 'Brand kits'} description="Shared logos, colors, typography and slide masters for this space." action={<div className="flex gap-2">
      <Button asChild variant="outline"><Link {...to.spaceEdit(spaceId)}>Space settings</Link></Button>
      <Button asChild variant="outline"><Link {...to.brandKits(spaceId, !trashed)}>{trashed ? 'Brand kits' : 'Trash'}</Link></Button>
      {!trashed && query.data.canEdit && query.data.brandingEnabled ? <Button asChild><Link {...to.brandKitNew(spaceId)}>New brand kit</Link></Button> : null}
    </div>} />
    {!query.data.brandingEnabled ? <p className="text-sm text-muted-foreground">The space owner’s branding plan enables creating and editing shared kits. Designs already applied to decks remain in those files.</p> : null}
    {query.data.brandKits.length ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{query.data.brandKits.map((kit) => <Link key={kit.id} {...to.brandKit(spaceId, kit.id)} className="group grid gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
      <BrandKitPreview design={kit.design} name={kit.name} />
      <div className="px-1 pb-1"><h2 className="font-semibold">{kit.name}</h2><p className="text-sm text-muted-foreground">{kit.design.masters.length} {kit.design.masters.length === 1 ? 'master' : 'masters'} · {kit.design.aspectRatio}</p></div>
    </Link>)}</div> : <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">{trashed ? 'No brand kits in trash.' : 'Create a kit once, then apply it from the deck editor’s Theme tab.'}</p>}
  </div>;
}

export function BrandKitPage({ spaceId, kitId, editing = false }: { spaceId: string; kitId?: string; editing?: boolean }) {
  const kit = useQuery({ queryKey: ['brand-kit', kitId], queryFn: () => getBrandKit(kitId!), enabled: !!kitId });
  const permissions = useQuery({ queryKey: ['brand-kits', spaceId, false], queryFn: () => listBrandKits(spaceId), enabled: !kitId });
  const space = useQuery({ queryKey: ['spaces', spaceId, 'tree', 'all'], queryFn: () => getSpaceTree(spaceId) });
  const data = kitId ? kit.data : permissions.data;
  if (!data || !space.data) return <LoadState error={kit.error || permissions.error || space.error ? messageOf(kit.error ?? permissions.error ?? space.error, 'Could not open brand kit') : null} />;
  if (!kitId && (!data.canEdit || !data.brandingEnabled)) return <LoadState error="Creating brand kits requires editor access and the space owner’s branding plan." />;
  if (kit.data && kit.data.brandKit.spaceId !== spaceId) return <LoadState error="This kit belongs to another space." />;
  return <BrandKitEditor key={`${kitId ?? 'new'}-${kit.data?.brandKit.revision ?? 0}-${editing}`} spaceId={spaceId} spaceName={space.data.space.name} kit={kit.data?.brandKit}
    editing={editing && data.canEdit && data.brandingEnabled && !kit.data?.brandKit.trashed} canManage={data.canEdit} canEdit={data.canEdit && data.brandingEnabled} />;
}

function BrandKitEditor({ spaceId, spaceName, kit, editing, canManage, canEdit }: { spaceId: string; spaceName: string; kit?: BrandKit; editing: boolean; canManage: boolean; canEdit: boolean }) {
  const navigate = useNavigate(), cache = useQueryClient();
  const [name, setName] = useState(kit?.name ?? '');
  const [design, setDesign] = useState<DeckDesign>(() => structuredClone(kit?.design ?? defaultDeckDesign('business')));
  const [previewMaster, setPreviewMaster] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const issues = brandPaletteIssues(design.theme.colors);
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ['brand-kits'] }), cache.invalidateQueries({ queryKey: ['brand-kit'] })]);
  const save = async () => {
    setBusy(true); setError(null);
    try { const saved = await saveBrandKit(spaceId, { name, design }, kit); await refresh(); await navigate(to.brandKit(spaceId, saved.brandKit.id)); }
    catch (cause) { setError(messageOf(cause, 'Could not save brand kit')); }
    finally { setBusy(false); }
  };
  const changeTrash = async () => {
    if (!kit) return; setBusy(true); setError(null);
    try { await (kit.trashed ? restoreBrandKit(kit.id) : trashBrandKit(kit.id)); await refresh(); await navigate(to.brandKits(spaceId, !kit.trashed)); }
    catch (cause) { setError(messageOf(cause, 'Could not update brand kit')); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto grid w-full max-w-6xl gap-6">
    <PageHeading title={editing ? kit ? 'Edit brand kit' : 'New brand kit' : name || 'Brand kit'} description={`Saving in: ${spaceName}`} action={<div className="flex gap-2">
      <Button asChild variant="outline"><Link {...to.brandKits(spaceId, kit?.trashed)}>{editing ? 'Cancel' : 'Brand kits'}</Link></Button>
      {editing ? <Button disabled={busy || !name.trim() || issues.length > 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save brand kit'}</Button> : kit && canEdit && !kit.trashed ? <Button asChild><Link {...to.brandKitEdit(spaceId, kit.id)}>Edit brand kit</Link></Button> : null}
    </div>} />
    {error ? <p role="alert" className="text-sm text-destructive">{error === 'brand-kit-conflict' ? 'Another person changed this kit. Copy your edits before reloading.' : error}</p> : null}
    <div className={editing ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid gap-6'}>
      <div className="grid gap-5 lg:sticky lg:top-6">
        {editing ? <label className="grid gap-2 font-medium">Kit name<Input value={name} maxLength={120} onChange={(event) => setName(event.currentTarget.value)} /></label> : null}
        <BrandKitPreview design={design} name={name} masterId={previewMaster} />
        <div aria-label="Chart palette preview" className="grid grid-cols-3 gap-3 rounded-lg p-4 sm:grid-cols-6" style={{ backgroundColor: design.theme.colors.surface, color: design.theme.colors.foreground }}>{design.theme.colors.charts.map((color, index) => <div key={index} className="grid gap-2 text-center text-xs"><span className="h-12 rounded" style={{ backgroundColor: color }} /><span>Series {index + 1}</span></div>)}</div>
        <p className="text-sm text-muted-foreground">Applying this kit copies its design into the deck. Changes to the kit never change existing decks.</p>
        {issues.length ? <div role="status" className="rounded-lg border border-destructive/40 p-4 text-sm"><p className="font-semibold">Improve contrast before saving</p><ul className="mt-2 list-inside list-disc">{issues.map((issue) => <li key={issue.label}>{issue.label}: {(Math.floor(issue.ratio * 100) / 100).toFixed(2)}:1 · needs {issue.minimum}:1</li>)}</ul></div> : <p className="text-sm text-muted-foreground">Text and chart colors meet the palette contrast checks. Check readability separately on photographic and custom master backgrounds.</p>}
        {!editing && kit && canManage ? <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void changeTrash()}>{kit.trashed ? 'Restore brand kit' : 'Move to trash'}</Button> : null}
      </div>
      {editing ? <fieldset disabled={busy} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"><DeckDesignPanel
        outline={{ version: 1, meta: { title: name || 'Brand kit' }, steps: [], interactions: [], design }} step={null}
        spaceId={spaceId} onDeckDesign={setDesign} onSlideDesign={() => {}} onPreviewMaster={setPreviewMaster} />
      </fieldset> : <div className="flex flex-wrap gap-2">{design.masters.map((master) => <Button key={master.id} variant="outline" aria-pressed={(previewMaster ?? design.defaultMasterId) === master.id} onClick={() => setPreviewMaster(master.id)}>{master.name}</Button>)}</div>}
    </div>
  </div>;
}
