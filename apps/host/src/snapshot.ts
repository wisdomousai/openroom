/**
 * Accessors that normalise the host snapshot.
 *
 * docs/CONTRACTS.md describes the host snapshot as "everything" (the session
 * document, notes, per-interaction status/aggregate) while @openroom/sdk
 * declares a flatter shape (an array of per-interaction summaries plus the
 * ACTIVE interaction's view and aggregate). Both are supported; where the
 * snapshot is thin we fall back to the locally stored session document.
 */
import type {
  Aggregate,
  HostInteractionRuntime,
  HostInteractionSummary,
  HostSnapshot,
  Interaction,
  InteractionStatus,
  InteractionType,
  Session,
} from './types';

export interface RailItem {
  id: string;
  type: InteractionType;
  prompt: string;
  status: InteractionStatus;
  answered: number;
  notes?: string;
}

function summaries(snapshot: HostSnapshot | null): HostInteractionSummary[] | null {
  const list = snapshot?.interactions;
  return Array.isArray(list) ? list : null;
}

function record(snapshot: HostSnapshot | null): Record<string, HostInteractionRuntime> | null {
  const list = snapshot?.interactions;
  if (!list || Array.isArray(list)) return null;
  return list;
}

export function sessionOf(snapshot: HostSnapshot | null, fallback?: Session): Session | null {
  const content = snapshot?.outline?.content;
  if (content?.interactions) {
    return {
      version: 1,
      meta: { title: content.meta?.title ?? '' },
      ...(content.defaults === undefined ? {} : { defaults: content.defaults }),
      ...(content.qna === undefined ? {} : { qna: content.qna }),
      interactions: content.interactions,
    } as Session;
  }
  return fallback ?? null;
}

export function sessionInteraction(session: Session | null, id: string | null): Interaction | null {
  if (!session || !id) return null;
  return session.interactions.find((i) => i.id === id) ?? null;
}

export function activeId(snapshot: HostSnapshot | null): string | null {
  if (!snapshot) return null;
  if (typeof snapshot.activeInteractionId === 'string') return snapshot.activeInteractionId;
  return snapshot.interaction?.id ?? null;
}

export function statusOf(snapshot: HostSnapshot | null, id: string): InteractionStatus {
  const rec = record(snapshot);
  if (rec) return rec[id]?.status ?? 'pending';
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (summary) return summary.status;
  if (snapshot && activeId(snapshot) === id && snapshot.interactionStatus) {
    return snapshot.interactionStatus;
  }
  return 'pending';
}

export function answeredOf(snapshot: HostSnapshot | null, id: string): number {
  const rec = record(snapshot);
  if (rec) {
    const runtime = rec[id];
    if (runtime) return runtime.answered ?? runtime.aggregate?.total ?? 0;
  }
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (summary) return summary.answered ?? summary.aggregate?.total ?? 0;
  if (snapshot && activeId(snapshot) === id) {
    return snapshot.answeredCount ?? snapshot.answered ?? snapshot.aggregate?.total ?? 0;
  }
  return 0;
}

export function aggregateOf(snapshot: HostSnapshot | null, id: string): Aggregate | undefined {
  const rec = record(snapshot);
  if (rec?.[id]?.aggregate) return rec[id]?.aggregate;
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (summary?.aggregate) return summary.aggregate;
  if (snapshot && activeId(snapshot) === id && snapshot.aggregate) return snapshot.aggregate;
  return undefined;
}

/** The ordered interaction rail: authored order wins, snapshot order otherwise. */
export function railItems(snapshot: HostSnapshot | null, session: Session | null): RailItem[] {
  if (session) {
    return session.interactions.map((i) => ({
      id: i.id,
      type: i.type,
      prompt: i.prompt,
      status: statusOf(snapshot, i.id),
      answered: answeredOf(snapshot, i.id),
      ...(i.notes ? { notes: i.notes } : {}),
    }));
  }
  const list = summaries(snapshot);
  if (list) {
    return list.map((s) => ({
      id: s.id,
      type: s.type,
      prompt: s.prompt,
      status: s.status,
      answered: s.answered ?? 0,
      ...(s.notes ? { notes: s.notes } : {}),
    }));
  }
  const rec = record(snapshot);
  if (rec) {
    return Object.keys(rec).map((id) => ({
      id,
      type: 'text' as InteractionType,
      prompt: id,
      status: rec[id]?.status ?? 'pending',
      answered: answeredOf(snapshot, id),
    }));
  }
  return [];
}

export interface Counts {
  joined: number;
  answered: number;
}

export function counts(snapshot: HostSnapshot | null): Counts {
  const joined = snapshot?.joined ?? snapshot?.participantCount ?? 0;
  const active = activeId(snapshot);
  const answered = active ? answeredOf(snapshot, active) : (snapshot?.answeredCount ?? 0);
  return { joined, answered };
}

/** Choice options for the given interaction, from the session or active snapshot view. */
export function optionsOf(
  snapshot: HostSnapshot | null,
  session: Session | null,
  id: string,
): { id: string; label: string; correct?: boolean }[] | undefined {
  const authored = sessionInteraction(session, id);
  if (authored && authored.type === 'choice') return authored.options;
  const view = snapshot?.interaction;
  if (view && view.id === id && view.type === 'choice') {
    const options = (view as { options?: { id: string; label: string; correct?: boolean }[] }).options;
    if (Array.isArray(options)) return options;
  }
  return undefined;
}

export function notesOf(session: Session | null, id: string | null): string | undefined {
  const interaction = sessionInteraction(session, id);
  return interaction?.notes;
}

/**
 * Whether the audience/stage currently sees aggregates for this interaction.
 * Prefers the host snapshot field when present; otherwise mirrors domain rules
 * (live by default, blank when resultsHidden or hidden-until-reveal).
 */
export function audienceSeesResults(
  snapshot: HostSnapshot | null,
  session: Session | null,
  id: string | null,
): boolean {
  if (!snapshot || !id) return false;
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (typeof summary?.resultsVisible === 'boolean') return summary.resultsVisible;
  const rec = record(snapshot);
  if (typeof rec?.[id]?.resultsVisible === 'boolean') return rec[id]!.resultsVisible!;
  if (summary?.resultsHidden === true || rec?.[id]?.resultsHidden === true) return false;

  const status = statusOf(snapshot, id);
  if (status === 'pending') return false;
  if (status === 'revealed') return true;
  const ix = sessionInteraction(session, id);
  const visibility =
    ix?.resultVisibility ?? session?.defaults?.resultVisibility ?? 'live';
  return visibility === 'live' && (status === 'open' || status === 'closed');
}

export function resultsHiddenOf(snapshot: HostSnapshot | null, id: string | null): boolean {
  if (!snapshot || !id) return false;
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (summary?.resultsHidden === true) return true;
  const rec = record(snapshot);
  return rec?.[id]?.resultsHidden === true;
}

/** Effective chart display: live `session.display` override, else the authored style. */
export function displayOf(snapshot: HostSnapshot | null, id: string | null): string | undefined {
  if (!snapshot || !id) return undefined;
  const summary = summaries(snapshot)?.find((s) => s.id === id);
  if (typeof summary?.display === 'string') return summary.display;
  const view = snapshot.interaction;
  if (view && view.id === id && typeof view.display === 'string') return view.display;
  return undefined;
}
