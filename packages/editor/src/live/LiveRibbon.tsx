import type { ReactNode } from 'react';
import {
  INK_COLORS,
  MARK_SHAPES,
  MARK_SHAPE_LABELS,
  type InkColor,
  type MarkShape,
} from '@openroom/sdk';

import { Button } from '@openroom/ui/components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@openroom/ui/components/tabs';
import { cn } from '@openroom/ui/utils';

const INK_SWATCH: Record<InkColor, string> = {
  red: 'bg-destructive',
  yellow: 'bg-chart-3',
  green: 'bg-chart-2',
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
  return <span aria-hidden="true" className="my-1.5 w-px shrink-0 bg-hairline" />;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[76px] items-stretch overflow-x-auto px-2 py-2 pb-1.5">{children}</div>;
}

function Large({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-[60px] w-14 flex-col items-center justify-center gap-1 rounded-lg text-caption text-foreground hover:bg-chrome disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export interface LiveRibbonProps {
  tab: string;
  onTabChange: (tab: string) => void;
  canBack: boolean;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
  canChangeSlide: boolean;
  onChangeSlide: () => void;
  canClose: boolean;
  onClose: () => void;
  resultsUp: boolean;
  canRevote: boolean;
  onRevote: () => void;
  canUndoRevote: boolean;
  onUndoRevote: () => void;
  currentDisplayLabel: string | null;
  onOpenChartMenu: (anchor: HTMLElement) => void;
  correctShown: boolean;
  hasCorrect?: boolean;
  canReveal: boolean;
  onReveal: () => void;
  canBlank: boolean;
  blanked: boolean;
  onBlank: () => void;
  canInsert: boolean;
  onInsert: (kind: 'term' | 'statement' | 'question' | 'library') => void;
  drawTool: 'none' | MarkShape | 'pen';
  onDrawTool: (tool: 'none' | MarkShape | 'pen') => void;
  inkColor: InkColor;
  onInkColor: (color: InkColor) => void;
  onClearMarks: () => void;
  /** The launcher armed the next word click; the card opens itself on the hit. */
  lookUpArmed: boolean;
  onLookUp: () => void;
  /** There is a last lookup to bring back. */
  canReopenCard: boolean;
  onReopenCard: () => void;
  /** Present only while a clock is on this slide. */
  clock: { label: string; running: boolean } | null;
  onClockStart: () => void;
  onClockPause: () => void;
  onClockReset: () => void;
  onClockAdjust: (seconds: number) => void;
  onPresenterView?: () => void;
}

export function LiveRibbon(props: LiveRibbonProps) {
  return (
    <Tabs value={props.tab} onValueChange={props.onTabChange} className="shrink-0 bg-chrome">
      <div className="flex items-end justify-between gap-2 bg-chrome px-3">
        <TabsList variant="ribbon">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="insert">Insert</TabsTrigger>
          <TabsTrigger value="draw">Draw</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>
        {props.onPresenterView ? (
          <button
            type="button"
            onClick={props.onPresenterView}
            className="mb-0 inline-flex h-8 items-center rounded-lg px-2.5 text-caption text-muted-foreground hover:bg-background"
          >
            Presenter view
          </button>
        ) : null}
      </div>

      <TabsContent value="home" className="mt-0 border-b border-border bg-card">
        <Row>
          <Group label="Slides">
            <Large label="Back" disabled={!props.canBack} onClick={props.onBack}>
              <span aria-hidden="true" className="text-option">
                ←
              </span>
            </Large>
            <Large label="Next" disabled={!props.canNext} onClick={props.onNext}>
              <span aria-hidden="true" className="text-option">
                →
              </span>
            </Large>
            {props.canChangeSlide ? (
              <Button type="button" variant="subtle" size="sm" onClick={props.onChangeSlide}>
                Edit slide
              </Button>
            ) : null}
          </Group>
          <Rule />
          <Group label="Answers">
            <Button type="button" variant="outline" size="sm" disabled={!props.canClose} onClick={props.onClose}>
              Close answering
            </Button>
            {props.resultsUp ? (
              <span className="inline-flex h-8 items-center rounded-md bg-live-tint px-3 text-sm font-semibold text-live-tint-foreground">
                Results shown
              </span>
            ) : null}
            <Button type="button" variant="subtle" size="sm" disabled={!props.canRevote} onClick={props.onRevote}>
              Second vote
            </Button>
            {props.canUndoRevote ? (
              <Button type="button" variant="subtle" size="sm" onClick={props.onUndoRevote}>
                Back to first vote
              </Button>
            ) : null}
          </Group>
          <Rule />
          <Group label="Results">
            {props.currentDisplayLabel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Or right-click the chart"
                onClick={(event) => props.onOpenChartMenu(event.currentTarget)}
              >
                Drawn as {props.currentDisplayLabel.toLowerCase()}
                <span aria-hidden="true" className="text-caption text-muted-foreground">
                  ▾
                </span>
              </Button>
            ) : null}
            {props.correctShown ? (
              <span className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-sm font-semibold text-accent-foreground">
                ✓ {props.hasCorrect ? 'Correct answer shown' : 'Results shown'}
              </span>
            ) : props.canReveal ? (
              <Button type="button" variant="subtle" size="sm" onClick={props.onReveal}>
                {props.hasCorrect ? 'Call out the correct answer' : 'Reveal results'}
              </Button>
            ) : null}
          </Group>
          <Rule />
          <Group label="Screen">
            <Large label="Blank" disabled={!props.canBlank} onClick={props.onBlank}>
              <span
                aria-hidden="true"
                className={cn('block h-4 w-6 rounded-sm', props.blanked ? 'bg-muted-foreground' : 'bg-foreground')}
              />
            </Large>
          </Group>
          {props.clock ? (
            <>
              <Rule />
              <Group label="Clock">
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  disabled={props.clock.running}
                  onClick={props.onClockStart}
                >
                  Start
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  disabled={!props.clock.running}
                  onClick={props.onClockPause}
                >
                  Pause
                </Button>
                <Button type="button" variant="subtle" size="sm" onClick={props.onClockReset}>
                  Reset
                </Button>
                <Button type="button" variant="subtle" size="icon" aria-label="Minus one minute" onClick={() => props.onClockAdjust(-60)}>
                  −
                </Button>
                <span
                  className={cn(
                    'min-w-[3.25rem] text-center text-section tabular-nums',
                    props.clock.running ? 'text-live' : 'text-muted-foreground',
                  )}
                >
                  {props.clock.label}
                </span>
                <Button type="button" variant="subtle" size="icon" aria-label="Plus one minute" onClick={() => props.onClockAdjust(60)}>
                  +
                </Button>
              </Group>
            </>
          ) : null}
        </Row>
      </TabsContent>

      <TabsContent value="insert" className="mt-0 border-b border-border bg-card">
        <Row>
          <Group label="Slide">
            <Button type="button" variant="subtle" disabled={!props.canInsert} onClick={() => props.onInsert('term')}>
              Term
            </Button>
            <Button
              type="button"
              variant="subtle"
              disabled={!props.canInsert}
              onClick={() => props.onInsert('statement')}
            >
              Statement
            </Button>
            <Button
              type="button"
              variant="subtle"
              disabled={!props.canInsert}
              onClick={() => props.onInsert('question')}
            >
              Question
            </Button>
          </Group>
          <Rule />
          <Group label="Library">
            <Button
              type="button"
              variant="subtle"
              disabled={!props.canInsert}
              onClick={() => props.onInsert('library')}
            >
              From library
            </Button>
          </Group>
          <Rule />
          <Group label="This slide">
            <Button type="button" variant="subtle" disabled={!props.canChangeSlide} onClick={props.onChangeSlide}>
              Change
            </Button>
          </Group>
        </Row>
      </TabsContent>

      <TabsContent value="draw" className="mt-0 border-b border-border bg-card">
        <Row>
          <Group label="Ink">
            {MARK_SHAPES.map((shape) => (
              <Button
                key={shape}
                type="button"
                variant="subtle"
                aria-pressed={props.drawTool === shape}
                className={cn(
                  props.drawTool === shape && 'bg-live-tint font-semibold text-live-tint-foreground hover:bg-live-tint',
                )}
                onClick={() => props.onDrawTool(props.drawTool === shape ? 'none' : shape)}
              >
                {MARK_SHAPE_LABELS[shape]}
              </Button>
            ))}
            <Button
              type="button"
              variant="subtle"
              aria-pressed={props.drawTool === 'pen'}
              className={cn(
                props.drawTool === 'pen' && 'bg-live-tint font-semibold text-live-tint-foreground hover:bg-live-tint',
              )}
              onClick={() => props.onDrawTool(props.drawTool === 'pen' ? 'none' : 'pen')}
            >
              Pen
            </Button>
            <Button
              type="button"
              variant="subtle"
              className="text-destructive hover:bg-[color-mix(in_oklab,var(--destructive)_8%,var(--card))]"
              onClick={props.onClearMarks}
            >
              Clear
            </Button>
          </Group>
          <Rule />
          <Group label="Colour">
            {INK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={props.inkColor === color}
                onClick={() => props.onInkColor(color)}
                className={cn(
                  'size-7 rounded-md',
                  INK_SWATCH[color],
                  props.inkColor === color && 'outline outline-2 outline-offset-2 outline-foreground',
                )}
              />
            ))}
          </Group>
          <Rule />
          <Group label="Meaning">
            <Button type="button" variant={props.lookUpArmed ? 'outline' : 'subtle'} onClick={props.onLookUp}>
              {props.lookUpArmed ? 'Picking word…' : 'Look up a word'}
            </Button>
            <Button
              type="button"
              variant="subtle"
              disabled={!props.canReopenCard}
              onClick={props.onReopenCard}
            >
              Reopen card
            </Button>
          </Group>
        </Row>
      </TabsContent>

      <TabsContent value="review" className="mt-0 border-b border-border bg-card">
        <Row>
          <Group label="Meaning">
            <Button type="button" variant={props.lookUpArmed ? 'outline' : 'subtle'} onClick={props.onLookUp}>
              {props.lookUpArmed ? 'Picking word…' : 'Look up a word'}
            </Button>
            <Button
              type="button"
              variant="subtle"
              disabled={!props.canReopenCard}
              onClick={props.onReopenCard}
            >
              Reopen card
            </Button>
          </Group>
        </Row>
      </TabsContent>
    </Tabs>
  );
}
