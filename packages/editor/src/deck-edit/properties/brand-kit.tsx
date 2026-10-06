import { useState } from 'react';
import type { DeckDesign } from '@openroom/schema';
import type { EditorSlots } from '../../services';
import { Button } from '@openroom/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@openroom/ui/components/select';
import { Section } from './shared';

export function BrandKitPicker({ brandKits, spaceId, onApply }: {
  brandKits: NonNullable<EditorSlots['brandKits']>;
  spaceId: string;
  onApply: (design: DeckDesign) => void;
}) {
  const [chosen, setChosen] = useState('');
  const query = brandKits.useBrandKits(spaceId);
  const kit = query.data?.brandKits.find((item) => item.id === chosen);
  return <Section title="Brand kit">
    {query.error ? <p role="alert" className="text-sm text-destructive">Brand kits could not be loaded.</p> : query.data?.brandKits.length ? <>
      <Select value={chosen} onValueChange={setChosen}><SelectTrigger aria-label="Choose brand kit"><SelectValue placeholder="Choose a kit" /></SelectTrigger><SelectContent>{query.data.brandKits.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
      {kit ? <div className="flex gap-1" aria-label="Brand colors">{kit.design.theme.colors.charts.map((color, index) => <span key={index} className="h-5 flex-1 rounded-sm" style={{ backgroundColor: color }} />)}</div> : null}
      <Button variant="outline" disabled={!kit} onClick={() => { if (kit) onApply(kit.design); }}>Apply to all slides</Button>
      <p className="text-xs text-muted-foreground">Copies colors, fonts and masters into this deck and resets slide backgrounds to the kit. Content and layouts stay in place.</p>
    </> : <p className="text-sm text-muted-foreground">{query.isPending ? 'Loading brand kits…' : 'Create reusable designs in this space’s settings.'}</p>}
    <Button asChild size="sm" variant="ghost"><a href={brandKits.manageUrl(spaceId)} target="_blank" rel="noreferrer">Manage brand kits</a></Button>
  </Section>;
}
