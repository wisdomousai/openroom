import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StepLayout, effectiveLayout, wordAt, type SlideStep } from '@openroom/slides';
import {
  partValue,
  resolveSlideDesign,
  deckAspectRatio,
  fillTheGapsBankWords,
  resolveMediaPlace,
  resolveMediaSize,
  stepElements,
  stepPicture,
  type FillTheGapsInteraction,
  type Outline,
  type OutlineElementBox,
  type OutlineStep,
  type SpanFontFamily,
  type TextElementAlignment,
} from '@openroom/schema';

import {
  ContextMenu,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { Button } from '../../components/ui/button';
import { SlideOverflowNotice } from './SlideOverflowNotice';
import { useSlideOverflow, type SlideOverflowIssue } from './slide-overflow';
import { BlockedEmbedNotices } from './BlockedEmbedNotice';
import { FormatToolbar } from './FormatToolbar';
import { togglePatch, toolbarState, type StyledTarget, type ToggleKey } from './format-toolbar-state';
import { partSelection, restoreSelectionIn } from './selection-offsets';
import type { SpanFormat } from './spans';
import { ObjectFrame } from './ObjectFrame';
import { PictureFrame } from './PictureFrame';
import { BlockInsertMenu } from './ThumbnailRail';
import {
  canAddListItem,
  canRemoveListItem,
  materialIndex,
  optionsFor,
  partLabel,
  partFont,
  partFontOnly,
  partSpanCapable,
  partSpans,
  partText,
  promptFontFor,
  promptFor,
  promptSpansFor,
  stepTitle,
  type InsertKind,
  type InsertOptions,
  type PictureTarget,
} from './outline-edit';
import './slide-canvas.css';

/**
 * The slide as the audience will see it, at desk size.
 *
 * The rendering is `@openroom/slides` — the same skeleton `apps/stage` draws on
 * the projector — inside the authored aspect ratio. There is exactly one slide
 * renderer in the product; this file is a frame and a set of authoring
 * affordances around it, not a second reading of what a step looks like.
 *
 * Editing is in place: a text part takes a caret and commits on blur or Enter.
 * Nothing above re-renders while the caret is in a part, which is why the
 * outline parse can stay synchronous — a deferred re-parse mid-keystroke is
 * what makes a caret jump.
 */

/**
 * Parts whose element is a single span of authored text a caret can own.
 *
 * `image` is a picture: it is selected here and edited in the properties panel,
 * where a picture has real controls. `materials` is a list, so the caret goes
 * on each *line* instead — `material-N`, which is an edit target inside the
 * part rather than a part of its own (see `@openroom/slides`). Everything else
 * with a value of its own is editable where it sits, which is the promise the
 * footer makes.
 */
function editablePart(step: OutlineStep, key: string, outline: Outline): boolean {
  if (materialIndex(key) !== null) return step.kind === 'activity';
  if (key === 'materials' || key === 'image') return false;
  if (key.startsWith('el-')) {
    return stepElements(step).find((item) => item.id === key.slice(3))?.type === 'text';
  }
  return partValue(step, key, outline.interactions) !== undefined;
}

/**
 * Cmd/Ctrl shortcuts that toggle a span format. Always swallowed, selection or
 * not: letting the browser handle Cmd+B injects a `<b>` into the part, and the
 * next blur would commit that markup as text.
 */
const SHORTCUT_FORMATS: Record<string, ToggleKey | undefined> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
};

/** Visible words of a part, minus reveal badges / remove chrome. */
function visiblePartText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const decoration of copy.querySelectorAll('[data-slide-decoration]')) {
    decoration.remove();
  }
  return (copy.textContent ?? '').replace(/\u00a0/g, ' ').trim();
}

/**
 * The word under a screen point, or null when the point is not on one.
 *
 * Resolved from the caret rather than from a span, because the deck editor
 * deliberately does **not** turn on `tokens` in `SlideCanvas`: inside a
 * `contentEditable` part the browser splits and reparents React-owned token
 * spans on every keystroke, React reconciles against a DOM it no longer owns,
 * and `partText()` starts committing mangled text.
 *
 * The word boundaries come from `@openroom/slides`, so the deck editor's
 * hit-test and the projector's numbering are one rule and cannot drift.
 */
function wordUnderPoint(x: number, y: number): string | null {
  interface CaretDoc {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  }
  const doc = document as Document & CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y) ?? null;
  if (position !== null) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    // Safari has only the older spelling.
    const range = doc.caretRangeFromPoint?.(x, y) ?? null;
    if (range === null) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (node === null || node.nodeType !== Node.TEXT_NODE) return null;
  const element = node.parentElement;
  if (element === null || element.closest('[data-part]') === null) return null;
  if (element.closest('[data-slide-decoration]') !== null) return null;
  return wordAt(node.textContent ?? '', offset);
}

export function SlideCanvas({
  outline,
  step,
  groups,
  playIndex,
  partKey,
  onSelectPart,
  onPartText,
  onSelectStep,
  onInsert,
  onDuplicate,
  onDelete,
  canDelete,
  onAddOption,
  onRemoveOption,
  onPictureSize,
  onRemovePicture,
  onElementBox,
  onPartStyle,
  onPartFont,
  onElementAlign,
  onPartClearFormat,
  onRemoveElement,
  onEditImage,
  placing = null,
  onPlaceAt,
  onCancelPlace,
  onLookUpWord,
  deckId,
  onOverflowChange,
  onReviewOverflow,
}: {
  onOverflowChange: (stepId: string, issues: SlideOverflowIssue[]) => void;
  onReviewOverflow: () => void;
  outline: Outline;
  step: OutlineStep;
  /** Scope for the embed probe. Absent on a local file, which simply skips it. */
  deckId?: string | null;
  /**
   * Look a word up in the properties panel. A read: it writes nothing to the
   * outline, which is what keeps `outline-edit.ts` and `outline-fuzz.ts` out of
   * this. The moment someone adds "insert this meaning as a slide note", it
   * must go through `outline-edit.ts` and be classified in `outline-fuzz.ts`.
   */
  onLookUpWord?: (word: string) => void;
  /** Resolved reveal groups for `step`, in play order. */
  groups: string[][];
  /** How many groups have been played; null means the whole block shows. */
  playIndex: number | null;
  partKey: string | null;
  onSelectPart: (key: string | null) => void;
  onPartText: (key: string, text: string) => void;
  /** Used by the breakout banner to go back to the block this one hangs off. */
  onSelectStep: (stepId: string) => void;
  onInsert: (kind: InsertKind, options?: InsertOptions) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
  /**
   * Grow the question's option list. `afterIndex` inserts after that answer;
   * omit it to append. `commitText` writes the current answer first so Enter
   * does not drop what was still in the caret.
   */
  onAddOption?: (afterIndex?: number, commitText?: string) => void;
  onRemoveOption?: (index: number) => void;
  onPictureSize?: (size: number) => void;
  onRemovePicture?: () => void;
  onElementBox?: (elementId: string, box: OutlineElementBox) => void;
  /**
   * Style `[start, end)` of a part — a freeform text element or a fixed slot.
   * `text` is what the part holds right now: the caller commits it and applies
   * the patch in one write, so a gesture is one undo entry and the spans can
   * never style stale characters.
   */
  onPartStyle?: (
    partKey: string,
    start: number,
    end: number,
    patch: Partial<SpanFormat>,
    text: string,
  ) => void;
  /**
   * Set a font-only part's family — the whole part, not a range. Only a
   * fill-the-gaps prompt is shaped this way; `default` clears back to the theme.
   */
  onPartFont?: (partKey: string, family: SpanFontFamily) => void;
  /** Freeform text elements only — a fixed slot's alignment is the skin's. */
  onElementAlign?: (elementId: string, align: TextElementAlignment) => void;
  onPartClearFormat?: (partKey: string, start: number, end: number, text: string) => void;
  onRemoveElement?: (elementId: string) => void;
  /**
   * Double-click on a picture opens the picture dialog for that exact target:
   * the slide's wired picture, or the freeform picture object that was hit.
   */
  onEditImage?: (target: PictureTarget) => void;
  /** Non-null while the author is pointing where an insert should land. */
  placing?: 'text' | null;
  /** The author clicked the slide at this percent point while placing. */
  onPlaceAt?: (point: { x: number; y: number }) => void;
  onCancelPlace?: () => void;
}) {
  const playing = playIndex !== null;
  const shown = playIndex ?? groups.length;

  const hiddenParts = useMemo(
    () => new Set(groups.slice(shown).flat()),
    [groups, shown],
  );
  const groupOf = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const key of group) map.set(key, index + 1);
    });
    return map;
  }, [groups]);

  // A group number on every part is noise when there is only one group, and a
  // distraction while playing — the footer says where you are instead.
  const showBadges = groups.length > 1 && !playing;

  const parent =
    step.breakoutOf === undefined
      ? null
      : (outline.steps.find((item) => item.id === step.breakoutOf?.stepId) ?? null);
  const optionCount = optionsFor(outline, step).length;
  const editingOptions = !playing && optionCount > 0 && onAddOption !== undefined;
  const canAdd = editingOptions && canAddListItem(outline, step, 'option');
  const canRemove = editingOptions && canRemoveListItem(outline, step, 'option');
  const fillTheGapsIx =
    step.kind === 'interaction'
      ? outline.interactions.find(
          (item): item is FillTheGapsInteraction =>
            item.id === step.interactionId && item.type === 'fill-the-gaps',
        )
      : undefined;

  // The browser owns the editable DOM until blur. Recreate it on a committed
  // content change: reconciling React's old text nodes after the browser has
  // removed them (for example Select all → Delete) can throw removeChild.
  // Selection and overflow updates leave this key alone, so typing keeps its caret.
  const contentKey = useMemo(() => JSON.stringify([
    step,
    step.kind === 'interaction' ? outline.interactions.find((item) => item.id === step.interactionId) : null,
  ]), [step, outline.interactions]);

  const frameRef = useRef<HTMLDivElement>(null);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const overflowIssues = useSlideOverflow(frameEl, step, outline);
  useEffect(() => { onOverflowChange(step.id, overflowIssues); }, [onOverflowChange, step.id, overflowIssues]);
  const [partEl, setPartEl] = useState<HTMLElement | null>(null);
  const pendingFocus = useRef<string | null>(null);
  /** Selection to put back after a style write re-renders the part. */
  const pendingSelection = useRef<{ partKey: string; start: number; end: number } | null>(null);
  /** The word the last right-click landed on, if it landed on one. */
  const [lookUpHit, setLookUpHit] = useState<string | null>(null);
  const media = stepPicture(step);
  const picturePlace = media === undefined ? null : resolveMediaPlace(media, effectiveLayout(step));
  const pictureSize = media === undefined || picturePlace === null ? null : resolveMediaSize(media, picturePlace);

  useLayoutEffect(() => {
    setFrameEl(frameRef.current);
  }, [step.id, partKey]);

  const selectedElement =
    partKey !== null && partKey.startsWith('el-')
      ? stepElements(step).find((item) => item.id === partKey.slice(3))
      : undefined;

  // The part element the formatting bar reads its selection from. Re-resolved
  // on every step write, because a style write replaces the node.
  useLayoutEffect(() => {
    if (
      frameEl === null ||
      partKey === null ||
      !(partSpanCapable(outline, step, partKey) || partFontOnly(outline, step, partKey))
    ) {
      setPartEl(null);
      return;
    }
    const el = frameEl.querySelector(`[data-part="${CSS.escape(partKey)}"]`);
    setPartEl(el instanceof HTMLElement ? el : null);
  }, [frameEl, outline, partKey, step]);

  // A style write goes out as source, comes back as a fresh parse, and React
  // rebuilds the part's spans — so the caret and the selection have to be put
  // back by hand. Same shape as `pendingFocus` above, one range wider.
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    if (pending === null) return;
    pendingSelection.current = null;
    const el = document.querySelector(
      `.slide-canvas__frame [data-part="${CSS.escape(pending.partKey)}"]`,
    );
    if (!(el instanceof HTMLElement) || !el.isContentEditable) return;
    el.focus();
    restoreSelectionIn(el, pending.start, pending.end);
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
      if (selectedElement !== undefined && onRemoveElement !== undefined) {
        event.preventDefault();
        onRemoveElement(selectedElement.id);
        return;
      }
      if (partKey === 'image' && onRemovePicture !== undefined && step.kind !== 'media') {
        event.preventDefault();
        onRemovePicture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRemoveElement, onRemovePicture, partKey, selectedElement, step.kind]);
  useEffect(() => {
    if (placing === null || onCancelPlace === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelPlace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, onCancelPlace]);

  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null || key !== partKey) return;
    pendingFocus.current = null;
    const el = document.querySelector(`.slide-canvas__frame [data-part="${CSS.escape(key)}"]`);
    if (!(el instanceof HTMLElement) || !el.isContentEditable) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [partKey, optionCount]);

  const addOption = (afterIndex?: number, commitText?: string) => {
    if (!canAdd || onAddOption === undefined) return;
    const nextIndex = afterIndex === undefined ? optionCount : afterIndex + 1;
    pendingFocus.current = `option-${String(nextIndex)}`;
    onAddOption(afterIndex, commitText);
  };

  const removeOption = (index: number) => {
    if (!canRemove || onRemoveOption === undefined) return;
    const nextIndex = Math.max(0, Math.min(index, optionCount - 2));
    pendingFocus.current = `option-${String(nextIndex)}`;
    onRemoveOption(index);
  };

  const textElement = selectedElement?.type === 'text' ? selectedElement : null;

  /**
   * The styled thing under the caret: a freeform text element, or a fixed slot
   * of a wired kind. A slot passes `align: null`, which is what keeps the align
   * group off a heading whose alignment the skin owns.
   */
  const styled: StyledTarget | null =
    textElement !== null
      ? textElement
      : partKey !== null && partSpanCapable(outline, step, partKey)
        ? {
            text: partText(outline, step, partKey),
            spans: partSpans(outline, step, partKey),
            align: null,
          }
        : null;

  /**
   * The whole-part font target: a fill-the-gaps prompt, whose `{{id}}`
   * placeholders leave no range to style. It needs no selection, so the bar
   * mounts on the part being selected.
   */
  const fontOnly =
    partKey !== null && onPartFont !== undefined && partFontOnly(outline, step, partKey)
      ? {
          family: partFont(outline, step, partKey),
          onFont: (family: SpanFontFamily) => {
            onPartFont(partKey, family);
          },
        }
      : undefined;

  const styleSelection = (
    start: number,
    end: number,
    patch: Partial<SpanFormat>,
    text: string,
  ) => {
    if (partKey === null || onPartStyle === undefined) return;
    pendingSelection.current = { partKey, start, end };
    onPartStyle(partKey, start, end, patch, text);
  };

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-desk">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-3 lg:p-7">
        <div className="slide-canvas__stage">
          <div
            className="slide-canvas__frame"
            style={{ '--slide-aspect': deckAspectRatio(outline.design?.aspectRatio ?? '16:9') } as React.CSSProperties}
            ref={frameRef}
            onClick={(event) => {
              if (!(event.target instanceof Element)) return;
              /*
               * Alt+Click is the fallback: a focused contentEditable swallows
               * the selection right-click in some browsers, and a lookup that
               * only works when the caret is elsewhere is not a lookup.
               */
              if (event.altKey && onLookUpWord !== undefined) {
                const word = wordUnderPoint(event.clientX, event.clientY);
                if (word !== null) {
                  event.preventDefault();
                  onLookUpWord(word);
                  return;
                }
              }
              if (event.target.closest('[data-part], [data-slide-decoration]')) return;
              onSelectPart(null);
            }}
            onContextMenu={(event) => {
              setLookUpHit(wordUnderPoint(event.clientX, event.clientY));
            }}
            onDoubleClick={(event) => {
              if (onEditImage === undefined || !(event.target instanceof Element)) return;
              /*
               * A selected object wears its move/resize chrome on top of
               * itself, so the second click of the gesture lands on the frame
               * rather than the picture. The chrome belongs to the selection,
               * so read the target off the selection when it is hit.
               */
              if (event.target.closest('.picture-frame') !== null) {
                if (selectedElement?.type !== 'image') return;
                event.preventDefault();
                onEditImage({ kind: 'element', elementId: selectedElement.id });
                return;
              }
              const part = event.target.closest('[data-part]');
              if (!(part instanceof HTMLElement)) return;
              const key = part.dataset['part'] ?? '';
              const element = key.startsWith('el-')
                ? stepElements(step).find((item) => item.id === key.slice(3))
                : undefined;
              if (key !== 'image' && element?.type !== 'image') return;
              event.preventDefault();
              onSelectPart(key);
              // The wired picture slot and a freeform picture object are two
              // different targets; which one was double-clicked decides.
              onEditImage(element === undefined ? { kind: 'media' } : { kind: 'element', elementId: element.id });
            }}
          >
            <StepLayout
              key={contentKey}
              design={resolveSlideDesign(outline.design, step.design)}
              step={step as SlideStep}
              options={optionsFor(outline, step)}
              prompt={promptFor(outline, step)}
              promptSpans={promptSpansFor(outline, step)}
              promptFont={promptFontFor(outline, step)}
              gaps={fillTheGapsIx?.gaps}
              bankWords={
                fillTheGapsIx?.display === 'bank' ? fillTheGapsBankWords(fillTheGapsIx) : undefined
              }
              bankSeed={fillTheGapsIx?.id}
              renderInteraction
              hiddenParts={hiddenParts}
              selectedPart={partKey}
              onPartClick={onSelectPart}
              editable={(key) => editablePart(step, key, outline)}
              partPlaceholder={(key) => ({
                text: key === 'header' && step.kind === 'interaction' ? 'Ask the class something' : partLabel(step, key),
                empty: (partValue(step, key, outline.interactions) ?? '').trim() === '',
              })}
              onPartCommit={onPartText}
              onPartKeyDown={(key, event) => {
                if (partSpanCapable(outline, step, key) && (event.metaKey || event.ctrlKey)) {
                  const which = SHORTCUT_FORMATS[event.key.toLowerCase()];
                  if (which !== undefined) {
                    event.preventDefault();
                    if (styled === null) return true;
                    // No selection is a swallowed no-op: text typed next
                    // already continues the format beside the caret.
                    const picked = partSelection(event.currentTarget);
                    if (picked === null) return true;
                    const state = toolbarState(styled, picked.start, picked.end);
                    styleSelection(picked.start, picked.end, togglePatch(state, which), picked.text);
                    return true;
                  }
                }
                if (!key.startsWith('option-')) return false;
                const index = Number(key.slice('option-'.length));
                if (!Number.isInteger(index) || index < 0) return false;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  addOption(index, visiblePartText(event.currentTarget));
                  return true;
                }
                if (
                  (event.key === 'Backspace' || event.key === 'Delete') &&
                  canRemove &&
                  visiblePartText(event.currentTarget) === ''
                ) {
                  event.preventDefault();
                  removeOption(index);
                  return true;
                }
                return false;
              }}
              optionsFooter={
                canAdd ? (
                  <li className="slide-canvas__add-option">
                    <button type="button" onClick={() => addOption()}>
                      Add option
                    </button>
                  </li>
                ) : null
              }
              partDecoration={(key) => {
                const badge =
                  showBadges && groupOf.get(key) !== undefined ? (
                    <span
                      className="slide-canvas__badge"
                      data-slide-decoration=""
                      contentEditable={false}
                      aria-label={`Reveals in step ${String(groupOf.get(key))} of ${String(groups.length)}`}
                    >
                      {groupOf.get(key)}
                    </span>
                  ) : null;
                const optionIndex = key.startsWith('option-')
                  ? Number(key.slice('option-'.length))
                  : -1;
                const remove =
                  canRemove && partKey === key && Number.isInteger(optionIndex) && optionIndex >= 0 ? (
                    <button
                      type="button"
                      className="slide-canvas__remove-option"
                      data-slide-decoration=""
                      contentEditable={false}
                      aria-label={`Remove ${partLabel(step, key).toLowerCase()}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeOption(optionIndex);
                      }}
                    >
                      Remove
                    </button>
                  ) : null;
                if (badge === null && remove === null) return null;
                return (
                  <>
                    {badge}
                    {remove}
                  </>
                );
              }}
            />
            <BlockedEmbedNotices elements={stepElements(step)} deckId={deckId} />
            {selectedElement !== undefined && frameEl !== null && onElementBox !== undefined ? (
              <ObjectFrame
                frame={frameEl}
                targetKey={`el-${selectedElement.id}`}
                box={selectedElement.box}
                onBox={(next) => onElementBox(selectedElement.id, next)}
                moveInterior={selectedElement.type !== 'text'}
              />
            ) : null}
            {(fontOnly !== undefined ||
              (styled !== null && onPartStyle !== undefined && onPartClearFormat !== undefined)) &&
            partKey !== null &&
            frameEl !== null &&
            partEl !== null &&
            !playing &&
            placing === null ? (
              <FormatToolbar
                frame={frameEl}
                part={partEl}
                styled={fontOnly === undefined ? styled : null}
                fontOnly={fontOnly}
                onStyle={styleSelection}
                onAlign={
                  textElement === null || onElementAlign === undefined
                    ? undefined
                    : (align) => {
                        onElementAlign(textElement.id, align);
                      }
                }
                onClearFormat={
                  onPartClearFormat === undefined
                    ? undefined
                    : (start, end, text) => {
                        pendingSelection.current = { partKey, start, end };
                        onPartClearFormat(partKey, start, end, text);
                      }
                }
              />
            ) : null}
            {placing !== null && onPlaceAt !== undefined ? (
              <div
                className="slide-canvas__place"
                data-slide-decoration=""
                aria-label="Click where the text box should go"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (rect === undefined || rect.width === 0 || rect.height === 0) return;
                  onPlaceAt({
                    x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
                    y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
                  });
                }}
              />
            ) : null}
            {partKey === 'image' &&
            frameEl !== null &&
            picturePlace !== null &&
            pictureSize !== null &&
            onPictureSize !== undefined ? (
              <PictureFrame
                frame={frameEl}
                place={picturePlace}
                size={pictureSize}
                onSize={onPictureSize}
              />
            ) : null}
          </div>
        </div>

        <SlideOverflowNotice issues={overflowIssues} onReview={onReviewOverflow} />
        {parent === null || step.breakoutOf === undefined ? null : (
          <div className="flex w-full max-w-[812px] flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5">
            <p className="text-secondary">
              Breakout of <strong className="font-semibold">{stepTitle(outline, parent)}</strong> — opens
              on demand after the {partLabel(parent, step.breakoutOf.afterKey).toLowerCase()}, then
              returns.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onSelectStep(parent.id)}
            >
              Back to main slide
            </Button>
          </div>
        )}
      </div>
    </div>
    </ContextMenuTrigger>
    <BlockInsertMenu
      lookUpWord={onLookUpWord === undefined ? null : lookUpHit}
      onLookUp={onLookUpWord}
      isBreakout={step.breakoutOf !== undefined}
      canDelete={canDelete}
      onInsert={onInsert}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
    </ContextMenu>
  );
}
