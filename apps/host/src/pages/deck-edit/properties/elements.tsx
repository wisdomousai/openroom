import { stepElements, type OutlineStep } from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import { partLabel } from '../outline-edit';
import { CommitTextarea, Section } from './shared';

export function ElementSection({
  step,
  partKey,
  onPartText,
  onRemoveElement,
  onEditHtml,
  onEditMarkdown,
  onEditIframe,
  onEditPdf,
  onOpenPicture,
}: {
  step: OutlineStep;
  partKey: string;
  onPartText: (key: string, text: string) => void;
  onRemoveElement: (elementId: string) => void;
  onEditHtml: (elementId: string) => void;
  onEditMarkdown: (elementId: string) => void;
  onEditIframe: (elementId: string) => void;
  onEditPdf: (elementId: string) => void;
  onOpenPicture: (elementId: string) => void;
}) {
  const element = stepElements(step).find((item) => item.id === partKey.slice(3));
  if (element === undefined) return null;
  const box = element.box;
  return (
    <Section title={partLabel(step, partKey)} target={partKey}>
      {element.type === 'text' ? (
        <CommitTextarea
          key={partKey}
          ariaLabel="Text box"
          value={element.text}
          onCommit={(next) => onPartText(partKey, next)}
        />
      ) : null}
      {element.type === 'image' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onOpenPicture(element.id)}
        >
          Change…
        </Button>
      ) : null}
      {element.type === 'html' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            element.markdown === undefined ? onEditHtml(element.id) : onEditMarkdown(element.id)
          }
        >
          Edit…
        </Button>
      ) : null}
      {element.type === 'iframe' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onEditIframe(element.id)}>
          Edit…
        </Button>
      ) : null}
      {element.type === 'pdf' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onEditPdf(element.id)}>
          Edit…
        </Button>
      ) : null}
      <p className="text-caption text-muted-foreground tabular-nums">
        {String(box.w)}% × {String(box.h)}% at {String(box.x)}, {String(box.y)}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={() => onRemoveElement(element.id)}>
        Remove
      </Button>
    </Section>
  );
}
