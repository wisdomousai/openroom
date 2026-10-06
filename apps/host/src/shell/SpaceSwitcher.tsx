import { WORKSPACE_EXPERIENCES } from '@openroom/schema';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { MySpace } from '../api';
import { Button } from '@openroom/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@openroom/ui/components/dropdown-menu';
import { to } from '../destinations';
import { EXPERIENCES } from './experiences';

export function SpaceSwitcher({ current, spaces }: { current: MySpace | null; spaces: MySpace[] }) {
  const navigate = useNavigate();
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button variant="subtle" className="h-auto w-full justify-between px-2 py-2 text-left" aria-label="Switch space">
      <span className="min-w-0"><span className="block text-xs text-muted-foreground">{EXPERIENCES[current?.settings.experience ?? 'classroom'].label}</span>
        <span className="block truncate font-semibold">{current?.name ?? 'OpenRoom'}</span></span>
      <ChevronDown className="ml-2 size-4 shrink-0" />
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
    {WORKSPACE_EXPERIENCES.map((experience) => {
      const choices = spaces.filter((space) => space.settings.experience === experience);
      return choices.length ? <div key={experience}>
        <DropdownMenuLabel>{EXPERIENCES[experience].label}</DropdownMenuLabel>
        {choices.map((space) => <DropdownMenuItem key={space.id} onSelect={() => void navigate(to.library({ spaceId: space.id }))}>
          <span className="flex-1 truncate">{space.name}{space.shared ? ' · Shared' : ''}</span>
          {space.id === current?.id ? <Check aria-label="Current space" /> : null}
        </DropdownMenuItem>)}
      </div> : null;
    })}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => void navigate(to.spaceNew())}><Plus /> New space</DropdownMenuItem>
    {current ? <DropdownMenuItem onSelect={() => void navigate(to.spaceEdit(current.id))}>Space settings</DropdownMenuItem> : null}
  </DropdownMenuContent></DropdownMenu>;
}
