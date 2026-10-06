import { resolveSlideDesign, type DeckDesign } from '@openroom/schema';
import { StepLayout } from '@openroom/slides';

export function BrandKitPreview({ design, name, masterId }: { design: DeckDesign; name: string; masterId?: string }) {
  return <div className="overflow-hidden rounded-lg border border-border shadow-sm" style={{ aspectRatio: design.aspectRatio.replace(':', '/') }} aria-label={`${name || 'Brand kit'} slide preview`}>
    <StepLayout fit design={resolveSlideDesign(design, { masterId })} step={{ id: 'brand-preview', kind: 'statement', title: name || 'A shared direction', body: 'Clear ideas. Thoughtful discussion. A practical next step.' }} />
  </div>;
}
