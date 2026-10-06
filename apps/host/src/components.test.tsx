/**
 * Component behaviour tests via `react-dom/server` (no jsdom in this workspace).
 *
 * Assert derived behaviour and structure — not shadcn wiring or prop echo.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsPreview } from './Results';
import { QuestionRailFooter } from './QuestionRailFooter';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { DialogFooter } from './components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';

describe('component rendering', () => {
  it('live peer-instruction shows current-round bars only (dead-simple default)', () => {
    const html = renderToStaticMarkup(
      <ResultsPreview
        aggregate={{ kind: 'choice', counts: { a: 3, b: 1 }, total: 4, dontKnow: 0 }}
        options={[
          { id: 'a', label: 'Oxygen', correct: true },
          { id: 'b', label: 'Nitrogen' },
        ]}
        round1Aggregate={{ kind: 'choice', counts: { a: 1, b: 3 }, total: 4, dontKnow: 0 }}
      />,
    );
    expect(html).toContain('data-or-chart="bars"');
    expect(html).not.toContain('data-or-chart="peer"');
  });

  it('after reveal, peer-instruction shows was→now shift', () => {
    const html = renderToStaticMarkup(
      <ResultsPreview
        compareRounds
        aggregate={{ kind: 'choice', counts: { a: 3, b: 1 }, total: 4, dontKnow: 0 }}
        options={[
          { id: 'a', label: 'Oxygen', correct: true },
          { id: 'b', label: 'Nitrogen' },
        ]}
        round1Aggregate={{ kind: 'choice', counts: { a: 1, b: 3 }, total: 4, dontKnow: 0 }}
      />,
    );
    expect(html).toContain('data-or-chart="peer"');
    expect(html).toContain('25% →');
    expect(html).toContain('75%');
  });

  it('renders the ranking aggregate with Borda points', () => {
    const html = renderToStaticMarkup(
      <ResultsPreview
        interactionType="ranking"
        aggregate={{
          kind: 'ranking',
          scores: { a: 7, b: 5 },
          avgRank: { a: 1.25, b: 1.75 },
          total: 4,
          dontKnow: 1,
        }}
        options={[
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ]}
      />,
    );
    expect(html).toContain('7 points');
    expect(html).toContain('average rank 1.3');
    expect(html).toContain('data-or-chart="ordered-bars"');
  });

  it('still renders live results when audienceVisible is false (host must see the stage)', () => {
    const html = renderToStaticMarkup(
      <ResultsPreview
        audienceVisible={false}
        aggregate={{ kind: 'choice', counts: { a: 2, b: 1 }, total: 3, dontKnow: 0 }}
        options={[
          { id: 'a', label: 'Yes' },
          { id: 'b', label: 'No' },
        ]}
      />,
    );
    expect(html).toContain('data-or-chart="bars"');
    expect(html).not.toContain('Results are hidden from the session');
  });

  it('renders question rail footer with one selected tab per question set', () => {
    const html = renderToStaticMarkup(
      <QuestionRailFooter
        items={[
          { id: 'q1', label: 'First', visited: true },
          { id: 'q2', label: 'Second' },
          { id: 'q3', label: 'Third' },
        ]}
        activeId="q2"
        selectedId="q1"
        selectedIndex={0}
        onPrev={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)?.length).toBe(3);
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/disabled[^>]*>[\s\S]*← Back|← Back[\s\S]*disabled/);
  });
});

/**
 * The component layer carries the design decisions the screens rely on: live
 * orange is a token role, a ribbon tab is a folder tab that joins its card,
 * a dialog dims the surface behind it, and cards keep the same corner. These
 * assert the roles resolve — not that shadcn was wired up.
 */
describe('component layer', () => {
  it('gives the subtle button no chrome until hover and the live button the live role', () => {
    const subtle = renderToStaticMarkup(<Button variant="subtle">Rename</Button>);
    expect(subtle).toContain('hover:bg-chrome');
    expect(subtle).not.toContain('bg-primary');
    // A subtle button is still a button, not a link.
    expect(subtle).toContain('type="button"');

    const live = renderToStaticMarkup(<Button variant="live">Start</Button>);
    expect(live).toContain('bg-live');
    expect(live).toContain('text-live-foreground');
    expect(live).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('seats the active ribbon tab on the card it opens', () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="alpha">
        <TabsList variant="ribbon">
          <TabsTrigger value="alpha">Alpha</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(html).toContain('data-[state=active]:bg-card');
    // The folder-tab shape: rounded at the top, square where it meets the card.
    expect(html).toContain('data-[state=active]:rounded-b-none');
    expect(html).toContain('data-[state=active]:rounded-t-lg');
    // One tab is open, and the strip sits on chrome.
    expect(html.match(/data-state="active"/g)?.length).toBe(1);
    expect(html).toContain('bg-chrome');
  });

  it('rails the dialog footer off the card edge above the page ground', () => {
    const html = renderToStaticMarkup(
      <DialogFooter>
        <span>3 questions</span>
        <Button>Save</Button>
      </DialogFooter>,
    );
    expect(html).toContain('border-t border-hairline');
    expect(html).toContain('bg-background');
    expect(html).toContain('justify-end');
    // Bleeds to the dialog's own padding rather than floating inside it.
    expect(html).toContain('-mx-5');
  });

  it('tints the live badge instead of shouting it, and rounds it', () => {
    const html = renderToStaticMarkup(<Badge variant="live">Live</Badge>);
    expect(html).toContain('bg-live-tint');
    expect(html).toContain('text-live-tint-foreground');
    expect(html).toContain('rounded-full');
  });

  it('keeps one card corner token rather than a literal radius', () => {
    const html = renderToStaticMarkup(<Card>Card</Card>);
    expect(html).toContain('rounded-[var(--radius-xl)]');
    expect(html).toContain('border-border');
    expect(html).toContain('data-theme-surface');
  });
});
