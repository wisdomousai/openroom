import {
  MEDIA_PLACES,
  MEDIA_SIZE_DEFAULT,
  MEDIA_SIZE_MIN,
  LAYOUTS_FOR_KIND,
  mediaSizeMax,
  resolvedStepLayout,
  resolveMediaPlace,
  resolveMediaSize,
  type OutlineMediaFocal,
  type OutlineMediaPlace,
  type OutlineStep,
  type OutlineMedia,
} from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import { Slider } from '@openroom/ui/components/slider';
import { cn } from '@openroom/ui/utils';
import { stepMedia } from '../outline-edit';
import { CommitTextarea, Section } from './shared';

const PLACE_WORDS: Record<OutlineMediaPlace, string> = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  fill: 'Fill',
};

const SIZE_CHIPS = [25, 33, 50, 67] as const;

const FOCAL_POINTS: OutlineMediaFocal[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export function PictureSection({
  step,
  media,
  onOpenPicture,
  onRemovePicture,
  onMediaFocal,
  onMediaPlace,
  onMediaSize,
  onPartText,
  onMediaChange,
}: {
  step: OutlineStep;
  media: NonNullable<ReturnType<typeof stepMedia>>;
  onOpenPicture: () => void;
  onRemovePicture: () => void;
  onMediaFocal: (focal: OutlineMediaFocal | undefined) => void;
  onMediaPlace: (place: OutlineMediaPlace) => void;
  onMediaSize: (size: number) => void;
  onPartText: (key: string, text: string) => void;
  onMediaChange?: (media: OutlineMedia) => void;
}) {
  const canRemove = step.kind !== 'media';
  const layout = resolvedStepLayout(step);
  const place = resolveMediaPlace(media, layout);
  const size = resolveMediaSize(media, place);
  // On split the picture is a column beside the words, so it is narrower.
  const sizeMax = mediaSizeMax(layout);
  // Fill is the media layout; a kind without one has nothing to fill.
  const places = MEDIA_PLACES.filter((slot) => slot !== 'fill' || LAYOUTS_FOR_KIND[step.kind].includes('media'));
  return (
    <Section title="Picture" target="image">
      <div className="flex items-center gap-2.5">
        {media.url ? (
          <button
            type="button"
            onClick={onOpenPicture}
            className="h-[52px] w-[84px] shrink-0 overflow-hidden rounded-md border border-border bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title="Change picture"
          >
            <img src={media.url} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <span className="grid h-[52px] w-[84px] shrink-0 place-items-center rounded-md border border-dashed border-input bg-background text-caption text-muted-foreground">
            none
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={onOpenPicture}>
            Change…
          </Button>
          {canRemove ? (
            <Button type="button" size="sm" variant="subtle" onClick={onRemovePicture}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-caption text-muted-foreground">Place</p>
        <div className="flex flex-wrap gap-1.5">
          {places.map((slot) => {
            const active = slot === place;
            return (
              <button
                key={slot}
                type="button"
                aria-pressed={active}
                onClick={() => onMediaPlace(slot)}
                className={cn(
                  'inline-flex h-7 items-center rounded-full px-2.5 text-secondary',
                  active
                    ? 'bg-accent font-semibold text-accent-foreground'
                    : 'border border-input hover:bg-chrome',
                )}
              >
                {PLACE_WORDS[slot]}
              </button>
            );
          })}
        </div>
      </div>
      {place === 'fill' ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption text-muted-foreground">
            Size <span className="tabular-nums">{size === MEDIA_SIZE_DEFAULT ? '' : `${String(size)}%`}</span>
          </p>
          <Slider
            min={MEDIA_SIZE_MIN}
            max={sizeMax}
            value={[size]}
            aria-label="Picture size"
            onValueChange={([next]) => {
              if (next !== undefined) onMediaSize(next);
            }}
            className="w-full"
          />
          <div className="flex flex-wrap gap-1.5">
            {SIZE_CHIPS.filter((chip) => chip <= sizeMax).map((chip) => (
              <button
                key={chip}
                type="button"
                aria-pressed={size === chip}
                onClick={() => onMediaSize(chip)}
                className={cn(
                  'inline-flex h-7 items-center rounded-full px-2.5 text-secondary tabular-nums',
                  size === chip
                    ? 'bg-accent font-semibold text-accent-foreground'
                    : 'border border-input hover:bg-chrome',
                )}
              >
                {chip}%
              </button>
            ))}
          </div>
        </div>
      )}
      <PictureDetails
        detailsKey={step.id}
        alt={media.alt}
        onAlt={(next) => onPartText('image', next)}
        focal={media.focal}
        onFocal={onMediaFocal}
        caption={onMediaChange ? (media.caption ?? '') : undefined}
        onCaption={onMediaChange ? (caption) => onMediaChange({ ...media, caption: caption || undefined }) : undefined}
      />
    </Section>
  );
}

/**
 * Crop focus, alt text and caption of one picture. Shared by the wired
 * Picture section and a picture object on a freeform slide, so both offer the
 * same labelled fields. Caption is shown only where the slide draws one.
 */
export function PictureDetails({
  detailsKey,
  alt,
  onAlt,
  focal,
  onFocal,
  caption,
  onCaption,
}: {
  /** Resets the drafts when the picture changes. */
  detailsKey: string;
  alt: string;
  onAlt: (alt: string) => void;
  focal: OutlineMediaFocal | undefined;
  onFocal: (focal: OutlineMediaFocal | undefined) => void;
  caption?: string;
  onCaption?: (caption: string) => void;
}) {
  const current = focal ?? 'center';
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="text-caption text-muted-foreground">Crop</p>
        <div
          className="grid w-[72px] grid-cols-3 gap-0.5 rounded-md border border-border p-0.5"
          role="group"
          aria-label="Crop focus"
        >
          {FOCAL_POINTS.map((point) => {
            const active = point === current;
            return (
              <button
                key={point}
                type="button"
                title={point.replace('-', ' ')}
                aria-label={point.replace('-', ' ')}
                aria-pressed={active}
                onClick={() => onFocal(point === 'center' ? undefined : point)}
                className={cn(
                  'size-5 rounded-[3px]',
                  active ? 'bg-primary' : 'bg-chrome hover:bg-input',
                )}
              />
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5" data-picture-alt>
        <p className="text-caption text-muted-foreground">Alt text</p>
        <CommitTextarea
          key={`${detailsKey}-alt`}
          ariaLabel="Alt text"
          value={alt}
          onCommit={onAlt}
        />
        <p className="text-caption text-muted-foreground">
          Say what the picture shows, for students who use a screen reader.
        </p>
      </div>
      {onCaption === undefined ? null : (
        <div className="flex flex-col gap-1.5" data-editor-target="caption">
          <p className="text-caption text-muted-foreground">Caption</p>
          <CommitTextarea
            key={`${detailsKey}-caption`}
            ariaLabel="Caption"
            value={caption ?? ''}
            onCommit={onCaption}
          />
        </div>
      )}
    </>
  );
}
