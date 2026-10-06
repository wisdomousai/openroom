import { memo } from 'react';
import { resolveSlideDesign, type Outline, type OutlineStep } from '@openroom/schema';
import { StepLayout, type SlideStep } from '@openroom/slides';
import { optionsFor, promptFor, promptFontFor, promptSpansFor } from './outline-edit';

/** A static rendering of the file. Embedded players never run in the rail. */
export const SlideThumbnail = memo(function SlideThumbnail({ outline, step }: { outline: Outline; step: OutlineStep }) {
  const preview = { ...step };
  if ('media' in preview && preview.media && preview.media.type !== 'image') {
    const { url: _url, assetId: _asset, resourceId: _resource, ...media } = preview.media;
    preview.media = media;
  }
  if ('elements' in preview && preview.elements) {
    preview.elements = preview.elements.filter((element) => element.type === 'text' || element.type === 'image');
  }
  const interaction = step.kind === 'interaction' ? outline.interactions.find((item) => item.id === step.interactionId) : undefined;
  return <div aria-hidden="true" inert className="pointer-events-none h-full w-full overflow-hidden">
    <StepLayout fit design={resolveSlideDesign(outline.design, step.design)} step={preview as SlideStep}
      gaps={interaction?.type === 'fill-the-gaps' ? interaction.gaps : undefined}
      renderInteraction options={optionsFor(outline, step)} prompt={promptFor(outline, step)}
      promptFont={promptFontFor(outline, step)} promptSpans={promptSpansFor(outline, step)} />
  </div>;
});
