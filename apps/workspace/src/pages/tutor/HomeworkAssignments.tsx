import { Plus, Trash2 } from 'lucide-react';
import { HOMEWORK_TASK_MAX, type HomeworkAudience, type PublishedHomeworkTask } from '@openroom/schema';
import type { ContextLearner } from '../../api';
import { Button } from '@openroom/ui/components/button';
import { Checkbox } from '@openroom/ui/components/checkbox';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@openroom/ui/components/select';
import { Textarea } from '@openroom/ui/components/textarea';

const names = { reading: 'Reading', writing: 'Writing', voice: 'Voice response', quiz: 'Practice' };

export function HomeworkAssignments({ tasks, audience, learners, onTasks, onAudience, disabled }: {
  tasks: PublishedHomeworkTask[]; audience: HomeworkAudience; learners: ContextLearner[];
  onTasks: (tasks: PublishedHomeworkTask[]) => void; onAudience: (audience: HomeworkAudience) => void; disabled: boolean;
}) {
  const update = (task: PublishedHomeworkTask) => onTasks(tasks.map((row) => row.id === task.id ? task : row));
  const share = (taskId: string) => { const next = { ...audience }; delete next[taskId]; onAudience(next); };
  const add = (kind: 'reading' | 'writing' | 'voice') => {
    const id = `${kind}-${crypto.randomUUID()}`;
    onTasks([...tasks, kind === 'reading' ? { id, kind, body: '' } : { id, kind, prompt: '' }]);
  };
  return <section className="grid gap-4" aria-labelledby="assignments-heading">
    <div><h2 id="assignments-heading" className="font-semibold">Homework</h2><p className="mt-1 text-sm text-muted-foreground">Choose what to share and who receives each task. Earlier responses keep their original instructions.</p></div>
    {tasks.map((task, index) => <fieldset key={task.id} disabled={disabled} className="grid gap-4 rounded-xl border border-border p-4" aria-label={`${task.title || names[task.kind]} assignment`}>
      <legend className="px-1 text-sm font-medium">{names[task.kind]}</legend>
      <div className="grid gap-2"><Label htmlFor={`task-title-${task.id}`}>Task title (optional)</Label><Input id={`task-title-${task.id}`} value={task.title ?? ''} maxLength={300} onChange={(event) => update({ ...task, title: event.target.value || undefined })} /></div>
      {task.kind === 'quiz' ? <p className="whitespace-pre-wrap text-base">{task.interaction.prompt}</p> : <div className="grid gap-2"><Label htmlFor={`task-content-${task.id}`}>{task.kind === 'reading' ? 'Reading' : 'Instructions'}</Label><Textarea id={`task-content-${task.id}`} rows={3} maxLength={task.kind === 'reading' ? 5000 : 2000} value={task.kind === 'reading' ? task.body : task.prompt} required onChange={(event) => update(task.kind === 'reading' ? { ...task, body: event.target.value } : { ...task, prompt: event.target.value })} /></div>}
      {task.kind === 'writing' || task.kind === 'voice' ? <div className="grid gap-2"><Label htmlFor={`task-guidance-${task.id}`}>Guidance (optional)</Label><Textarea id={`task-guidance-${task.id}`} rows={2} maxLength={2000} value={task.guidance ?? ''} onChange={(event) => update({ ...task, guidance: event.target.value || undefined })} /></div> : null}
      <div className="grid gap-2">
        <Label htmlFor={`task-audience-${task.id}`}>Who receives this task?</Label>
        <Select disabled={disabled} value={Object.hasOwn(audience, task.id) ? 'selected' : 'everyone'} onValueChange={(value) => { if (value === 'everyone') share(task.id); else onAudience({ ...audience, [task.id]: [] }); }}>
          <SelectTrigger id={`task-audience-${task.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="everyone">Everyone in this context</SelectItem><SelectItem value="selected" disabled={learners.length === 0}>Selected learners</SelectItem></SelectContent>
        </Select>
        {Object.hasOwn(audience, task.id) ? <div className="grid gap-1 rounded-lg bg-muted/40 p-2">
          {learners.map((person) => <label key={person.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted"><Checkbox checked={audience[task.id]!.includes(person.id)} onCheckedChange={(checked) => onAudience({ ...audience, [task.id]: checked ? [...audience[task.id]!, person.id] : audience[task.id]!.filter((id) => id !== person.id) })} />{person.displayName}</label>)}
          {audience[task.id]!.length === 0 ? <p role="alert" className="px-2 text-sm text-destructive">Choose at least one learner.</p> : null}
        </div> : null}
      </div>
      <Button type="button" variant="ghost" className="w-fit text-muted-foreground" aria-label={`Remove task ${index + 1}`} onClick={() => { onTasks(tasks.filter((row) => row.id !== task.id)); share(task.id); }}><Trash2 /> Remove task</Button>
    </fieldset>)}
    {tasks.length === 0 ? <p className="text-sm text-muted-foreground">Add a task here or prepare homework in the deck before teaching.</p> : null}
    {learners.length === 0 ? <p className="text-sm text-muted-foreground">Individual assignments become available after you create personal learner links.</p> : null}
    <div className="flex flex-wrap gap-2">{(['reading', 'writing', 'voice'] as const).map((kind) => <Button key={kind} type="button" variant="outline" disabled={disabled || tasks.length >= HOMEWORK_TASK_MAX} onClick={() => add(kind)}><Plus /> Add {names[kind].toLowerCase()}</Button>)}</div>
  </section>;
}
