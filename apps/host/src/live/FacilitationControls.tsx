import { useState } from 'react';
import type { HostCommand, HostSnapshot } from '../types';
import { Button } from '@openroom/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@openroom/ui/components/dropdown-menu';

export function FacilitationControls({ snapshot, run }: {
  snapshot: HostSnapshot | null;
  run: (command: HostCommand) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const view = snapshot?.facilitation;
  if (!view || snapshot?.status === 'ended' || view.facilitators.length < 2) return null;
  const presenter = view.facilitators.find((person) => person.id === view.presenterId);
  const act = async (command: HostCommand) => {
    setBusy(true);
    try { await run(command); } finally { setBusy(false); }
  };
  return <section aria-label="Facilitators" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-2 text-sm">
    <div className="min-w-0 flex-1">
      <p role="status" className="font-medium">{view.canPresent ? 'You are presenting' : `${presenter?.name ?? 'Another facilitator'} is presenting`}</p>
      {!view.canPresent ? <p className="text-caption text-muted-foreground">You can moderate responses and manage groups.</p> : null}
    </div>
    {view.canPresent ? <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy}>Pass presentation</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {view.facilitators.filter((person) => person.id !== view.yourId).map((person) => <DropdownMenuItem key={person.id} onSelect={() => void act({ command: 'presentation.handoff', facilitatorId: person.id })}>{person.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu> : view.canRecover ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ command: 'presentation.recover' })}>Take back presentation</Button> : null}
  </section>;
}
