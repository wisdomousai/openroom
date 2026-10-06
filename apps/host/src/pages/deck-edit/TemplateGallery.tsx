import { useState } from 'react';
import { SLIDE_TEMPLATES, WORKSHOP_SEQUENCES, type Outline, type SlideTemplateCategory } from '@openroom/schema';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody } from '../../components/ui/dialog';
import { SlideThumbnail } from './SlideThumbnail';

export function TemplateGallery({ open, onOpenChange, outline, onPick, onWorkshop, onBlank }: {
  open: boolean; onOpenChange: (open: boolean) => void; outline: Outline;
  onPick: (templateId: string) => void; onWorkshop: (sequenceId: string) => void; onBlank: () => void;
}) {
  const [category, setCategory] = useState<SlideTemplateCategory | 'All' | 'Workshops'>('All');
  const [query, setQuery] = useState('');
  const templates = SLIDE_TEMPLATES.filter((item) => (category === 'All' || item.category === category) &&
    `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const workshops = category === 'Workshops' ? WORKSHOP_SEQUENCES.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[min(70rem,calc(100vw-2rem))] overflow-hidden">
      <DialogHeader><DialogTitle>Choose a slide</DialogTitle><DialogDescription>Use your deck’s theme. Every word and question stays editable.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        {(['All', 'Essentials', 'Language', 'Questions', 'Group work', 'Workshops'] as const).map((value) => <Button key={value} size="sm" variant={value === category ? 'default' : 'outline'} aria-pressed={value === category} onClick={() => setCategory(value)}>{value}</Button>)}
        <Input className="ml-auto w-48" aria-label="Find a slide template" placeholder="Find a template" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <Button size="sm" variant="subtle" onClick={onBlank}>Blank slide</Button>
      </div>
      <DialogBody className="grid auto-rows-max grid-cols-2 content-start gap-4 p-1 lg:grid-cols-3">
        {templates.map((template) => {
          const preview: Outline = { ...outline, steps: [template.step], interactions: template.interaction ? [template.interaction] : [] };
          return <button key={template.id} type="button" className="flex h-max flex-col overflow-hidden rounded-lg border border-border text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`Insert ${template.name}`} onClick={() => onPick(template.id)}>
            <span className="block w-full shrink-0 border-b border-border" style={{ aspectRatio: outline.design?.aspectRatio.replace(':', '/') ?? '16 / 9' }}><SlideThumbnail outline={preview} step={template.step} /></span>
            <span className="grid shrink-0 gap-1 p-3"><span className="font-semibold">{template.name}</span><span className="text-sm text-muted-foreground">{template.description}</span></span>
          </button>;
        })}
        {workshops.map((workshop) => {
          const preview = { ...outline, steps: workshop.steps, interactions: workshop.interactions };
          return <button key={workshop.id} type="button" className="flex h-max flex-col overflow-hidden rounded-lg border border-border text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`Insert ${workshop.name} workshop`} onClick={() => onWorkshop(workshop.id)}>
            <span className="block w-full shrink-0 border-b border-border" style={{ aspectRatio: outline.design?.aspectRatio.replace(':', '/') ?? '16 / 9' }}><SlideThumbnail outline={preview} step={workshop.steps[0]!} /></span>
            <span className="grid gap-1 p-3"><span className="font-semibold">{workshop.name}</span><span className="text-sm text-muted-foreground">{workshop.description}</span>
              <span className="mt-1 text-xs text-muted-foreground">{workshop.steps.length} slides · about {workshop.minutes} minutes · facilitator notes</span></span>
          </button>;
        })}
        {templates.length === 0 && workshops.length === 0 ? <p className="col-span-full py-8 text-center text-muted-foreground">No templates match that search.</p> : null}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
