/**
 * Theme & branding studio.
 *
 * The console's most sellable surface: five built-in themes x light/dark, each
 * previewed in its OWN tokens, plus the Pro branding slots shown as a real
 * (disabled) feature rather than a marketing promise.
 *
 * In a live session the picker is not a personal preference — it posts
 * `session.theme`, and the stage and every participant device restyle with it.
 */
import * as React from 'react';
import { Check, Palette, Lock, Sparkles } from 'lucide-react';
import type { ThemeId, ThemeMode } from './index.js';
import { getTheme } from './index.js';
import {
  previewStyle,
  swatchColors,
  THEME_CHOICES,
  useTheme,
  type ModeSetting,
} from './theme-provider.js';
import { cn } from './utils.js';
import { Badge } from './components/badge.js';
import { Button } from './components/button.js';
import { Alert, AlertDescription } from './components/alert.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/dialog.js';
import { Label } from './components/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/select.js';
import { Separator } from './components/separator.js';
import { Switch } from './components/switch.js';

/** A miniature of the product rendered entirely in another theme's tokens. */
function ThemePreview({ themeId, mode }: { themeId: ThemeId; mode: ThemeMode }) {
  const bars = ['--chart-1', '--chart-2', '--chart-3'];
  const widths = ['78%', '52%', '31%'];
  return (
    <div
      style={previewStyle(themeId, mode)}
      className="pointer-events-none select-none rounded-md border p-2.5"
      aria-hidden="true"
    >
      <div
        className="rounded-md p-2"
        style={{ background: 'var(--card)', color: 'var(--card-foreground)' }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.65rem] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            Which gas?
          </span>
          <span
            className="rounded px-1 py-px text-[0.55rem]"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            open
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {bars.map((token, i) => (
            <div
              key={token}
              className="h-1.5 w-full overflow-hidden"
              style={{ background: 'var(--muted)' }}
            >
              <div
                className="h-full"
                style={{ width: widths[i], background: `var(${token})` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Swatches({ themeId, mode }: { themeId: ThemeId; mode: ThemeMode }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {swatchColors(themeId, mode).map((color, i) => (
        <span
          key={`${color}-${i}`}
          className="size-3.5 border border-border"
          style={{ background: color }}
        />
      ))}
    </div>
  );
}

export interface ThemeStudioProps {
  /**
   * Live-session mode: the session's current theme plus the sender. When absent the
   * picker only changes this console (setup screen).
   */
  sessionThemeId?: ThemeId | null;
  onPickSessionTheme?: ((id: ThemeId) => void) | undefined;
  pendingThemeId?: ThemeId | null;
  /** Rendered as the dialog trigger. Omit when controlling `open` externally. */
  trigger?: React.ReactNode;
  /** Controlled mode (e.g. opened from a menu item instead of a trigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ThemeStudio({
  sessionThemeId = null,
  onPickSessionTheme,
  pendingThemeId = null,
  trigger,
  open,
  onOpenChange,
}: ThemeStudioProps) {
  const theme = useTheme();
  const live = typeof onPickSessionTheme === 'function';
  const current = sessionThemeId ?? theme.preferredThemeId;

  const pick = (id: ThemeId) => {
    theme.setPreferredThemeId(id);
    if (onPickSessionTheme) onPickSessionTheme(id);
  };

  const controlled = open !== undefined;
  return (
    <Dialog {...(controlled ? { open, onOpenChange } : {})}>
      {controlled ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm">
              <Palette aria-hidden="true" />
              Theme
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent aria-label="Theme and branding" className="flex max-h-[calc(100svh-3rem)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle>Theme &amp; branding</DialogTitle>
          <DialogDescription>
            {live
              ? 'Applies to the projector and participant screens.'
              : 'Applies to this console. In a running session it applies to every surface.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 px-5 py-4">
        {live ? (
          <Alert variant="info">
            <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>
                Live for every surface. Currently{' '}
                <strong>{getTheme(current).name}</strong>.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-mode">Appearance</Label>
            <Select
              value={theme.modeSetting}
              onValueChange={(value) => theme.setModeSetting(value as ModeSetting)}
            >
              <SelectTrigger id="theme-mode" className="w-44" aria-label="Light or dark appearance">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">Match system</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Light/dark is per device: a teacher can run a dark console while the projector stays
            bright.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Session theme"
          className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
        >
          {THEME_CHOICES.map((t) => {
            const selected = t.id === current;
            const pending = pendingThemeId === t.id && !selected;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(t.id)}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent',
                )}
              >
                <ThemePreview themeId={t.id} mode={theme.mode} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  {selected ? (
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                  ) : pending ? (
                    <span className="text-[0.65rem] text-muted-foreground">applying…</span>
                  ) : null}
                </div>
                <Swatches themeId={t.id} mode={theme.mode} />
                <span className="text-xs leading-snug text-muted-foreground">{t.description}</span>
              </button>
            );
          })}
        </div>

        <Separator />

        <BrandingCard themeId={current} mode={theme.mode} />
        </DialogBody>

        <DialogFooter className="-mx-0 -mb-0">
          {live ? null : (
            <p className="mr-auto text-xs text-muted-foreground">Saved on this device.</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Pro branding slots. Deliberately real-looking and deliberately inert:
 * branding is a constrained token override (PRD SCHOOL-07), so what ships later
 * is exactly these two knobs — `--brand-accent` and `--brand-logo`.
 */
export function BrandingCard({ themeId, mode }: { themeId: ThemeId; mode: ThemeMode }) {
  const accent = getTheme(themeId)[mode]['chart-1'];
  return (
    <section
      aria-labelledby="branding-heading"
      className="rounded-lg border border-dashed border-border p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 id="branding-heading" className="font-display text-sm font-semibold">
          School branding
        </h3>
        <Badge variant="accent" className="gap-1">
          <Lock className="size-3" aria-hidden="true" />
          Pro · coming soon
        </Badge>
      </div>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
        The accent colour and logo apply to the projector and every participant screen.
        Colours are checked against WCAG AA before use.
      </p>

      <div className="grid gap-3 md:grid-cols-[1fr_minmax(12rem,16rem)]">
        <fieldset disabled className="flex flex-col gap-3 opacity-70">
          <legend className="sr-only">Branding settings (unavailable on this deck)</legend>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-accent">Accent colour</Label>
            <div className="flex items-center gap-2">
              <span
                id="brand-accent"
                className="size-8 shrink-0 rounded-md border border-border"
                style={{ background: accent }}
                aria-hidden="true"
              />
              <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {accent}
              </code>
              <span className="text-xs text-muted-foreground">contrast AA ✓</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-logo">Logo</Label>
            <div
              id="brand-logo"
              className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
            >
              Drop a PNG or SVG (shown on the stage and the join screen)
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="brand-apply" className="text-xs font-normal text-muted-foreground">
              Apply branding to participant screens
            </Label>
            <Switch id="brand-apply" checked aria-readonly />
          </div>
        </fieldset>

        <div
          style={previewStyle(themeId, mode)}
          className="rounded-md border p-3"
          aria-label="Branding preview"
        >
          <div
            className="rounded-md p-3"
            style={{ background: 'var(--card)', color: 'var(--card-foreground)' }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="grid size-6 place-items-center rounded text-[0.6rem] font-semibold"
                style={{ background: accent, color: 'var(--card)' }}
              >
                LOGO
              </span>
              <span className="text-xs font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                Northfield High
              </span>
            </div>
            <div className="mb-2 h-1.5 w-full" style={{ background: accent }} />
            <span
              className="inline-block rounded px-2 py-1 text-[0.65rem]"
              style={{ background: accent, color: 'var(--card)' }}
            >
              Join at join.openroom.app
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
