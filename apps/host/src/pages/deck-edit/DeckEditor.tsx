import { applyBrandKit } from './outline-edit';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stringify } from 'yaml';
import {
  kindCanCarryElements,
  kindCanCarryPicture,
  resolveRevealOrder,
  stepElements,
  validateOutline,
  type Interaction,
  type OpenRoomFileResourceV1,
  type Outline,
  type OutlineValidateResult,
} from '@openroom/schema';
import { getContextReturned } from '../../api';

import { SessionErrorList } from '../../components/SessionErrorList';
import { Button } from '@openroom/ui/components/button';
import { VersionHistory } from '../../components/VersionHistory';
import { TemplateGallery } from './TemplateGallery';
import { AskDialog } from './AskDialog';
import { SlideEmbedDialog } from './SlideEmbedDialog';
import { AsideCanvas } from './AsideCanvas';
import { EMPTY_ISSUES, type SlideOverflowIssue } from './slide-overflow';
import { BreakoutPickerDialog } from './BreakoutPickerDialog';
import { HtmlElementDialog } from './HtmlElementDialog';
import { IframeElementDialog } from './IframeElementDialog';
import { MarkdownElementDialog } from './MarkdownElementDialog';
import { PdfElementDialog } from './PdfElementDialog';
import { PictureDialog } from './PictureDialog';
import { PropertiesPanel, type PaneTab } from './PropertiesPanel';
import { FeedbackPicker } from './FeedbackPicker';
import { PracticePicker } from './PracticePicker';
import { insertCorrection, insertPracticeExercise, addPracticeHomework, setMedia } from './outline-edit';
import { Ribbon, type RibbonTab } from './Ribbon';
import { SlideCanvas } from './SlideCanvas';
import { ThumbnailRail, type RailSelection } from './ThumbnailRail';
import {
  addHtmlElement,
  addIframeElement,
  addMarkdownElement,
  addPdfElement,
  addTextElement,
  addHomeworkQuiz,
  setHomeworkInteraction,
  addHomeworkReading,
  addHomeworkWriting,
  addHomeworkVoice,
  addListItem,
  askTheClassCount,
  applyElementLayout,
  applyPictureTarget,
  clearPartStyling,
  duplicateStep,
  insertAfter,
  moveBlock,
  optionsFor,
  orderedBlocks,
  removeElement,
  removeListItem,
  removeMedia,
  removeStep,
  setHomework,
  setLayout,
  setElementAlign,
  setElementBox,
  setElementHtml,
  setElementIframe,
  setElementMarkdown,
  setElementPdf,
  stylePartRange,
  setDurationSeconds,
  setInteraction,
  setMediaFocal,
  setMediaPlace,
  setMediaSize,
  setMinutes,
  setOptionCorrect,
  setGapAnswers,
  setGapDistractors,
  setFillTheGapsBank,
  insertGapAtRange,
  setPartFont,
  setPartText,
  setRecap,
  setReveal,
  setTimerPersist,
  setTimerPlacement,
  setTimerStyle,
  setTutorNotes,
  stepMedia,
  stepMinutes,
  STEP_KIND_WORDS,
  totalMinutes,
  type InsertKind,
  type PictureTarget,
} from './outline-edit';

export type DeckEditorDialog =
  | 'templates'
  | 'picture'
  | 'ask'
  | 'breakout'
  | 'html'
  | 'iframe'
  | 'pdf'
  | 'markdown'
  | null;

/**
 * The deck editor: connected ribbon, thumbnail rail, desk, task pane, status bar.
 *
 * Every structural verb is a pure function from `outline-edit.ts`. This
 * component holds selection, playback, and which dialog is open.
 */
export function DeckEditor({
  deckId,
  activeStepId,
  spaceId,
  contextId = null,
  currentVersion = 0,
  versionRefresh = 0,
  source,
  onSourceChange,
  validation,
  onPresentFrom,
  onDownloadFile,
  fileActions,
  onEmbeddedResource,
  onRefineWithAgent,
  onEmbedCode,
}: {
  deckId: string;
  activeStepId?: string;
  spaceId: string | null;
  contextId?: string | null;
  /**
   * Hand reading material to the agent pane. Desktop only — the browser app has
   * no agent surface, so this is absent there and the button does not render.
   */
  onRefineWithAgent?: (markdown: string) => void;
  currentVersion?: number;
  versionRefresh?: number;
  source: string;
  onSourceChange: (next: string) => void;
  validation: OutlineValidateResult | null;
  onPresentFrom: (blockIndex: number) => void;
  onDownloadFile?: () => void;
  fileActions?: ReactNode;
  onEmbeddedResource?: (resourceId: string, resource: OpenRoomFileResourceV1) => void;
  onEmbedCode?: (stepId: string) => Promise<string>;
}) {
  const [embedStep, setEmbedStep] = useState<string | null>(null);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home');
  const [selection, setSelection] = useState<RailSelection | null>(null);
  useEffect(() => { if (activeStepId) setSelection({ kind: 'step', id: activeStepId }); }, [activeStepId]);
  const [partKey, setPartKey] = useState<string | null>(null);
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const [revealFocus, setRevealFocus] = useState(0);
  const [paneOpen, setPaneOpen] = useState(true);
  const [paneTab, setPaneTab] = useState<PaneTab>('design');
  const [overflow, setOverflow] = useState({ stepId: '', issues: EMPTY_ISSUES });
  const [overflowFocus, setOverflowFocus] = useState({ target: '', sequence: 0 });
  const onOverflowChange = useCallback((stepId: string, issues: SlideOverflowIssue[]) => {
    setOverflow((previous) => previous.stepId === stepId && previous.issues === issues ? previous : { stepId, issues });
  }, []);
  const focusOverflow = (target: string, key: string | null = null) => {
    setPaneOpen(true);
    setPaneTab('design');
    setPartKey(key);
    setOverflowFocus((previous) => ({ target, sequence: previous.sequence + 1 }));
  };
  /** A word being looked up in the properties panel. Never enters the outline. */
  const [lookUpWord, setLookUpWord] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState<DeckEditorDialog>(null);
  const [htmlEditId, setHtmlEditId] = useState<string | null>(null);
  const [iframeEditId, setIframeEditId] = useState<string | null>(null);
  const [markdownEditId, setMarkdownEditId] = useState<string | null>(null);
  /** Carried in when a blocked web page hands its address to the reading dialog. */
  const [markdownSeedUrl, setMarkdownSeedUrl] = useState<string | undefined>(undefined);
  const [pdfEditId, setPdfEditId] = useState<string | null>(null);
  /** What the open picture dialog is choosing a picture for. */
  const [pictureTarget, setPictureTarget] = useState<PictureTarget>({ kind: 'new' });
  const [placing, setPlacing] = useState<'text' | null>(null);
  const [pickupDismissed, setPickupDismissed] = useState(false);

  const pickupQuery = useQuery({
    queryKey: ['contexts', contextId, 'returned'] as const,
    queryFn: () => getContextReturned(contextId!),
    enabled: contextId !== null && contextId !== '',
  });
  const nextNote = pickupQuery.data?.nextNote ?? '';
  const missed = pickupQuery.data?.missed ?? [];

  const outline = validation?.ok === true ? validation.outline : null;
  const blocks = useMemo(() => (outline === null ? [] : orderedBlocks(outline)), [outline]);

  const selectedStepId = selection?.kind === 'step' ? selection.id : null;
  const aside = selection?.kind === 'homework' || selection?.kind === 'recap' ? selection.kind : null;
  const step =
    outline?.steps.find((candidate) => candidate.id === selectedStepId) ??
    (aside === null ? (blocks[0]?.step ?? null) : null);
  const railSelection: RailSelection =
    selection ?? (step !== null ? { kind: 'step', id: step.id } : { kind: 'homework' });

  const groups = useMemo(
    () => (outline === null || step === null ? [] : resolveRevealOrder(step, outline.interactions)),
    [outline, step],
  );
  const activePart = partKey !== null && groups.some((group) => group.includes(partKey)) ? partKey : null;

  /** The picture the open dialog is replacing, so the grid shows it selected. */
  const pictureDialogUrl = ((): string | undefined => {
    if (step === null || pictureTarget.kind === 'new') return undefined;
    if (pictureTarget.kind === 'media') return stepMedia(step)?.url;
    const element = stepElements(step).find((item) => item.id === pictureTarget.elementId);
    return element?.type === 'image' ? element.url : undefined;
  })();

  const apply = (next: Outline) => {
    // Structured edits must leave a document the validator still accepts.
    // An invalid write is not a warning: parseOutline then replaces the
    // editor with the repair screen. Refuse here so a button cannot.
    if (!validateOutline(next).ok) return;
    onSourceChange(stringify(next, { lineWidth: 100 }));
  };

  const selectStep = (stepId: string) => {
    setSelection({ kind: 'step', id: stepId });
    setPartKey(null);
    setPlayIndex(null);
    setPlacing(null);
  };

  const insert = (
    kind: InsertKind,
    afterStepId?: string | null,
    options?: { asBreakout?: boolean; afterKey?: string },
  ) => {
    if (outline === null) return;
    const after = afterStepId === undefined ? (step?.id ?? null) : afterStepId === '' ? null : afterStepId;
    const result = insertAfter(outline, after, kind, {
      afterKey: options?.afterKey ?? activePart ?? undefined,
      asBreakout: options?.asBreakout,
    });
    if (result.stepId === '') return;
    apply(result.outline);
    selectStep(result.stepId);
    if (kind === 'image' || kind === 'media' || kind === 'media-full') {
      setPartKey('image');
      // A picture slide is its picture: the dialog fills the wired slot the
      // insert just made, never a freeform object on top of it.
      setPictureTarget({ kind: 'media' });
      setOpenDialog('picture');
    }
  };

  /**
   * Open the picture dialog for a named target.
   *
   * The gesture decides what the picture is for, because the slide cannot: a
   * title or statement carries both a wired picture and freeform objects, so
   * "change this slide's picture" (canvas double-click on the picture, the
   * Picture section's Change…) and "add a picture" (ribbon Insert) would be
   * indistinguishable from the live selection alone.
   */
  const openPicture = (target: PictureTarget) => {
    if (outline === null || step === null) return;
    if (target.kind === 'element') {
      if (!kindCanCarryElements(step.kind)) return;
    } else if (target.kind === 'media') {
      if (!kindCanCarryPicture(step.kind)) return;
      setPartKey('image');
    } else if (!kindCanCarryElements(step.kind) && !kindCanCarryPicture(step.kind)) {
      return;
    }
    setPictureTarget(target);
    setOpenDialog('picture');
  };

  // "Text box" arms placement: the author points at the slide and the box
  // lands there (Escape cancels), the same gesture as PowerPoint's insert.
  const addTextBox = () => {
    if (outline === null || step === null || !kindCanCarryElements(step.kind)) return;
    setPlacing('text');
  };

  const openHtmlDialog = (elementId?: string) => {
    if (outline === null || step === null || !kindCanCarryElements(step.kind)) return;
    setHtmlEditId(elementId ?? null);
    setOpenDialog('html');
  };

  const openIframeDialog = (elementId?: string) => {
    if (outline === null) return;
    if (elementId === undefined && (step === null || !kindCanCarryElements(step.kind))) return;
    setIframeEditId(elementId ?? null);
    setOpenDialog('iframe');
  };

  const openPdfDialog = (elementId?: string) => {
    if (outline === null) return;
    if (elementId === undefined && (step === null || !kindCanCarryElements(step.kind))) return;
    setPdfEditId(elementId ?? null);
    setOpenDialog('pdf');
  };

  const openMarkdownDialog = (elementId?: string, seedUrl?: string) => {
    if (outline === null) return;
    if (elementId === undefined && (step === null || !kindCanCarryElements(step.kind))) return;
    setMarkdownEditId(elementId ?? null);
    setMarkdownSeedUrl(seedUrl);
    setOpenDialog('markdown');
  };

  const canDelete =
    step !== null && (step.breakoutOf !== undefined || blocks.length > 1);

  const remove = (stepId: string) => {
    if (outline === null) return;
    const target = outline.steps.find((item) => item.id === stepId);
    if (target === undefined) return;
    if (target.breakoutOf === undefined && blocks.length < 2) return;
    apply(removeStep(outline, stepId));
    if (stepId === step?.id) {
      setSelection(target.breakoutOf ? { kind: 'step', id: target.breakoutOf.stepId } : null);
      setPartKey(null);
    }
  };

  const preparedBreakouts =
    outline === null || step === null
      ? []
      : outline.steps.filter((item) => item.breakoutOf?.stepId === (step.breakoutOf?.stepId ?? step.id));

  const ribbon = (
    <Ribbon
      deckId={deckId}
      tab={ribbonTab}
      onTabChange={(next) => { setRibbonTab(next); setPlayIndex(null); }}
      selected={step}
      onTemplates={() => setOpenDialog('templates')}
      onInsert={(kind, options) => insert(kind, step?.id ?? null, options)}
      onDuplicate={() => {
        if (outline === null || step === null) return;
        const result = duplicateStep(outline, step.id);
        apply(result.outline);
        selectStep(result.stepId);
      }}
      onDelete={() => { if (step !== null) remove(step.id); }}
      onCopyEmbed={onEmbedCode && step ? () => setEmbedStep(step.id) : undefined}
      canDelete={canDelete}
      onMinutes={(delta) => { if (outline !== null && step !== null) apply(setMinutes(outline, step.id, delta)); }}
      onLayout={(layout) => { if (outline !== null && step !== null) apply(setLayout(outline, step.id, layout)); }}
      onElementLayout={(layoutId) => {
        if (outline !== null && step !== null) apply(applyElementLayout(outline, step.id, layoutId));
      }}
      groupCount={groups.length}
      playIndex={playIndex}
      onPlayNext={() =>
        setPlayIndex((at) => (at === null ? 1 : at >= groups.length ? 1 : at + 1))
      }
      onPlayAll={() => setPlayIndex(null)}
      onRevealTogether={() => {
        if (outline !== null && step !== null) apply(setReveal(outline, step.id, groups.length === 0 ? [] : [groups.flat()]));
        setPlayIndex(null);
      }}
      onRevealOneAtATime={() => {
        if (outline !== null && step !== null) apply(setReveal(outline, step.id, groups.flat().map((key) => [key])));
        setPlayIndex(null);
      }}
      onEditOrder={() => {
        setPartKey(null);
        setRevealFocus((at) => at + 1);
        setPaneOpen(true);
        setPaneTab('design');
      }}
      onOpenPicture={() => openPicture({ kind: 'new' })}
      onAddTextBox={addTextBox}
      onAddHtml={() => openHtmlDialog()}
      onAddIframe={() => openIframeDialog()}
      onAddPdf={() => openPdfDialog()}
      onAddMarkdown={() => openMarkdownDialog()}
      onOpenAsk={() => setOpenDialog('ask')}
      onPresentFrom={() => {
        const at = blocks.findIndex(
          (block) => block.step.id === (step?.breakoutOf?.stepId ?? step?.id),
        );
        onPresentFrom(at === -1 ? 0 : at);
      }}
      canPresent={outline !== null}
      onDownloadFile={onDownloadFile}
      fileActions={fileActions}
    />
  );

  if (outline === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {ribbon}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SessionErrorList
            message="This outline cannot be read yet. Restore an earlier version or ask the person who created it to repair it."
            errors={validation?.ok === false ? validation.errors.slice(0, 5) : []}
          />
          <div className="mx-auto max-w-lg px-[18px] py-3.5">
            <h3 className="text-row-title">History</h3>
            <VersionHistory
              deckId={deckId}
              refreshKey={versionRefresh}
              currentVersion={currentVersion}
              onLoadVersion={(nextSource) => { onSourceChange(nextSource); }}
            />
          </div>
        </div>
      </div>
    );
  }

  const slideIndex = step === null || step.breakoutOf !== undefined
    ? blocks.findIndex((block) => block.step.id === (step?.breakoutOf?.stepId ?? ''))
    : blocks.findIndex((block) => block.step.id === step.id);
  const slideNumber = slideIndex === -1 ? 1 : slideIndex + 1;
  const asks = askTheClassCount(outline);
  const minutes = step === null ? null : stepMinutes(step);
  const kindWord = step === null ? null : STEP_KIND_WORDS[step.kind];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {ribbon}
      {nextNote !== '' && !pickupDismissed ? (
        <div className="flex items-start justify-between gap-3 border-b border-hairline bg-card px-6 py-2.5">
          <p className="text-secondary">
            <span className="text-caption text-muted-foreground">Next session · </span>
            {nextNote}
          </p>
          <button
            type="button"
            className="text-caption text-muted-foreground hover:text-foreground"
            onClick={() => setPickupDismissed(true)}
          >
            Hide
          </button>
        </div>
      ) : null}
      <div className="deck-editor-workarea flex min-h-0 min-w-0 flex-1 overflow-x-auto">
        <ThumbnailRail
          outline={outline}
          selection={railSelection}
          onSelect={selectStep}
          onMove={(stepId, toIndex) => { apply(moveBlock(outline, stepId, toIndex)); }}
          onTemplates={() => setOpenDialog('templates')}
          onInsert={(afterStepId, kind, options) => insert(kind, afterStepId || null, options)}
          onDuplicate={(stepId) => {
            const result = duplicateStep(outline, stepId);
            apply(result.outline);
            selectStep(result.stepId);
          }}
          onDelete={(stepId) => remove(stepId)}
          canDelete={(stepId) => {
            const target = outline.steps.find((item) => item.id === stepId);
            if (target === undefined) return false;
            if (target.breakoutOf !== undefined) return true;
            return orderedBlocks(outline).length > 1;
          }}
          onSelectHomework={() => {
            setSelection({ kind: 'homework' });
            setPartKey(null);
            setPaneOpen(true);
            setPaneTab('design');
          }}
          onSelectRecap={() => {
            setSelection({ kind: 'recap' });
            setPartKey(null);
            setPaneOpen(true);
            setPaneTab('design');
          }}
        />
        {aside !== null ? (
          <AsideCanvas
            kind={aside}
            aside={aside === 'homework' ? outline.homework : outline.recap}
            interactions={outline.interactions}
            onChange={(next) => apply(aside === 'homework' ? setHomework(outline, next) : setRecap(outline, next))}
            onAddReading={() => apply(addHomeworkReading(outline))}
            onAddWriting={() => apply(addHomeworkWriting(outline))}
            onAddVoice={() => apply(addHomeworkVoice(outline))}
            onAddQuiz={(interactionId) => apply(addHomeworkQuiz(outline, interactionId))}
            onQuizChange={(interaction) => apply(setHomeworkInteraction(outline, interaction))}
          />
        ) : step === null ? (
          <p className="flex flex-1 items-center justify-center bg-desk text-secondary text-muted-foreground">
            This deck has no slides yet. Add one from the rail or the Home tab.
          </p>
        ) : (
          <SlideCanvas
            onOverflowChange={onOverflowChange}
            onReviewOverflow={() => focusOverflow('overflow')}
            onLookUpWord={setLookUpWord}
            deckId={deckId}
            outline={outline}
            step={step}
            groups={groups}
            playIndex={playIndex}
            partKey={activePart}
            onSelectPart={setPartKey}
            onPartText={(key, text) => { apply(setPartText(outline, step.id, key, text)); }}
            onSelectStep={selectStep}
            onInsert={(kind, options) => insert(kind, step.id, options)}
            onDuplicate={() => {
              const result = duplicateStep(outline, step.id);
              apply(result.outline);
              selectStep(result.stepId);
            }}
            onDelete={() => remove(step.id)}
            canDelete={canDelete}
            onAddOption={(afterIndex, commitText) => {
              let next = outline;
              if (commitText !== undefined && afterIndex !== undefined) {
                next = setPartText(next, step.id, `option-${String(afterIndex)}`, commitText);
              }
              const before = optionsFor(next, step).length;
              next = addListItem(next, step.id, 'option', afterIndex);
              apply(next);
              const nextIndex = afterIndex === undefined ? before : afterIndex + 1;
              setPartKey(`option-${String(nextIndex)}`);
            }}
            onRemoveOption={(index) => {
              apply(removeListItem(outline, step.id, 'option', index));
              const remaining = optionsFor(outline, step).length - 1;
              if (remaining <= 0) setPartKey(null);
              else setPartKey(`option-${String(Math.max(0, Math.min(index, remaining - 1)))}`);
            }}
            onPictureSize={(size) => apply(setMediaSize(outline, step.id, size))}
            onRemovePicture={() => {
              apply(removeMedia(outline, step.id));
              setPartKey(null);
            }}
            onElementBox={(elementId, box) => apply(setElementBox(outline, step.id, elementId, box))}
            /*
             * One write per gesture: the text the part currently holds is
             * committed and the style applied on top of it, so the source moves
             * once and undo steps back over the whole gesture.
             */
            onPartStyle={(key, start, end, patch, text) =>
              apply(
                stylePartRange(
                  setPartText(outline, step.id, key, text),
                  step.id,
                  key,
                  start,
                  end,
                  patch,
                ),
              )
            }
            /* Whole-part, no range: the fill-the-gaps prompt's one style. */
            onPartFont={(key, family) => apply(setPartFont(outline, step.id, key, family))}
            onElementAlign={(elementId, align) =>
              apply(setElementAlign(outline, step.id, elementId, align))
            }
            onPartClearFormat={(key, start, end, text) =>
              apply(
                clearPartStyling(
                  setPartText(outline, step.id, key, text),
                  step.id,
                  key,
                  start,
                  end,
                ),
              )
            }
            onRemoveElement={(elementId) => {
              apply(removeElement(outline, step.id, elementId));
              setPartKey(null);
            }}
            onEditImage={openPicture}
            placing={placing}
            onPlaceAt={(point) => {
              setPlacing(null);
              const result = addTextElement(outline, step.id, point);
              if (result.elementId === '') return;
              apply(result.outline);
              setPartKey(`el-${result.elementId}`);
            }}
            onCancelPlace={() => setPlacing(null)}
          />
        )}
        {paneOpen ? (
          <PropertiesPanel
            overflowIssues={aside === null && overflow.stepId === step?.id ? overflow.issues : EMPTY_ISSUES}
            overflowFocus={overflowFocus}
            onOverflowSelect={(issue) => focusOverflow(issue.target, issue.partKey)}
            onOverflowLayout={() => focusOverflow('layout')}
            onResetTemplate={() => { if (step) apply(resetTemplateFormatting(outline, step.id)); }}
            onApplyBrandKit={(design) => apply(applyBrandKit(outline, design))}
          onDeckDesign={(design) => apply(setDeckDesign(outline, design))}
            onSlideDesign={(design) => { if (step) apply(setSlideDesign(outline, step.id, design)); }}
            lookUpWord={lookUpWord}
            onCloseLookUp={() => setLookUpWord(null)}
            outline={outline}
            step={step}
            aside={aside}
            partKey={activePart}
            groups={groups}
            spaceId={spaceId}
            deckId={deckId}
            currentVersion={currentVersion}
            versionRefresh={versionRefresh}
            revealFocus={revealFocus}
            paneTab={paneTab}
            learnerFeedback={<>{pickupQuery.isError ? <div className="grid gap-2 border-t border-hairline px-[18px] py-4"><p role="alert" className="text-sm">Learner work could not be loaded.</p><Button variant="outline" size="sm" disabled={pickupQuery.isFetching} onClick={() => void pickupQuery.refetch()}>Retry learner work</Button></div> : null}<FeedbackPicker corrections={pickupQuery.data?.corrections ?? []} onInsert={(correction) => {
              const inserted = insertCorrection(outline, step?.id ?? null, correction);
              if (!inserted.stepId) return;
              apply(inserted.outline);
              selectStep(inserted.stepId);
            }} /><PracticePicker missed={missed} onAddSlide={(exercise) => {
              const inserted = insertPracticeExercise(outline, step?.id ?? null, exercise);
              if (!inserted.stepId) return false;
              apply(inserted.outline); selectStep(inserted.stepId); return true;
            }} onAddHomework={(exercise) => {
              const next = addPracticeHomework(outline, exercise);
              if (next === outline) return false;
              apply(next); return true;
            }} /></>}
            onPaneTab={setPaneTab}
            onClose={() => setPaneOpen(false)}
            onSelectPart={setPartKey}
            onLayout={(layout) => { if (step !== null) apply(setLayout(outline, step.id, layout)); }}
            onMinutes={(delta) => { if (step !== null) apply(setMinutes(outline, step.id, delta)); }}
            onReveal={(next) => { if (step !== null) apply(setReveal(outline, step.id, next)); }}
            onPartText={(key, text) => { if (step !== null) apply(setPartText(outline, step.id, key, text)); }}
            onAddBreakout={(key) => {
              if (step === null) return;
              const result = insertAfter(outline, step.id, 'statement', {
                afterKey: key,
                asBreakout: true,
              });
              if (result.stepId === '') return;
              apply(result.outline);
              selectStep(result.stepId);
            }}
            onSelectStep={selectStep}
            onRemoveStep={remove}
            onAddListItem={(target, index) => { if (step !== null) apply(addListItem(outline, step.id, target, index)); }}
            onRemoveListItem={(target, index) => { if (step !== null) apply(removeListItem(outline, step.id, target, index)); }}
            onOptionCorrect={(index) => { if (step !== null) apply(setOptionCorrect(outline, step.id, index)); }}
            onGapAnswers={(index, answers) => { if (step !== null) apply(setGapAnswers(outline, step.id, index, answers)); }}
            onGapDistractors={(index, distractors) => { if (step !== null) apply(setGapDistractors(outline, step.id, index, distractors)); }}
            onFillTheGapsBank={(bank) => { if (step !== null) apply(setFillTheGapsBank(outline, step.id, bank)); }}
            onInsertGapAtRange={(start, end) => { if (step !== null) apply(insertGapAtRange(outline, step.id, start, end)); }}
            onOpenPicture={openPicture}
            onRemovePicture={() => {
              if (step === null) return;
              apply(removeMedia(outline, step.id));
              setPartKey(null);
            }}
            onMediaFocal={(focal) => {
              if (step === null) return;
              apply(setMediaFocal(outline, step.id, focal));
            }}
            onMediaChange={(media) => { if (step) apply(setMedia(outline, step.id, media)); }}
            onEmbeddedResource={onEmbeddedResource}
            onMediaPlace={(place) => {
              if (step === null) return;
              apply(setMediaPlace(outline, step.id, place));
            }}
            onMediaSize={(size) => {
              if (step === null) return;
              apply(setMediaSize(outline, step.id, size));
            }}
            onRemoveElement={(elementId) => {
              if (step === null) return;
              apply(removeElement(outline, step.id, elementId));
              setPartKey(null);
            }}
            onEditHtml={(elementId) => openHtmlDialog(elementId)}
            onEditMarkdown={(elementId) => openMarkdownDialog(elementId)}
            onEditIframe={(elementId) => openIframeDialog(elementId)}
            onEditPdf={(elementId) => openPdfDialog(elementId)}
            onDurationSeconds={(seconds) => {
              if (step !== null) apply(setDurationSeconds(outline, step.id, seconds));
            }}
            onTimerStyle={(style) => {
              if (step !== null) apply(setTimerStyle(outline, step.id, style));
            }}
            onTimerPlacement={(placement) => {
              if (step !== null) apply(setTimerPlacement(outline, step.id, placement));
            }}
            onTimerPersist={(persist) => {
              if (step !== null) apply(setTimerPersist(outline, step.id, persist));
            }}
            onInteraction={(interaction) => {
              if (step !== null) apply(setInteraction(outline, step.id, interaction));
            }}
            onNotes={(stepId, text) => { apply(setTutorNotes(outline, stepId, text)); }}
            onHomework={(next) => apply(setHomework(outline, next))}
            onRecap={(next) => apply(setRecap(outline, next))}
            onLoadVersion={(nextSource) => { onSourceChange(nextSource); }}
          />
        ) : null}
      </div>

      <footer className="flex h-[30px] shrink-0 items-center gap-4 border-t border-border bg-chrome px-3.5 text-caption text-muted-foreground">
        <span>
          Slide <span className="tabular-nums">{slideNumber}</span> of{' '}
          <span className="tabular-nums">{blocks.length}</span>
        </span>
        {kindWord === null ? null : (
          <span>
            {kindWord}
            {minutes === null ? null : (
              <>
                {' · '}
                <span className="tabular-nums">{minutes}</span> min
              </>
            )}
          </span>
        )}
        <span className="flex-1" />
        <span>
          <span className="tabular-nums">{asks}</span>{' '}
          {asks === 1 ? 'activity asks the class' : 'activities ask the class'}
        </span>
        <span>
          {outline.meta.durationMinutes === undefined ? 'Timed activities' : 'Lesson estimate'}{' '}
          <span className="tabular-nums">{outline.meta.durationMinutes ?? totalMinutes(outline)}</span> min
        </span>
        {paneOpen ? null : (
          <button
            type="button"
            onClick={() => setPaneOpen(true)}
            className="h-[22px] rounded-md px-2 text-primary hover:bg-background"
          >
            Slide pane
          </button>
        )}
      </footer>

      {onEmbedCode ? <SlideEmbedDialog key={embedStep ?? 'closed'} stepId={embedStep} prepare={onEmbedCode} onClose={() => setEmbedStep(null)} /> : null}
      <TemplateGallery open={openDialog === 'templates'} onOpenChange={(open) => setOpenDialog(open ? 'templates' : null)} outline={outline}
        onWorkshop={(sequenceId) => {
          const result = insertWorkshop(outline, step?.id ?? null, sequenceId);
          if (!result.stepId) return;
          apply(result.outline); selectStep(result.stepId); setOpenDialog(null);
        }}
        onPick={(templateId) => {
          const result = insertTemplate(outline, step?.id ?? null, templateId);
          if (!result.stepId) return;
          apply(result.outline); selectStep(result.stepId); setOpenDialog(null);
        }}
        onBlank={() => { insert('blank', step?.id ?? null); setOpenDialog(null); }} />
      <PictureDialog
        open={openDialog === 'picture'}
        spaceId={spaceId}
        selectedUrl={pictureDialogUrl}
        onOpenChange={(open) => {
          setOpenDialog(open ? 'picture' : null);
          if (!open) setPictureTarget({ kind: 'new' });
        }}
        onEmbedded={onEmbeddedResource}
        onInsert={(media, credit) => {
          if (outline === null || step === null) return;
          const next = credit ? media : { ...media };
          if (!credit) delete next.caption;
          const result = applyPictureTarget(outline, step.id, pictureTarget, next);
          if (result.partKey === null) return;
          apply(result.outline);
          setPartKey(result.partKey);
        }}
      />
      <HtmlElementDialog
        open={openDialog === 'html'}
        initialHtml={
          htmlEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === htmlEditId);
                return item?.type === 'html' ? item.html : undefined;
              })()
            : undefined
        }
        initialCss={
          htmlEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === htmlEditId);
                return item?.type === 'html' ? item.css : undefined;
              })()
            : undefined
        }
        onOpenChange={(open) => {
          setOpenDialog(open ? 'html' : null);
          if (!open) setHtmlEditId(null);
        }}
        onSave={(html, css) => {
          if (step === null) return;
          if (htmlEditId !== null) {
            apply(setElementHtml(outline, step.id, htmlEditId, html, css));
            setPartKey(`el-${htmlEditId}`);
            return;
          }
          const result = addHtmlElement(outline, step.id, html, css);
          if (result.elementId === '') return;
          apply(result.outline);
          setPartKey(`el-${result.elementId}`);
        }}
      />
      <IframeElementDialog
        open={openDialog === 'iframe'}
        deckId={deckId}
        onImportAsReading={(url) => {
          setIframeEditId(null);
          openMarkdownDialog(undefined, url);
        }}
        initialUrl={
          iframeEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === iframeEditId);
                return item?.type === 'iframe' ? item.url : undefined;
              })()
            : undefined
        }
        initialTitle={
          iframeEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === iframeEditId);
                return item?.type === 'iframe' ? item.title : undefined;
              })()
            : undefined
        }
        onOpenChange={(open) => {
          setOpenDialog(open ? 'iframe' : null);
          if (!open) setIframeEditId(null);
        }}
        onSave={(url, title) => {
          if (outline === null || step === null) return;
          if (iframeEditId !== null) {
            apply(setElementIframe(outline, step.id, iframeEditId, url, title));
            setPartKey(`el-${iframeEditId}`);
            return;
          }
          const result = addIframeElement(outline, step.id, url, title);
          if (result.elementId === '') return;
          apply(result.outline);
          setPartKey(`el-${result.elementId}`);
        }}
      />
      <PdfElementDialog
        open={openDialog === 'pdf'}
        spaceId={spaceId}
        initialUrl={
          pdfEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === pdfEditId);
                return item?.type === 'pdf' ? item.url : undefined;
              })()
            : undefined
        }
        initialResourceId={
          pdfEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === pdfEditId);
                return item?.type === 'pdf' ? item.resourceId : undefined;
              })()
            : undefined
        }
        initialTitle={
          pdfEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === pdfEditId);
                return item?.type === 'pdf' ? item.title : undefined;
              })()
            : undefined
        }
        onOpenChange={(open) => {
          setOpenDialog(open ? 'pdf' : null);
          if (!open) setPdfEditId(null);
        }}
        onEmbedded={onEmbeddedResource}
        onSave={(pdfSource, title) => {
          if (outline === null || step === null) return;
          if (pdfEditId !== null) {
            apply(setElementPdf(outline, step.id, pdfEditId, pdfSource, title));
            setPartKey(`el-${pdfEditId}`);
            return;
          }
          const result = addPdfElement(outline, step.id, pdfSource, title);
          if (result.elementId === '') return;
          apply(result.outline);
          setPartKey(`el-${result.elementId}`);
        }}
      />
      <MarkdownElementDialog
        open={openDialog === 'markdown'}
        deckId={deckId}
        initialUrl={markdownSeedUrl}
        initialMarkdown={
          markdownEditId !== null && step !== null
            ? (() => {
                const item = stepElements(step).find((el) => el.id === markdownEditId);
                return item?.type === 'html' ? item.markdown : undefined;
              })()
            : undefined
        }
        onOpenChange={(open) => {
          setOpenDialog(open ? 'markdown' : null);
          if (!open) {
            setMarkdownEditId(null);
            setMarkdownSeedUrl(undefined);
          }
        }}
        onRefineWithAgent={onRefineWithAgent}
        onSave={(markdown) => {
          if (outline === null || step === null) return;
          if (markdownEditId !== null) {
            apply(setElementMarkdown(outline, step.id, markdownEditId, markdown));
            setPartKey(`el-${markdownEditId}`);
            return;
          }
          const result = addMarkdownElement(outline, step.id, markdown);
          if (result.elementId === '') return;
          apply(result.outline);
          setPartKey(`el-${result.elementId}`);
        }}
      />
      <AskDialog
        open={openDialog === 'ask'}
        afterLabel={step === null ? 'at the end' : `after slide ${String(slideNumber)}`}
        onOpenChange={(open) => setOpenDialog(open ? 'ask' : null)}
        onAdd={(interaction: Interaction) => {
          if (outline === null) return;
          const kind =
            interaction.type === 'fill-the-gaps' ? 'fill-the-gaps' : interaction.type === 'match' ? 'match' : 'question';
          const result = insertAfter(outline, step?.id ?? null, kind);
          if (result.stepId === '') return;
          const placed = setInteraction(result.outline, result.stepId, {
            ...interaction,
            id:
              result.outline.steps.find((item) => item.id === result.stepId)?.kind === 'interaction'
                ? (result.outline.steps.find((item) => item.id === result.stepId) as { interactionId: string })
                    .interactionId
                : interaction.id,
          });
          apply(placed);
          selectStep(result.stepId);
        }}
      />
      <BreakoutPickerDialog
        open={openDialog === 'breakout'}
        outline={outline}
        step={step}
        prepared={preparedBreakouts}
        onOpenChange={(open) => setOpenDialog(open ? 'breakout' : null)}
        onShow={(pick, preparedId) => {
          if (pick === 'prepared' && preparedId !== undefined) {
            selectStep(preparedId);
            return;
          }
          insert(pick === 'poll' ? 'question' : 'statement', step?.id ?? null, { asBreakout: true });
        }}
      />
    </div>
  );
}
import { setDeckDesign, setSlideDesign, insertTemplate, insertWorkshop, resetTemplateFormatting } from './outline-edit';
