import { useState } from 'react';
import type { SessionGroupView } from '@openroom/sdk';
import { Button } from '@openroom/ui/components/button';
import { Input } from '@openroom/ui/components/input';
import type { HostCommand, HostSnapshot } from '../types';

export function GroupsPanel({ snapshot, run, ended }: {
  snapshot: HostSnapshot;
  run: (command: HostCommand) => Promise<boolean>;
  ended: boolean;
}) {
  const [draft, setDraft] = useState<SessionGroupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const groups = snapshot.groups ?? [];
  const participants = snapshot.participants ?? [];
  const label = (id: string | null) => participants.find((person) => person.id === id)?.label;
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (await run({ command: 'group.set', group: draft })) setDraft(null);
    } finally { setBusy(false); }
  };

  if (draft) return (
    <form className="flex flex-col gap-4 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2 className="text-base font-semibold">{groups.some((group) => group.id === draft.id) ? 'Edit group' : 'New group'}</h2>
      <label className="flex flex-col gap-1 text-sm">Group name
        <Input autoFocus required maxLength={80} value={draft.name} disabled={busy || ended}
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
      </label>
      <p className="text-sm text-muted-foreground">Choose members, then a spokesperson to send the shared answer. Moving a person keeps earlier group answers in place.</p>
      <Input aria-label="Find participant" placeholder="Find participant" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      <fieldset className="flex flex-col gap-2" disabled={busy || ended}>
        <legend className="mb-2 text-sm font-semibold">Participants</legend>
        {participants.filter((person) => person.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((person) => {
          const selected = draft.memberIds.includes(person.id);
          const other = groups.find((group) => group.id !== draft.id && group.memberIds.includes(person.id));
          return <div key={person.id} className="rounded-lg border border-border p-2.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected} onChange={() => setDraft({ ...draft,
                memberIds: selected ? draft.memberIds.filter((id) => id !== person.id) : [...draft.memberIds, person.id],
                spokespersonId: selected && draft.spokespersonId === person.id ? null : draft.spokespersonId,
              })} />
              <span className="min-w-0 break-words">{person.label}</span>
            </label>
            {other ? <p className="mt-1 text-xs text-muted-foreground">{selected ? 'Moves from' : 'In'} {other.name}</p> : null}
            {selected ? <button type="button" className="mt-2 rounded border border-input px-2 py-1 text-xs aria-pressed:bg-accent"
              aria-label={`Make ${person.label} spokesperson`} aria-pressed={draft.spokespersonId === person.id}
              onClick={() => setDraft({ ...draft, spokespersonId: draft.spokespersonId === person.id ? null : person.id })}>
              {draft.spokespersonId === person.id ? 'Spokesperson' : 'Make spokesperson'}
            </button> : null}
          </div>;
        })}
        {!participants.length ? <p className="text-sm text-muted-foreground">Participants appear here when they join.</p> : null}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || ended || !draft.name.trim()}>{busy ? 'Saving…' : 'Save group'}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
      </div>
    </form>
  );

  return <div className="flex flex-col gap-4 p-4">
    <div>
      <h2 className="text-base font-semibold">Session groups</h2>
      <p className="mt-1 text-sm text-muted-foreground">One spokesperson answers for each group. Individual questions still go to everyone.</p>
    </div>
    <Button variant="outline" disabled={ended || busy} onClick={() => {
      setSearch(''); setDraft({ id: `g-${crypto.randomUUID()}`, name: '', memberIds: [], spokespersonId: null });
    }}>New group</Button>
    {groups.map((group) => <section key={group.id} aria-label={group.name} className="rounded-xl border border-border bg-background p-3">
      <h3 className="break-words font-semibold">{group.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{group.memberIds.length} members</p>
      <p className="mt-1 text-sm">{group.spokespersonId ? `Spokesperson: ${label(group.spokespersonId)}` : 'Choose a spokesperson'}</p>
      <p className="mt-2 break-words text-sm">{group.memberIds.map((id) => label(id)).join(', ') || 'No members yet'}</p>
      <div className="mt-3 flex gap-1">
        <Button variant="outline" size="sm" disabled={ended || busy} onClick={() => { setSearch(''); setDraft({ ...group, memberIds: [...group.memberIds] }); }}>Edit group</Button>
        <Button variant="ghost" size="sm" disabled={ended || busy} onClick={async () => {
          setBusy(true);
          try { await run({ command: 'group.remove', groupId: group.id }); }
          finally { setBusy(false); }
        }}>Dissolve</Button>
      </div>
    </section>)}
    {groups.length ? <p className="text-xs text-muted-foreground">Dissolving a group keeps its submitted answers. New groups start with a fresh answer.</p> : null}
  </div>;
}
