import { useState } from 'react';
import { defaultDeckDesign, resolveSlideDesign, slideTheme, SLIDE_THEME_FAMILIES, DECK_ASPECT_RATIOS, type SlideBackground, type SlideMaster, type SlideFont } from '@openroom/schema';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { cn } from '../../../lib/utils';
import { Section, type PropertiesPanelProps } from './shared';
import { DesignImagePicker } from './design-image';

type ImageStorage = Pick<PropertiesPanelProps, 'spaceId' | 'onEmbeddedResource'>;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex items-center justify-between gap-2 text-sm">{label}
    <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)} className="h-8 w-12 cursor-pointer rounded border bg-transparent" />
  </label>;
}

function BackgroundFields({ background, onChange, spaceId, onEmbeddedResource }: ImageStorage & { background: SlideBackground; onChange: (value: SlideBackground) => void }) {
  return <div className="flex flex-col gap-3">
    <div className="flex gap-1" aria-label="Background type">
      <Button size="sm" variant={background.kind === 'solid' ? 'default' : 'outline'} onClick={() => onChange({ kind: 'solid', color: background.kind === 'gradient' ? background.from : background.kind === 'solid' ? background.color : background.overlay.color })}>Solid</Button>
      <Button size="sm" variant={background.kind === 'gradient' ? 'default' : 'outline'} onClick={() => onChange({ kind: 'gradient', from: background.kind === 'solid' ? background.color : '#FFFFFF', to: '#D8E6F0', angle: 135 })}>Gradient</Button>
    </div>
    {background.kind === 'solid' ? <ColorField label="Background color" value={background.color} onChange={(color) => onChange({ ...background, color })} /> : null}
    {background.kind === 'gradient' ? <>
      <ColorField label="Gradient start" value={background.from} onChange={(from) => onChange({ ...background, from })} />
      <ColorField label="Gradient end" value={background.to} onChange={(to) => onChange({ ...background, to })} />
      <label className="text-sm">Angle · {background.angle}°<input aria-label="Gradient angle" type="range" min={0} max={360} value={background.angle} onChange={(event) => onChange({ ...background, angle: Number(event.currentTarget.value) })} className="w-full" /></label>
    </> : null}
    <DesignImagePicker label="Background" value={background.kind === 'image' ? background : undefined} spaceId={spaceId} onEmbedded={onEmbeddedResource}
      onChange={(source) => onChange({ kind: 'image', ...source,
        focal: background.kind === 'image' ? background.focal : { x: 50, y: 50 },
        overlay: background.kind === 'image' ? background.overlay : { color: '#FFFFFF', opacity: 0.8 },
      })} />
    {background.kind === 'image' ? <>
      <ColorField label="Readability overlay" value={background.overlay.color} onChange={(color) => onChange({ ...background, overlay: { ...background.overlay, color } })} />
      <label className="text-sm">Overlay · {Math.round(background.overlay.opacity * 100)}%<input type="range" min={0} max={100} aria-label="Overlay opacity" value={background.overlay.opacity * 100} onChange={(event) => onChange({ ...background, overlay: { ...background.overlay, opacity: Number(event.currentTarget.value) / 100 } })} className="w-full" /></label>
      {(['x', 'y'] as const).map((axis) => <label key={axis} className="text-sm">{axis === 'x' ? 'Horizontal' : 'Vertical'} focal point<input type="range" min={0} max={100} aria-label={`${axis} focal point`} value={background.focal[axis]} onChange={(event) => onChange({ ...background, focal: { ...background.focal, [axis]: Number(event.currentTarget.value) } })} className="w-full" /></label>)}
    </> : null}
  </div>;
}

function LogoFields({ logo, onChange, spaceId, onEmbeddedResource }: ImageStorage & { logo: SlideMaster['logo']; onChange: (logo: SlideMaster['logo']) => void }) {
  const [alt, setAlt] = useState<string | null>(null);
  return <div className="grid gap-2">
    <DesignImagePicker label="Logo" value={logo} spaceId={spaceId} onEmbedded={onEmbeddedResource} onChange={(source) => onChange({ ...source, alt: alt ?? logo?.alt ?? '' })} />
    <label className="grid gap-1 text-sm">Logo description<Input value={alt ?? logo?.alt ?? ''} maxLength={200} onChange={(event) => setAlt(event.currentTarget.value)} onBlur={() => { if (logo && alt !== null) { onChange({ ...logo, alt }); setAlt(null); } }} /></label>
    {logo ? <Button size="sm" variant="subtle" onClick={() => { setAlt(null); onChange(undefined); }}>Remove logo</Button> : null}
  </div>;
}

export function DeckDesignPanel({ outline, step, onDeckDesign, onSlideDesign, spaceId, onEmbeddedResource, onPreviewMaster }: Pick<PropertiesPanelProps, 'outline' | 'step' | 'onDeckDesign' | 'onSlideDesign' | 'spaceId' | 'onEmbeddedResource'> & { onPreviewMaster?: (id: string) => void }) {
  const design = outline.design ?? defaultDeckDesign();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectMaster = (id: string) => { setSelectedId(id); onPreviewMaster?.(id); };
  const master = design.masters.find((item) => item.id === (selectedId ?? step?.design?.masterId ?? design.defaultMasterId)) ?? design.masters[0]!;
  const updateMaster = (patch: Partial<SlideMaster>) => onDeckDesign({ ...design, masters: design.masters.map((item) => item.id === master.id ? { ...item, ...patch } : item) });
  return <>
    <Section title="Deck theme">
      <div className="grid grid-cols-2 gap-2">{SLIDE_THEME_FAMILIES.map((family) => {
        const theme = slideTheme(family);
        return <button key={family} type="button" aria-pressed={design.theme.family === family} onClick={() => onDeckDesign({ ...design, theme })}
          className={cn('rounded border p-3 text-left text-sm capitalize', design.theme.family === family && 'ring-2 ring-ring')} style={{ backgroundColor: theme.colors.background, color: theme.colors.foreground }}>
          <span className="block font-semibold">{family}</span><span className="mt-2 flex gap-1" aria-hidden="true">{theme.colors.charts.slice(0, 4).map((color) => <span key={color} className="h-1.5 flex-1 rounded" style={{ background: color }} />)}</span>
        </button>;
      })}</div>
      <ColorField label="Accent color" value={design.theme.colors.accent} onChange={(accent) => onDeckDesign({ ...design, theme: { ...design.theme, colors: { ...design.theme.colors, accent } } })} />
      {(['heading', 'body'] as const).map((slot) => <label key={slot} className="grid gap-1 text-sm capitalize">{slot} font
        <Select value={design.theme.fonts[slot]} onValueChange={(font) => onDeckDesign({ ...design, theme: { ...design.theme, fonts: { ...design.theme.fonts, [slot]: font as SlideFont } } })}>
          <SelectTrigger aria-label={`${slot} font`}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="sans">Sans serif</SelectItem><SelectItem value="serif">Serif</SelectItem><SelectItem value="mono">Monospace</SelectItem>
          </SelectContent>
        </Select>
      </label>)}
      <details className="text-sm"><summary className="cursor-pointer py-1">Theme colors</summary><div className="mt-2 grid gap-3">
        {(['background', 'foreground', 'muted', 'surface', 'border'] as const).map((key) => <ColorField key={key} label={{ background: 'Background', foreground: 'Text', muted: 'Secondary text', surface: 'Cards', border: 'Lines' }[key]} value={design.theme.colors[key]} onChange={(color) => onDeckDesign({ ...design, theme: { ...design.theme, colors: { ...design.theme.colors, [key]: color } } })} />)}
        {design.theme.colors.charts.map((color, index) => <ColorField key={index} label={`Chart color ${index + 1}`} value={color} onChange={(value) => onDeckDesign({ ...design, theme: { ...design.theme, colors: { ...design.theme.colors, charts: design.theme.colors.charts.map((item, at) => at === index ? value : item) } } })} />)}
      </div></details>
    </Section>
    <Section title="Slide size"><div className="flex gap-2">{DECK_ASPECT_RATIOS.map((aspectRatio) => <Button key={aspectRatio} size="sm" variant={design.aspectRatio === aspectRatio ? 'default' : 'outline'} aria-pressed={design.aspectRatio === aspectRatio} onClick={() => onDeckDesign({ ...design, aspectRatio })}>{aspectRatio}</Button>)}</div></Section>
    <Section title="Slide masters">
      <Select value={master.id} onValueChange={selectMaster}><SelectTrigger aria-label="Slide master"><SelectValue /></SelectTrigger>
        <SelectContent>{design.masters.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={design.masters.length >= 20} onClick={() => {
          const id = `master-${crypto.randomUUID()}`;
          onDeckDesign({ ...design, masters: [...design.masters, { ...structuredClone(master), id, name: `Master ${design.masters.length + 1}` }] });
          selectMaster(id);
        }}>New master</Button>
        <Button size="sm" variant="outline" disabled={!step} onClick={() => onSlideDesign({ ...step?.design, masterId: master.id })}>Use on this slide</Button>
        <Button size="sm" variant="outline" disabled={design.defaultMasterId === master.id} onClick={() => onDeckDesign({ ...design, defaultMasterId: master.id })}>Set as default</Button>
      </div>
      <Button size="sm" variant="subtle" disabled={design.masters.length === 1} onClick={() => {
        const masters = design.masters.filter((item) => item.id !== master.id);
        const defaultMasterId = design.defaultMasterId === master.id ? masters[0]!.id : design.defaultMasterId;
        onDeckDesign({ ...design, masters, defaultMasterId }); selectMaster(defaultMasterId);
      }}>Remove master · use deck default</Button>
      <label className="grid gap-1 text-sm">Master name<Input key={master.id + master.name} defaultValue={master.name} maxLength={100} onBlur={(event) => { if (event.currentTarget.value.trim()) updateMaster({ name: event.currentTarget.value.trim() }); }} /></label>
      <label className="text-sm">Content margin · {master.safeArea}%<input type="range" min={3} max={12} aria-label="Content margin" value={master.safeArea} onChange={(event) => updateMaster({ safeArea: Number(event.currentTarget.value) })} className="w-full" /></label>
      <Select value={master.decoration} onValueChange={(decoration) => updateMaster({ decoration: decoration as SlideMaster['decoration'] })}>
        <SelectTrigger aria-label="Master decoration"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="none">No decoration</SelectItem><SelectItem value="rule">Side rule</SelectItem><SelectItem value="corner">Corner accent</SelectItem>
        </SelectContent>
      </Select>
      <label className="grid gap-1 text-sm">Footer<Input key={`${master.id}-${master.footer ?? ''}`} defaultValue={master.footer ?? ''} maxLength={120} onBlur={(event) => updateMaster({ footer: event.currentTarget.value })} /></label>
      <LogoFields key={`${master.id}-logo`} logo={master.logo} spaceId={spaceId} onEmbeddedResource={onEmbeddedResource} onChange={(logo) => updateMaster({ logo })} />
      <BackgroundFields key={master.id} background={master.background ?? { kind: 'solid', color: design.theme.colors.background }} spaceId={spaceId} onEmbeddedResource={onEmbeddedResource} onChange={(background) => updateMaster({ background })} />
      <Button size="sm" variant="subtle" onClick={() => updateMaster({ background: undefined })}>Use theme background</Button>
    </Section>
    {step ? <Section title="This slide">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={step.design?.hideMasterDecorations ?? false} onChange={(event) => onSlideDesign({ ...step.design, hideMasterDecorations: event.currentTarget.checked })} />Hide logo, footer and decoration</label>
      {step.design?.background ? <>
        <BackgroundFields key={`${step.id}-background`} background={step.design.background} spaceId={spaceId} onEmbeddedResource={onEmbeddedResource} onChange={(background) => onSlideDesign({ ...step.design, background })} />
        <Button size="sm" variant="subtle" onClick={() => { const { background: _background, ...rest } = step.design!; onSlideDesign(rest); }}>Use master background</Button>
      </> : <Button size="sm" variant="outline" onClick={() => onSlideDesign({ ...step.design, background: resolveSlideDesign(design, step.design).background })}>Customize this background</Button>}
      <Button size="sm" variant="subtle" onClick={() => onSlideDesign(step.design?.templateId ? { templateId: step.design.templateId } : {})}>Reset to deck master</Button>
    </Section> : null}
  </>;
}
