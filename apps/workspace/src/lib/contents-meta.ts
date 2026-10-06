/**
 * What is *in* a deck file, as a row or pane line.
 * Never a date, never a taught-count.
 */
export interface DeckContentsMeta {
  slides: number;
  askTheClass: number;
  homework: boolean;
  recap: boolean;
  minutes: number | null;
}

export function emptyContents(): DeckContentsMeta {
  return { slides: 0, askTheClass: 0, homework: false, recap: false, minutes: null };
}

/** `6 slides · 2 ask the class · homework` */
export function formatContentsMeta(contents: DeckContentsMeta | null | undefined): string {
  if (!contents) return '';
  const parts: string[] = [];
  if (contents.slides > 0) {
    parts.push(`${contents.slides} ${contents.slides === 1 ? 'slide' : 'slides'}`);
  }
  if (contents.askTheClass > 0) {
    parts.push(
      contents.askTheClass === 1 ? '1 ask the class' : `${contents.askTheClass} ask the class`,
    );
  }
  if (contents.minutes != null && contents.minutes > 0) {
    parts.push(`${contents.minutes} min`);
  }
  if (contents.homework) parts.push('homework');
  return parts.join(' · ');
}

export function slidesLine(contents: DeckContentsMeta | null | undefined): string {
  if (!contents || contents.slides <= 0) return 'Not written yet';
  const slides = `${contents.slides} ${contents.slides === 1 ? 'slide' : 'slides'}`;
  if (contents.minutes != null && contents.minutes > 0) return `${slides} · ${contents.minutes} min`;
  return slides;
}

export function summarizeOutline(outline: {
  steps?: readonly { kind?: string }[];
  homework?: unknown;
  recap?: unknown;
  meta?: { durationMinutes?: number };
} | null | undefined): DeckContentsMeta {
  if (!outline) return emptyContents();
  const steps = outline.steps ?? [];
  const minutes = outline.meta?.durationMinutes;
  return {
    slides: steps.length,
    askTheClass: steps.filter((step) => step.kind === 'interaction').length,
    homework: outline.homework != null,
    recap: outline.recap != null,
    minutes: typeof minutes === 'number' && minutes > 0 ? minutes : null,
  };
}

export function homeworkLine(homework: { title?: string; body?: string; items?: string[]; tasks?: unknown[] } | null | undefined): string {
  if (!homework) return 'Not written';
  if (homework.tasks && homework.tasks.length > 0) {
    const n = homework.tasks.length;
    return n === 1 ? 'One task · sent when the session ends' : `${n} tasks · sent when the session ends`;
  }
  if (homework.items && homework.items.length > 0) {
    const n = homework.items.length;
    return `${n} ${n === 1 ? 'item' : 'items'} · sent when the session ends`;
  }
  if (homework.body?.trim()) return 'Sent when the session ends';
  if (homework.title?.trim()) return homework.title.trim();
  return 'Sent when the session ends';
}

export function recapLine(recap: { title?: string; body?: string; items?: string[] } | null | undefined): string {
  if (!recap) return 'Not written';
  if (recap.title?.trim()) return recap.title.trim();
  if (recap.body?.trim() || (recap.items && recap.items.length > 0)) return 'Written';
  return 'Not written';
}
