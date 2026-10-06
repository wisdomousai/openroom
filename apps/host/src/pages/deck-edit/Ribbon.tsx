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
import { PLAN_FILE, deckGetCommand, outlineValidateCommand } from './agent-commands';
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
    <div className="flex flex-none flex-col items-center justify-between gap-1 px-3.5">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

function Rule() {
  return <span aria-hidden="true" className="my-1.5 w-px shrink-0 self-stretch bg-hairline" />;
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[76px] items-stretch overflow-x-auto px-2 py-2 pb-1.5">{children}</div>
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
        <TabsList variant="ribbon">
          <TabsTrigger value="file">File</TabsTrigger>
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="slide">Slide</TabsTrigger>
          <TabsTrigger value="insert">Insert</TabsTrigger>
          <TabsTrigger value="ask">Questions</TabsTrigger>
          <TabsTrigger value="reveal">Reveal</TabsTrigger>
          <TabsTrigger value="view">View</TabsTrigger>
        </TabsList>
        <span className="flex-1" />
        <PlanYamlChip deckId={props.deckId} />
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
                    const active = selected?.layout === layout;
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
          <Row>
            {INSERT_CATALOG.map((group, index) => (
              <div key={group.group} className="flex">
                {index > 0 ? <Rule /> : null}
                <Group label={group.group}>
                  {group.items.map((item, itemIndex) => {
                    const Icon = INSERT_ICONS[item.kind];
                    // Freeform inserts lead each group; the rule marks where
                    // boxed compositions end and wired layouts begin.
                    const previous = group.items[itemIndex - 1];
                    return (
                      <Fragment key={item.kind}>
                      {previous !== undefined && previous.starter !== item.starter ? <Rule /> : null}
                      <Button
                        key={item.kind}
                        type="button"
                        size="sm"
                        variant="subtle"
                        disabled={noBlock}
                        onClick={() => {
                          if (item.kind === 'question') props.onOpenAsk();
                          else props.onInsert(item.kind);
                        }}
                      >
                        <Icon aria-hidden="true" />
                        {item.label}
                      </Button>
                      </Fragment>
                    );
                  })}
                </Group>
              </div>
            ))}
            <Rule />
            <Group label="Breakout">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={noBlock || isBreakout}
                onClick={() => props.onInsert('statement', { asBreakout: true })}
              >
                <UsersRound aria-hidden="true" />
                Breakout
              </Button>
            </Group>
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

function PlanYamlChip({ deckId }: { deckId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="deck.yaml"
          className="mb-0 inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-muted-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {PLAN_FILE}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Open YAML</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(deckGetCommand(deckId));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : `Copy ${deckGetCommand(deckId)}`}
        </DropdownMenuItem>
        <DropdownMenuItem disabled>{outlineValidateCommand()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
