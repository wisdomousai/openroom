import { resolveSlideDesign, type DeckDesign } from '@openroom/schema';
import { StepLayout } from '@openroom/slides';

export function BrandKitPreview({ design, name, masterId }: { design: DeckDesign; name: string; masterId?: string }) {
  return <div className="overflow-hidden rounded-lg border border-border" style={{ aspectRatio: design.aspectRatio.replace(':', '/') }} aria-label={`${name || 'Brand kit'} slide preview`}>
    <StepLayout fit design={resolveSlideDesign(design, { masterId })} step={{ id: 'brand-preview', kind: 'statement', title: name || 'Slide title', body: 'Body text' }} />
  </div>;
}
