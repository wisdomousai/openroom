import { Fragment, useState, type ReactNode } from 'react';
import {
  AlignLeft,
  ArrowUpDown,
  BookOpen,
  Boxes,
  CircleHelp,
  Clapperboard,
  Clock3,
  Coffee,
  Copy,
  Download,
  Eye,
  Film,
  FileText,
  Globe2,
  Heading1,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  ListOrdered,
  Maximize,
  MessagesSquare,
  Minus,
  MonitorPlay,
  Play,
  Plus,
  QrCode,
  ScrollText,
  Shuffle,
  Square,
  SquareCode,
  PanelTop,
  TextCursorInput,
  Trash2,
  Type,
  Users,
  UsersRound,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import {
  LAYOUTS_FOR_KIND,
  kindCanCarryElements,
  kindCanCarryPicture,
  resolvedStepLayout,
  type OutlineLayout,
  type OutlineStep,
} from '@openroom/schema';

import { Button } from '@openroom/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@openroom/ui/components/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@openroom/ui/components/tabs';
import { ToggleGroup, ToggleGroupItem } from '@openroom/ui/components/toggle-group';
import { cn } from '@openroom/ui/utils';
import {
  PLAN_FILE,
  deckGetCommand,
  deckSaveCommand,
  deckStartCommand,
  deckToolLine,
  outlineValidateCommand,
} from './agent-commands';
import { ElementLayoutThumb, LayoutThumb, LAYOUT_WORDS } from './LayoutThumb';
import {
  elementLayoutsFor,
  hasMinutes,
  INSERT_CATALOG,
  stepMinutes,
  type InsertKind,
} from './outline-edit';

/** One icon per insertable step kind, shared by every ribbon tab that lists them. */
const INSERT_ICONS: Record<InsertKind, LucideIcon> = {
  block: LayoutTemplate,
  title: Heading1,
  statement: AlignLeft,
  cards: LayoutGrid,
  steps: ListOrdered,
  term: BookOpen,
  blank: Square,
  'blank-titled': PanelTop,
  image: ImageIcon,
  media: Clapperboard,
  boxes: Boxes,
  video: Film,
  audio: Volume2,
  'media-full': Maximize,
  question: CircleHelp,
  'fill-the-gaps': TextCursorInput,
  match: Shuffle,
  activity: Users,
  timer: Clock3,
  join: QrCode,
  debrief: MessagesSquare,
  break: Coffee,
};

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-none flex-col items-center justify-between gap-1 px-2.5">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

function Rule() {
  return <span aria-hidden="true" className="my-1.5 w-px shrink-0 self-stretch bg-hairline" />;
}

/** Consecutive catalog entries with the same starter, in catalog order. */
function starterRuns<T extends { starter: string }>(items: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0]!.starter === item.starter) last.push(item);
    else runs.push([item]);
  }
  return runs;
}

/** A ribbon row; `wrap` moves whole groups to a second line when the window is too narrow for them. */
function Row({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <div className={cn('flex min-h-[76px] items-stretch px-2 py-2 pb-1.5', wrap ? 'flex-wrap gap-y-2' : 'overflow-x-auto')}>{children}</div>
  );
}

function LargeButton({
  label,
  onClick,
  disabled,
  ask,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  ask?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-[60px] w-[62px] flex-col items-center justify-center gap-1.5 rounded-lg text-caption',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50',
        ask
          ? 'text-live-tint-foreground hover:bg-live-tint'
          : 'hover:bg-chrome',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      disabled={disabled}
      onValueChange={(id) => {
        // Radix reports a re-click of the active segment as ''; one stays on.
        if (id !== '') onChange(id);
      }}
      className="gap-0 rounded-lg bg-chrome p-0.5"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.id}
          value={option.id}
          className={cn(
            'h-7 flex-none rounded-[3px] px-3 text-secondary font-normal',
            'text-muted-foreground hover:bg-transparent hover:text-foreground',
            'data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground',
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export type RibbonTab = 'file' | 'home' | 'slide' | 'insert' | 'ask' | 'reveal' | 'view';

export interface RibbonProps {
  deckId: string;
  /**
   * The origin the hosted deck lives on, for the plan.yaml commands. Null for
   * a deck with no hosted copy (a local Desktop file): the menu is not shown.
   */
  cliOrigin: string | null;
  /** The base version a CLI save would name. */
  currentVersion: number;
  tab: RibbonTab;
  onTabChange: (tab: RibbonTab) => void;
  selected: OutlineStep | null;
  onTemplates: () => void;
  onInsert: (kind: InsertKind, options?: { asBreakout?: boolean }) => void;
  onDuplicate: () => void;
  onCopyEmbed?: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onMinutes: (delta: number) => void;
  onLayout: (layout: OutlineLayout) => void;
  /**
   * Re-box a freeform composition into one of the element presets. Not a stored
   * layout — a one-shot geometry command, undone like any other edit.
   */
  onElementLayout: (layoutId: string) => void;
  groupCount: number;
  playIndex: number | null;
  onPlayNext: () => void;
  onPlayAll: () => void;
  onRevealTogether: () => void;
  onRevealOneAtATime: () => void;
  onEditOrder: () => void;
  onOpenPicture: () => void;
  onAddTextBox: () => void;
  onAddHtml: () => void;
  onAddIframe: () => void;
  onAddPdf: () => void;
  onAddMarkdown: () => void;
  onOpenAsk: () => void;
  onPresentFrom: () => void;
  canPresent: boolean;
  onDownloadFile?: () => void;
  fileActions?: ReactNode;
  /**
   * The homework or recap page is open. Slide tools do not apply to a page, so
   * the slide tabs say why they are empty instead of offering dead buttons.
   */
  aside?: 'homework' | 'recap' | null;
}

const SLIDE_TABS = ['home', 'slide', 'insert', 'ask', 'reveal'] as const;

function AsideReason() {
  return (
    <Row>
      <p className="self-center px-2 text-secondary text-muted-foreground">
        These tools work on slides. Select a slide in the rail to use them.
      </p>
    </Row>
  );
}

export function Ribbon(props: RibbonProps) {
  const { selected, groupCount, playIndex } = props;
  const noBlock = selected === null;
  const isBreakout = selected?.breakoutOf !== undefined;
  const together = selected?.reveal === 'together' || selected?.reveal === undefined;
  const shown = playIndex ?? groupCount;
  const noParts = noBlock || groupCount === 0;
  // A composition slide has only `blank` to claim, so its arrangement is chosen
  // by re-boxing the elements instead of by naming a layout.
  const elementLayouts = selected === null ? [] : elementLayoutsFor(selected);
  const allowed =
    selected === null || elementLayouts.length > 0
      ? []
      : LAYOUTS_FOR_KIND[selected.kind].slice(0, 3);
  const playLabel =
    playIndex === null ? 'Play' : playIndex >= groupCount ? 'Start again' : 'Next step';

  return (
    <Tabs
      value={props.tab}
      onValueChange={(next) => props.onTabChange(next as RibbonTab)}
      data-deck-ribbon=""
      className="flex shrink-0 flex-col"
    >
      <div className="flex h-8 items-end gap-0.5 bg-chrome px-3">
        <TabsList variant="ribbon" aria-label="Ribbon">
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="slide">Slide</TabsTrigger>
          <TabsTrigger value="insert">Insert</TabsTrigger>
          <TabsTrigger value="ask">Questions</TabsTrigger>
          <TabsTrigger value="reveal">Reveal</TabsTrigger>
          <TabsTrigger value="view">View</TabsTrigger>
        </TabsList>
        <span className="flex-1" />
        {props.cliOrigin === null ? null : (
          <PlanYamlChip deckId={props.deckId} origin={props.cliOrigin} currentVersion={props.currentVersion} />
        )}
      </div>

      <div className="border-b border-border bg-card">
        <TabsContent value="file" className="mt-0">
          <Row>
            <Group label="File">
              {props.fileActions ?? <Button
                type="button"
                variant="subtle"
                size="sm"
                disabled={props.onDownloadFile === undefined}
                onClick={props.onDownloadFile}
              >
                <Download aria-hidden="true" />
                Save a copy
              </Button>}
            </Group>
          </Row>
        </TabsContent>

        {props.aside ? (
          SLIDE_TABS.map((value) => (
            <TabsContent key={value} value={value} className="mt-0">
              <AsideReason />
            </TabsContent>
          ))
        ) : (
          <>
        <TabsContent value="home" className="mt-0">
          <Row>
            <Group label="Slides">
              <LargeButton label="New slide" onClick={props.onTemplates}>
                <LayoutTemplate className="size-5" aria-hidden="true" />
              </LargeButton>
              <div className="flex flex-col gap-px">
                <Button type="button" variant="subtle" size="sm" className="h-7" disabled={noBlock} onClick={props.onDuplicate}>
                  <Copy aria-hidden="true" />
                  Duplicate
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  className="h-7"
                  disabled={noBlock || !props.canDelete}
                  onClick={props.onDelete}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </Group>
            <Group label="PowerPoint">
              <Button type="button" variant="subtle" size="sm" disabled={!props.onCopyEmbed} onClick={props.onCopyEmbed}>
                <Copy aria-hidden="true" />Copy embed code
              </Button>
            </Group>
            <Rule />
            {elementLayouts.length === 0 ? null : (
              <>
                <Group label="Layout">
                  {elementLayouts.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      title={layout.label}
                      aria-label={layout.label}
                      onClick={() => props.onElementLayout(layout.id)}
                      className={cn(
                        'relative h-[38px] w-[60px] overflow-hidden rounded-md border border-border bg-card',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        'hover:border-primary',
                      )}
                    >
                      <ElementLayoutThumb slots={layout.slots} className="h-full" />
                    </button>
                  ))}
                </Group>
                <Rule />
              </>
            )}
            {allowed.length === 0 ? null : (
              <>
                <Group label="Layout">
                  {allowed.map((layout) => {
                    const active = selected !== null && resolvedStepLayout(selected) === layout;
                    return (
                      <button
                        key={layout}
                        type="button"
                        title={LAYOUT_WORDS[layout]}
                        aria-label={LAYOUT_WORDS[layout]}
                        aria-pressed={active}
                        onClick={() => props.onLayout(layout)}
                        className={cn(
                          'relative h-[38px] w-[60px] overflow-hidden rounded-md bg-card',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          active ? 'border-2 border-primary' : 'border border-border hover:border-primary',
                        )}
                      >
                        <LayoutThumb layout={layout} className="h-full" />
                      </button>
                    );
                  })}
                </Group>
                <Rule />
              </>
            )}
            {selected !== null && hasMinutes(selected) ? (
              <>
                <Group label="Timing">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="size-8 p-0"
                    aria-label="One minute less"
                    onClick={() => props.onMinutes(-1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <span className="min-w-[62px] text-center text-row-title tabular-nums">
                    {`${String(stepMinutes(selected) ?? 5)} min`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="size-8 p-0"
                    aria-label="One minute more"
                    onClick={() => props.onMinutes(1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </Group>
                <Rule />
              </>
            ) : null}
            <Group label="Reveal">
              <Segmented
                options={[
                  { id: 'together', label: 'All at once' },
                  { id: 'sequence', label: 'One at a time' },
                ]}
                value={together ? 'together' : 'sequence'}
                disabled={noParts}
                onChange={(id) => {
                  if (id === 'together') props.onRevealTogether();
                  else props.onRevealOneAtATime();
                }}
              />
              <Button type="button" variant="subtle" size="sm" disabled={noParts} onClick={props.onPlayNext}>
                <Play aria-hidden="true" />
                {playLabel}
              </Button>
            </Group>
            <Rule />
            <Group label="Insert">
              <LargeButton
                label="Text box"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddTextBox}
              >
                <Type className="size-5" aria-hidden="true" />
              </LargeButton>
              <LargeButton
                label="Picture"
                disabled={
                  noBlock ||
                  selected === null ||
                  (!kindCanCarryElements(selected.kind) && !kindCanCarryPicture(selected.kind))
                }
                onClick={props.onOpenPicture}
              >
                <ImageIcon className="size-5" aria-hidden="true" />
              </LargeButton>
              <LargeButton
                label="HTML"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddHtml}
              >
                <SquareCode className="size-5" aria-hidden="true" />
              </LargeButton>
              <LargeButton label="Ask" ask onClick={props.onOpenAsk}>
                <CircleHelp className="size-5" aria-hidden="true" />
              </LargeButton>
            </Group>
          </Row>
        </TabsContent>

        <TabsContent value="slide" className="mt-0">
          <Row wrap>
            {INSERT_CATALOG.map((group, index) => (
              <div key={group.group} className="flex">
                {index > 0 ? <Rule /> : null}
                <Group label={group.group}>
                  {/* Freeform inserts lead each group; the rule marks where
                      boxed compositions end and wired layouts begin. Each run
                      stacks two buttons per column, so the tab fits a laptop. */}
                  {starterRuns(group.items).map((run, runIndex, runs) => (
                    <Fragment key={run[0]!.kind}>
                      {runIndex > 0 ? <Rule /> : null}
                      <div className="grid grid-flow-col grid-rows-2 gap-x-1 gap-y-px">
                        {run.map((item) => {
                          const Icon = INSERT_ICONS[item.kind];
                          return (
                            <Button
                              key={item.kind}
                              type="button"
                              size="sm"
                              variant="subtle"
                              className="h-7 justify-start"
                              disabled={noBlock}
                              onClick={() => {
                                if (item.kind === 'question') props.onOpenAsk();
                                else props.onInsert(item.kind);
                              }}
                            >
                              <Icon aria-hidden="true" />
                              {item.label}
                            </Button>
                          );
                        })}
                        {/* Breakout fills the free slot under Break. */}
                        {group.group === 'Classroom' && run === runs[runs.length - 1] ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="subtle"
                            className="h-7 justify-start"
                            disabled={noBlock || isBreakout}
                            onClick={() => props.onInsert('statement', { asBreakout: true })}
                          >
                            <UsersRound aria-hidden="true" />
                            Breakout
                          </Button>
                        ) : null}
                      </div>
                    </Fragment>
                  ))}
                </Group>
              </div>
            ))}
          </Row>
        </TabsContent>

        <TabsContent value="insert" className="mt-0">
          <Row>
            <Group label="Text & pictures">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddTextBox}
              >
                <Type aria-hidden="true" />
                Text box
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={
                  noBlock ||
                  selected === null ||
                  (!kindCanCarryElements(selected.kind) && !kindCanCarryPicture(selected.kind))
                }
                onClick={props.onOpenPicture}
              >
                <ImageIcon aria-hidden="true" />
                Picture
              </Button>
            </Group>
            <Rule />
            <Group label="Web & documents">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddHtml}
              >
                <SquareCode aria-hidden="true" />
                HTML
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddIframe}
              >
                <Globe2 aria-hidden="true" />
                Web page
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddPdf}
              >
                <FileText aria-hidden="true" />
                PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || selected === null || !kindCanCarryElements(selected.kind)}
                onClick={props.onAddMarkdown}
              >
                <ScrollText aria-hidden="true" />
                Reading
              </Button>
            </Group>
          </Row>
        </TabsContent>

        <TabsContent value="ask" className="mt-0">
          <Row>
            <Group label="Questions">
              <LargeButton label="Question" ask onClick={props.onOpenAsk}>
                <CircleHelp className="size-5" aria-hidden="true" />
              </LargeButton>
              <div className="flex flex-col gap-px">
                <Button type="button" variant="subtle" size="sm" className="h-7" onClick={() => props.onInsert('fill-the-gaps')}>
                  <TextCursorInput aria-hidden="true" />
                  Fill the gaps
                </Button>
                <Button type="button" variant="subtle" size="sm" className="h-7" onClick={() => props.onInsert('match')}>
                  <Shuffle aria-hidden="true" />
                  Match
                </Button>
              </div>
            </Group>
            <Rule />
            <Group label="Classroom">
              {INSERT_CATALOG.find((group) => group.group === 'Classroom')?.items.map((item) => {
                const Icon = INSERT_ICONS[item.kind];
                return (
                  <Button
                    key={item.kind}
                    type="button"
                    size="sm"
                    variant="subtle"
                    disabled={noBlock}
                    onClick={() => props.onInsert(item.kind)}
                  >
                    <Icon aria-hidden="true" />
                    {item.label}
                  </Button>
                );
              })}
            </Group>
            <Rule />
            <Group label="Session">
              <p className="max-w-56 text-caption text-muted-foreground">
                The join code appears when you start the session.
              </p>
            </Group>
          </Row>
        </TabsContent>

        <TabsContent value="reveal" className="mt-0">
          <Row>
            <Group label="Mode">
              <Segmented
                options={[
                  { id: 'together', label: 'All at once' },
                  { id: 'sequence', label: 'One at a time' },
                ]}
                value={together ? 'together' : 'sequence'}
                disabled={noParts}
                onChange={(id) => {
                  if (id === 'together') props.onRevealTogether();
                  else props.onRevealOneAtATime();
                }}
              />
            </Group>
            <Rule />
            <Group label="Playback">
              <Button type="button" size="sm" variant="subtle" disabled={noParts} onClick={props.onPlayNext}>
                <Play aria-hidden="true" />
                {playIndex === null ? 'Play reveal' : playIndex >= groupCount ? 'Start again' : 'Next step'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noParts || playIndex === null}
                onClick={props.onPlayAll}
              >
                <Eye aria-hidden="true" />
                Show all
              </Button>
              <span className="text-secondary text-muted-foreground" role="status">
                {groupCount === 0
                  ? 'Nothing to reveal'
                  : `Step ${String(Math.min(shown, groupCount))} of ${String(groupCount)}`}
              </span>
            </Group>
            <Rule />
            <Group label="Order">
              <Button type="button" size="sm" variant="subtle" disabled={noParts} onClick={props.onEditOrder}>
                <ArrowUpDown aria-hidden="true" />
                Edit order
              </Button>
            </Group>
          </Row>
        </TabsContent>
          </>
        )}

        <TabsContent value="view" className="mt-0">
          <Row>
            <Group label="Present">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={!props.canPresent || noBlock}
                onClick={props.onPresentFrom}
              >
                <MonitorPlay aria-hidden="true" />
                Start from here
              </Button>
            </Group>
          </Row>
        </TabsContent>
      </div>
    </Tabs>
  );
}

function PlanYamlChip({ deckId, origin, currentVersion }: { deckId: string; origin: string; currentVersion: number }) {
  const [copied, setCopied] = useState<string | null>(null);
  const commands = [
    { label: `Read the deck into ${PLAN_FILE}`, line: deckGetCommand(deckId, origin) },
    { label: `Check ${PLAN_FILE}`, line: outlineValidateCommand() },
    { label: `Save ${PLAN_FILE} as a new version`, line: deckSaveCommand(deckId, currentVersion, origin) },
    { label: 'Start a session', line: deckStartCommand(deckId, origin) },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="plan.yaml"
          className="mb-0 inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-muted-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {PLAN_FILE}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[26rem]">
        <DropdownMenuLabel className="text-caption font-normal">
          Copy a command. Set OPENROOM_TOKEN to a personal token from Settings first.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {commands.map((command) => (
          <DropdownMenuItem
            key={command.label}
            className="flex-col items-start gap-0.5"
            onSelect={(event) => {
              // Stay open so the item can say it was copied.
              event.preventDefault();
              void navigator.clipboard.writeText(command.line);
              setCopied(command.line);
              window.setTimeout(() => setCopied((current) => (current === command.line ? null : current)), 1500);
            }}
          >
            <span className="text-secondary">{copied === command.line ? 'Copied' : command.label}</span>
            <code className="break-all font-mono text-caption text-muted-foreground">{command.line}</code>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="grid gap-0.5 text-caption font-normal">
          <span>MCP tools for the same steps</span>
          <code className="break-all font-mono">{deckToolLine(currentVersion)}</code>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
