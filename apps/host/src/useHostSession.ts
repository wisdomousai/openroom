/**
 * Shared live-host connection: snapshot sync, revision-aware commands, primary flow.
 * Used by LiveHost (desktop) and PresenterRemote (phone).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSessionClient, type SessionClient } from '@openroom/sdk';
import { fetchHostSnapshot } from './api';
import { deriveHostFlow, type HostFlowKind } from './hostFlow';
import { newIdempotencyKey, submitCommand } from './sdk';
import {
  activeId as activeIdOf,
  audienceSeesResults,
  counts as countsOf,
  railItems,
  sessionInteraction,
  sessionOf,
  statusOf,
} from './snapshot';
import { useToasts } from '@openroom/ui/toasts';
import type {
  ConnectionStatus,
  HostCommand,
  HostSnapshot,
  InteractionStatus,
  StoredSession,
} from './types';

function isPeerInstruction(interaction: { type?: string } | null): boolean {
  if (!interaction || interaction.type !== 'choice') return false;
  return (interaction as { peerInstruction?: boolean }).peerInstruction === true;
}

function summaryOf(
  snapshot: HostSnapshot | null,
  id: string | null,
): { round?: 1 | 2; round1Aggregate?: unknown } | null {
  if (!snapshot || !id) return null;
  const list = snapshot.interactions;
  if (!list) return null;
  if (Array.isArray(list)) {
    return (list.find((item) => item.id === id) ?? null) as {
      round?: 1 | 2;
      round1Aggregate?: unknown;
    } | null;
  }
  return (list[id] ?? null) as { round?: 1 | 2; round1Aggregate?: unknown } | null;
}

export function useHostSession(live: StoredSession) {
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const clientRef = useRef<SessionClient | null>(null);
  const snapshotRef = useRef<HostSnapshot | null>(null);
  const { toasts, push } = useToasts();

  useEffect(() => {
    let disposed = false;
    try {
      clientRef.current = createSessionClient({
        baseUrl: '',
        sessionCode: live.sessionCode,
        token: live.hostToken,
        role: 'host',
        onChange: (next) => {
          if (disposed) return;
          const host = next as unknown as HostSnapshot;
          snapshotRef.current = host;
          setSnapshot(host);
        },
        onStatus: (s) => {
          if (!disposed) setStatus(s);
        },
      });
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'Could not connect to the session.');
    }
    return () => {
      disposed = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [live.sessionCode, live.hostToken]);

  const run = useCallback(
    async (command: HostCommand) => {
      const permissions = snapshotRef.current?.facilitation;
      const moderation = ['text.hide', 'text.unhide', 'qna.hide', 'qna.unhide', 'group.set', 'group.remove'].includes(command.command);
      const recovery = command.command === 'presentation.recover' && permissions?.canRecover;
      if (!permissions?.canPresent && !moderation && !recovery) {
        push('Presentation control belongs to the active presenter.', 'info');
        return false;
      }
      const revision = snapshotRef.current?.revision;
      const first = await submitCommand(
        live.sessionCode,
        live.hostToken,
        command,
        revision,
        newIdempotencyKey(),
      );
      if (first.ok) {
        void clientRef.current?.refresh();
        return true;
      }

      if (first.code === 'E_REVISION_CONFLICT') {
        // Joining, votes and another controller may advance the revision while
        // this command travels. A successful retry needs no warning to the tutor.
        let fresh = revision;
        try {
          const state = (await fetchHostSnapshot(live.sessionCode, live.hostToken)) as HostSnapshot;
          if (state && typeof state.revision === 'number') {
            fresh = state.revision;
            snapshotRef.current = state;
            setSnapshot(state);
          }
        } catch {
          /* keep the last known revision */
        }
        const retry = await submitCommand(
          live.sessionCode,
          live.hostToken,
          command,
          fresh,
          newIdempotencyKey(),
        );
        if (retry.ok) {
          void clientRef.current?.refresh();
          return true;
        }
        push(retry.message ?? retry.code ?? 'Command failed after retry', 'error');
        return false;
      }
      push(first.message ?? first.code ?? 'Command failed', 'error');
      return false;
    },
    [push, live.sessionCode, live.hostToken],
  );

  const session = useMemo(() => sessionOf(snapshot), [snapshot]);
  const items = useMemo(() => railItems(snapshot, session), [snapshot, session]);
  const activeId = activeIdOf(snapshot);
  const ended = snapshot?.status === 'ended';
  const frozen = snapshot?.frozen === true;
  const activeStatus: InteractionStatus | null = activeId ? statusOf(snapshot, activeId) : null;
  const pendingLeft = items.filter((i) => statusOf(snapshot, i.id) === 'pending').length;
  const counts = countsOf(snapshot);
  const answered = counts.answered;
  const activePrompt =
    items.find((i) => i.id === activeId)?.prompt ??
    sessionInteraction(session, activeId)?.prompt ??
    null;

  const activeSessionIx = sessionInteraction(session, activeId);
  const peerInstruction = isPeerInstruction(activeSessionIx);
  const activeSummary = summaryOf(snapshot, activeId);
  const round: 1 | 2 = activeSummary?.round ?? 1;
  const canRevote =
    !ended && peerInstruction && activeStatus === 'closed' && round === 1;
  const canUndoRevote =
    !ended && peerInstruction && round === 2 && !!activeSummary?.round1Aggregate;

  const audienceSees = audienceSeesResults(snapshot, session, activeId);
  const resultsHiddenOfActive = (() => {
    if (!snapshot || !activeId) return false;
    const list = snapshot.interactions;
    if (Array.isArray(list)) {
      return list.find((i) => i.id === activeId)?.resultsHidden === true;
    }
    if (list && typeof list === 'object') {
      return (list as Record<string, { resultsHidden?: boolean }>)[activeId]?.resultsHidden === true;
    }
    return false;
  })();

  const advance = useCallback(() => {
    const outline = snapshotRef.current?.outline;
    if (outline !== undefined) {
      const last = outline.content.steps.length - 1;
      if (outline.currentStepIndex < last) {
        void run({ command: 'outline.next' });
        return;
      }
      // Last step: primary flow should already be "end"; do not session.advance.
      return;
    }
    void run({ command: 'session.advance' });
  }, [run]);
  const closeActive = useCallback(() => {
    if (activeId) void run({ command: 'interaction.close', interactionId: activeId });
  }, [run, activeId]);
  const revealActive = useCallback(() => {
    if (!activeId) return;
    // Live blank → clear it without locking the question. Quiz / key unlock → reveal.
    if (resultsHiddenOfActive) {
      void run({ command: 'interaction.showResults', interactionId: activeId });
      return;
    }
    void run({ command: 'interaction.reveal', interactionId: activeId });
  }, [run, activeId, resultsHiddenOfActive]);
  const hideResultsActive = useCallback(() => {
    if (activeId) void run({ command: 'interaction.hideResults', interactionId: activeId });
  }, [run, activeId]);
  const showResultsActive = useCallback(() => {
    if (activeId) void run({ command: 'interaction.showResults', interactionId: activeId });
  }, [run, activeId]);
  const toggleFreeze = useCallback(() => {
    void run({ command: frozen ? 'session.unfreeze' : 'session.freeze' });
  }, [run, frozen]);
  const endSession = useCallback(() => {
    setConfirmEnd(false);
    void run({ command: 'session.end' });
  }, [run]);
  const revoteActive = useCallback(() => {
    if (activeId) void run({ command: 'interaction.revote', interactionId: activeId });
  }, [run, activeId]);
  const undoRevoteActive = useCallback(() => {
    if (activeId) void run({ command: 'interaction.undoRevote', interactionId: activeId });
  }, [run, activeId]);
  const openInteraction = useCallback(
    (interactionId: string) => void run({ command: 'interaction.open', interactionId }),
    [run],
  );

  // ---- session-wide audience Q&A ---------------------------------------
  const qna = snapshot?.qna?.enabled === true ? snapshot.qna : null;
  const toggleQnaHidden = useCallback(
    (questionId: string, hidden: boolean) =>
      void run({ command: hidden ? 'qna.unhide' : 'qna.hide', questionId }),
    [run],
  );
  const setQnaStage = useCallback(
    (mode: 'off' | 'list' | 'spotlight', questionId?: string) =>
      void run(
        mode === 'spotlight' && questionId !== undefined
          ? { command: 'qna.stage', mode, questionId }
          : { command: 'qna.stage', mode: mode === 'spotlight' ? 'list' : mode },
      ),
    [run],
  );

  const flowState = useMemo(
    () => deriveHostFlow(snapshot, { pendingLeft, audienceSeesResults: audienceSees }),
    [snapshot, pendingLeft, audienceSees],
  );

  const runFlow = useCallback(
    (kind: HostFlowKind) => {
      switch (kind) {
        case 'start':
          void run({ command: 'session.start' });
          break;
        case 'reveal':
          revealActive();
          break;
        case 'advance':
          advance();
          break;
        case 'end':
          setConfirmEnd(true);
          break;
      }
    },
    [run, revealActive, advance],
  );

  const flow = useMemo(() => {
    if (!flowState) return null;
    return {
      label: flowState.label,
      kind: flowState.kind,
      go: () => runFlow(flowState.kind),
    };
  }, [flowState, runFlow]);

  return {
    snapshot,
    setSnapshot,
    status,
    fatal,
    toasts,
    push,
    run,
    canPresent: snapshot?.facilitation?.canPresent === true,
    session,
    items,
    activeId,
    activeStatus,
    activePrompt,
    pendingLeft,
    ended,
    frozen,
    counts,
    answered,
    closesAt: snapshot?.closesAt,
    code: snapshot?.code ?? live.code,
    flow,
    confirmEnd,
    setConfirmEnd,
    advance,
    revealActive,
    closeActive,
    hideResultsActive,
    showResultsActive,
    audienceSeesResults: audienceSees,
    resultsHidden: resultsHiddenOfActive,
    toggleFreeze,
    endSession,
    peerInstruction,
    canRevote,
    canUndoRevote,
    revoteActive,
    undoRevoteActive,
    openInteraction,
    round,
    qna,
    toggleQnaHidden,
    setQnaStage,
    clientRef,
    snapshotRef,
  };
}
