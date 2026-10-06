import { PresentStage, presentableSteps, useStageMirror, type DesktopPresentationState } from '@openroom/editor';
import { StageView } from '@openroom/stage-src/StageView';
import { useEffect, useMemo, useState } from 'react';
import {
  editableOutlineForOpenRoomFile,
  parseOpenRoomFile,
  resolveRevealOrder,
  type Outline,
} from '@openroom/schema';

import { desktopBridge } from '../desktop-bridge';

function parseState(state: DesktopPresentationState | null): { outline: Outline; state: DesktopPresentationState } | null {
  if (state === null) return null;
  const parsed = parseOpenRoomFile(state.source);
  if (!parsed.ok) return null;
  return { outline: editableOutlineForOpenRoomFile(parsed.file), state };
}

/** Audience-only window. Navigation is owned by the presenter window over IPC. */
export function DesktopPresentationPage() {
  const bridge = desktopBridge();
  const [state, setState] = useState<DesktopPresentationState | null>(null);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.getPresentation().then(setState);
    return bridge.onPresentationState(setState);
  }, [bridge]);

  useEffect(() => {
    if (bridge === null) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') bridge.sendPresentationCommand('close');
      else if (event.key === 'ArrowLeft') bridge.sendPresentationCommand('previous');
      else if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Spacebar') {
        bridge.sendPresentationCommand('next');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [bridge]);

  const parsed = useMemo(() => parseState(state), [state]);
  if (state?.live) return <LiveAudience live={state.live} />;
  if (parsed === null) {
    return <main className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">Waiting for the presentation…</main>;
  }
  const steps = presentableSteps(parsed.outline);
  const step = steps[parsed.state.cursor.step];
  if (step === undefined) {
    return <main className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">This file has no slides yet.</main>;
  }
  const groups = resolveRevealOrder(step, parsed.outline.interactions);
  return (
    <main className="flex h-svh flex-col overflow-hidden bg-background">
      <PresentStage
        outline={parsed.outline}
        step={step}
        groups={groups}
        shown={parsed.state.cursor.shown}
        listening={parsed.state.listening?.stepId === step.id ? parsed.state.listening : undefined}
      />
    </main>
  );
}

function LiveAudience({ live }: { live: { sessionCode: string; stageToken: string } }) {
  const { stageSnapshot, stageStatus } = useStageMirror({ ...live, code: live.sessionCode, hostToken: '', createdAt: 0 });
  return <StageView snapshot={stageSnapshot} status={stageStatus} />;
}
