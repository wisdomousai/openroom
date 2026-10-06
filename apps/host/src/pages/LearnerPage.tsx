/**
 * `#/learn?token=orlnk_…` — the one screen a student sees.
 *
 * This is not part of the signed-in workspace: no `WorkspaceShell`, no nav, no
 * session cookie, and deliberately no sign-in prompt, because there is no
 * account to sign into (docs/PRD.md forbids student accounts). The link *is*
 * the credential.
 *
 * Rules this file keeps:
 *  - the token is read from the hash, held in a variable, and sent as a bearer
 *    header. It is never rendered, never written to storage, never put in the
 *    document title, and never used as part of a query key.
 *  - a link that is invalid, expired, or revoked all look the same from here —
 *    401 — and all get the same calm sentence. No status codes, no stack.
 *  - 429 is the one failure that is *not* the same sentence, because it is the
 *    one the reader can fix by waiting. Saying "this link no longer works" to
 *    someone whose link is fine would send them to their tutor for nothing.
 */
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  ApiError,
  fetchLearnerIdentity,
  fetchLearnerFeedback,
  fetchLearnerPractice,
  fetchLearnerSessions,
  gradeLearnerPractice,
  saveLearnerWriting,
  type LearnerHomeworkTask,
  type LearnerPracticeItem,
  type LearnerSession,
} from '../api';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import { Textarea } from '@openroom/ui/components/textarea';
import { recordItemLabel, recordItemUrl } from '../lib/context-links';
import { VoiceTask } from './learner/VoiceTask';
import { PrivateAudio } from '../components/PrivateAudio';
import { PracticeCard } from './learner/PracticeCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@openroom/ui/components/tabs';
import { LearnerLanguageProvider, useLearnerLanguage } from '../lib/learner-language';
import { learnerLanguageNames, type LearnerLocale } from '../lib/learner-copy';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@openroom/ui/components/select';

function Frame({ children }: { children: ReactNode }) {
  const { locale, copy, setLocale } = useLearnerLanguage();
  return (
    <main lang={locale} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
        <div className="flex justify-end"><Select value={locale} onValueChange={(value) => setLocale(value as LearnerLocale)}>
          <SelectTrigger aria-label={copy.interfaceLanguage} className="min-h-11 w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(learnerLanguageNames) as LearnerLocale[]).map((language) => <SelectItem key={language} value={language} lang={language}>{learnerLanguageNames[language]}</SelectItem>)}</SelectContent>
        </Select></div>
        {children}
      </div>
    </main>
  );
}

function DeadLink() {
  const { copy } = useLearnerLanguage();
  return (
    <Frame>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{copy.deadLink}</h1>
      <p className="text-base">
        {copy.newLink}
      </p>
    </Frame>
  );
}

function TooManyAttempts() {
  const { copy } = useLearnerLanguage();
  return (
    <Frame>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{copy.tooManyAttempts}</h1>
      <p className="text-base">
        {copy.rateLimit}
      </p>
    </Frame>
  );
}

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

function asHomework(items: unknown[] | undefined): LearnerHomeworkTask[] {
  if (!items) return [];
  return items.flatMap((item, index) => {
    if (typeof item === 'string' && item.trim() !== '') {
      return [{ id: `item-${String(index + 1)}`, kind: 'reading' as const, body: item }];
    }
    if (item !== null && typeof item === 'object' && 'kind' in item) {
      return [item as LearnerHomeworkTask];
    }
    return [];
  });
}

export function LearnerPage({ token }: { token: string | null }) {
  // A different credential gets an empty in-memory cache and fresh form state.
  // Neither the credential nor a learner's work enters the workspace cache.
  const scope = useMemo(() => ({ token, id: crypto.randomUUID(), client: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } }) }), [token]);
  useEffect(() => () => { void scope.client.cancelQueries().then(() => scope.client.clear()); }, [scope]);
  return <LearnerLanguageProvider><QueryClientProvider client={scope.client}><LearnerContent key={scope.id} token={scope.token} /></QueryClientProvider></LearnerLanguageProvider>;
}

function LearnerContent({ token }: { token: string | null }) {
  const { copy } = useLearnerLanguage();
  const queryClient = useQueryClient();
  const identityQuery = useQuery({
    queryKey: ['learner', 'me'] as const,
    queryFn: () => fetchLearnerIdentity(token!),
    enabled: token !== null,
    retry: false,
  });
  const sessionsQuery = useQuery({
    queryKey: ['learner', 'sessions'] as const,
    queryFn: () => fetchLearnerSessions(token!),
    enabled: token !== null && identityQuery.isSuccess,
    retry: false,
  });
  const practiceQuery = useQuery({
    queryKey: ['learner', 'practice'] as const,
    queryFn: () => fetchLearnerPractice(token!),
    enabled: token !== null && identityQuery.isSuccess,
    retry: false,
  });
  const [activeTab, setActiveTab] = useState('lesson');
  const feedbackQuery = useQuery({ queryKey: ['learner', 'feedback'], queryFn: () => fetchLearnerFeedback(token!), enabled: token !== null && identityQuery.isSuccess, retry: false });

  if (isRateLimited(identityQuery.error)) return <TooManyAttempts />;
  if (token === null || identityQuery.isError) return <DeadLink />;
  if (identityQuery.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted-foreground" role="status">{copy.loading}</p>
      </Frame>
    );
  }

  const sessions = sessionsQuery.data ?? null;
  const latest = sessions?.[0] ?? null;
  const earlier = (sessions ?? []).slice(1);
  const pile = practiceQuery.data ?? [];

  return (
    <Frame>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {identityQuery.data.displayName}
        </h1>
      </header>
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value);
        if (value === 'feedback') void feedbackQuery.refetch();
        if (value === 'practice') void practiceQuery.refetch();
      }}>
        <TabsList className="grid h-12 w-full grid-cols-3" aria-label={copy.learning}><TabsTrigger className="h-10 text-base" value="lesson">{copy.lesson}</TabsTrigger><TabsTrigger className="h-10 text-base" value="practice">{copy.practice}</TabsTrigger><TabsTrigger className="h-10 text-base" value="feedback">{copy.feedback}</TabsTrigger></TabsList>
        <TabsContent forceMount value="lesson" className="mt-5 data-[state=inactive]:hidden">
      {isRateLimited(sessionsQuery.error) ? (
        <p className="text-base">
          {copy.rateLimitShort}
        </p>
      ) : sessionsQuery.isError ? (
        <p className="text-base">
          {copy.lessonsError}
        </p>
      ) : sessions === null ? (
        <p className="text-sm text-muted-foreground" role="status">{copy.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="text-base">{copy.lessonEmpty}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {latest !== undefined && latest !== null ? (
            <HomeworkBlock token={token} session={latest} latest active={activeTab === 'lesson'} />
          ) : null}
          {earlier.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">{copy.earlierSessions}</summary>
              <div className="mt-3 flex flex-col gap-4">
                {earlier.map((session) => (
                  <HomeworkBlock key={session.id} token={token} session={session} active={activeTab === 'lesson'} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
        </TabsContent>
        <TabsContent forceMount value="practice" className="mt-5 grid gap-5 data-[state=inactive]:hidden">
          {practiceQuery.isError ? <p role="alert">{copy.practiceLoadError}</p> : null}
          {practiceQuery.isPending ? <p role="status">{copy.loadingPractice}</p> : token ? <PracticePile token={token} items={pile} onDone={() => { void queryClient.invalidateQueries({ queryKey: ['learner', 'practice'] }); }} /> : null}
          {sessions?.some((session) => asHomework(session.record?.homework).some((task) => task.kind === 'quiz')) ? <details><summary className="cursor-pointer font-medium">{copy.revisit}</summary><div className="mt-4 grid gap-4">{sessions.map((session) => asHomework(session.record?.homework).filter((task) => task.kind === 'quiz').map((task) => <HomeworkTaskView key={`${session.id}:${task.id}`} token={token} sessionId={session.id} task={task} />))}</div></details> : null}
        </TabsContent>
        <TabsContent forceMount value="feedback" className="mt-5 grid gap-5 data-[state=inactive]:hidden">
          {feedbackQuery.isPending ? <p role="status">{copy.loadingFeedback}</p> : feedbackQuery.isError ? <p role="alert">{copy.feedbackLoadError}</p> : feedbackQuery.data?.length === 0 ? <p className="text-muted-foreground">{copy.feedbackEmpty}</p> : feedbackQuery.data?.map((item) => <Card key={item.submissionId}>
            <CardHeader><CardTitle className="text-lg">{item.task.title ?? (item.task.kind === 'writing' || item.task.kind === 'voice' ? item.task.prompt : copy.feedback)}</CardTitle></CardHeader>
            <CardContent className="grid gap-5">
              <p className="whitespace-pre-wrap text-base leading-relaxed">{item.feedback.message}</p>
              {item.feedback.corrections.map((correction, index) => <div key={index} className="grid gap-2 rounded-lg border border-border p-4"><p className="text-sm text-muted-foreground">{copy.yourWords}</p><p className="whitespace-pre-wrap text-base">{correction.original}</p><p className="text-sm text-muted-foreground">{copy.tryThis}</p><p className="whitespace-pre-wrap text-base font-medium">{correction.replacement}</p><p className="whitespace-pre-wrap text-base leading-relaxed">{correction.explanation}</p></div>)}
              {item.audio && token ? <PrivateAudio key={item.submissionId} submissionId={item.submissionId} {...item.audio} token={token} comments={item.feedback.audioComments} onChanged={() => Promise.all([feedbackQuery.refetch(), sessionsQuery.refetch()])} /> : null}
              {item.task.kind === 'writing' ? <details><summary className="cursor-pointer text-sm font-medium">{copy.yourResponse}</summary><p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">{item.body}</p></details> : null}
            </CardContent>
          </Card>)}
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {copy.personalLink}
      </p>
    </Frame>
  );
}

function PracticePile({
  token,
  items,
  onDone,
}: {
  token: string;
  items: LearnerPracticeItem[];
  onDone: () => void;
}) {
  const { copy } = useLearnerLanguage();
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  const [current, setCurrent] = useState<LearnerPracticeItem | undefined>(items[0]);
  useEffect(() => {
    if (!current) setCurrent(items.find((item) => !finished.has(item.itemId)));
  }, [current, items, finished]);
  if (current === undefined) return <p className="text-muted-foreground">{copy.practiceDone}</p>;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{copy.practice}</h2>
      <PracticeCard
        key={current.itemId}
        item={current}
        onGrade={async (grade, answer, assignmentRevision, attemptId) => {
          await gradeLearnerPractice(token, { itemId: current.itemId, grade, answer, assignmentRevision, attemptId });
          setFinished((previous) => new Set([...previous, current.itemId]));
          setCurrent(undefined);
          onDone();
        }}
        onRefresh={async () => (await fetchLearnerPractice(token, current.itemId))[0]}
        onSkip={() => { setFinished((previous) => new Set([...previous, current.itemId])); setCurrent(undefined); onDone(); }}
      />
    </section>
  );
}

function HomeworkBlock({
  token,
  session,
  latest = false,
  active,
}: {
  token: string | null;
  session: LearnerSession;
  latest?: boolean;
  active: boolean;
}) {
  const { copy } = useLearnerLanguage();
  const tasks = asHomework(session.record?.homework);
  const outcomes = session.record?.outcomes ?? [];
  const artifacts = session.record?.artifacts ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{latest ? copy.thisSession : session.title}</CardTitle>
        {latest ? <p className="text-sm text-muted-foreground">{session.title}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {tasks.length === 0 && outcomes.length === 0 && artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.nothingWritten}</p>
        ) : null}
        {tasks.filter((task) => task.kind !== 'quiz').map((task) => (
          <HomeworkTaskView key={task.id} token={token} sessionId={session.id} task={task} active={active} />
        ))}
        <ItemList title={copy.outcomes} items={outcomes} />
        <ItemList title={copy.materials} items={artifacts} />
      </CardContent>
    </Card>
  );
}

function HomeworkTaskView({
  token,
  sessionId,
  task,
  active = true,
}: {
  token: string | null;
  sessionId: string;
  task: LearnerHomeworkTask;
  active?: boolean;
}) {
  const { copy } = useLearnerLanguage();
  if (task.kind === 'reading') {
    return (
      <div>
        <h3 className="text-sm font-semibold">{task.title ?? copy.reading}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{task.body}</p>
      </div>
    );
  }
  if (task.kind === 'voice' && token) return <VoiceTask token={token} sessionId={sessionId} task={task} active={active} />;
  if (task.kind === 'writing') {
    return <WritingTask token={token} sessionId={sessionId} task={task} />;
  }
  if (task.kind === 'quiz' && task.interaction) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{task.title ?? copy.quiz}</h3>
        <PracticeCard
          item={{
            itemId: `${sessionId}:${task.id}`,
            assignmentRevision: task.assignmentRevision!,
            title: task.title,
            interaction: task.interaction,
          }}
          onGrade={async (grade, answer, assignmentRevision, attemptId) => {
            if (token === null) return;
            await gradeLearnerPractice(token, { itemId: `${sessionId}:${task.id}`, grade, answer, assignmentRevision, attemptId });
          }}
          onRefresh={async () => token ? (await fetchLearnerPractice(token, `${sessionId}:${task.id}`))[0] : undefined}
        />
      </div>
    );
  }
  return null;
}

function WritingTask({
  token,
  sessionId,
  task,
}: {
  token: string | null;
  sessionId: string;
  task: LearnerHomeworkTask;
}) {
  const { copy } = useLearnerLanguage();
  const [body, setBody] = useState(task.submitted ?? '');
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => saveLearnerWriting(token!, { sessionId, taskId: task.id, body, assignmentRevision: task.assignmentRevision!, submissionId }),
  });
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{task.title ?? copy.writing}</h3>
      <p className="text-sm">{task.prompt}</p>
      {task.guidance ? <p className="text-sm text-muted-foreground">{task.guidance}</p> : null}
      <Textarea
        rows={6}
        disabled={save.isPending}
        value={body}
        onChange={(event) => { setBody(event.currentTarget.value); setSubmissionId(crypto.randomUUID()); save.reset(); }}
        className="min-h-28 text-base"
        aria-label={task.prompt}
      />
      <Button
        type="button"
        className="min-h-11 w-fit"
        disabled={token === null || save.isPending || !body.trim() || save.isSuccess}
        onClick={() => save.mutate()}
      >
        {save.isSuccess ? copy.saved : save.isPending ? copy.saving : copy.save}
      </Button>
      {save.isError ? <p role="alert" className="text-sm text-destructive">{save.error instanceof ApiError && save.error.status === 409 ? copy.writingChanged : copy.writingError}</p> : null}
    </div>
  );
}

function ItemList({ title, items }: { title: string; items: unknown[] }) {
  const rows = items
    .map((item) => ({ label: recordItemLabel(item), url: recordItemUrl(item) }))
    .filter((row) => row.label !== '' || row.url !== null);
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
        {rows.map((row, index) => (
          <li key={index}>
            {row.url ? (
              <a className="underline underline-offset-4" href={row.url} target="_blank" rel="noreferrer">
                {row.label || row.url}
              </a>
            ) : row.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
