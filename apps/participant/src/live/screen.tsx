import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSessionClient,
  type AnswerInput,
  type ConnectionStatus,
  type ParticipantSnapshot,
  type SessionClient,
} from '@openroom/sdk';
import { useSessionTheme } from '../theme';
import type { StoredSession } from '../session';
import { Body } from './body';
import { LearnerLookup } from './learner-lookup';
import { SessionQna } from '../qna';

interface Props {
  baseUrl: string;
  session: StoredSession;
  onLeave: () => void;
}

export function LiveScreen({ baseUrl, session, onLeave }: Props) {
  const [snapshot, setSnapshot] = useState<ParticipantSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 'now' = the active poll; 'qna' = the session-wide question list. */
  const [view, setView] = useState<'now' | 'qna'>('now');
  /** The word this learner is looking up. Nobody else ever learns it. */
  const [lookUpWord, setLookUpWord] = useState<string | null>(null);
  const clientRef = useRef<SessionClient<ParticipantSnapshot> | null>(null);
  // The host can switch the session theme mid-session; every snapshot re-applies it.
  useSessionTheme(snapshot?.theme);
  const lastInteractionId = useRef<string | null>(null);

  useEffect(() => {
    const client = createSessionClient<ParticipantSnapshot>({
      baseUrl,
      sessionCode: session.sessionCode,
      token: session.token,
      role: 'participant',
      onChange: setSnapshot,
      onStatus: setStatus,
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [baseUrl, session.sessionCode, session.token]);

  const interaction = snapshot?.interaction ?? null;

  // Self-service lookup is restricted to identified seats by the session API.
  const canLookUp = snapshot?.identityMode === 'identified';

  // A new question always starts in "answering" mode.
  useEffect(() => {
    const id = interaction?.id ?? null;
    if (id !== lastInteractionId.current) {
      lastInteractionId.current = id;
      setEditing(false);
      setError(null);
    }
  }, [interaction?.id]);

  async function submitAnswer(answer: AnswerInput): Promise<void> {
    const client = clientRef.current;
    if (!client || !interaction) return;
    setBusy(true);
    setError(null);
    const res = await client.submit({
      command: 'answer.submit',
      interactionId: interaction.id,
      answer,
      ...(interaction.responseMode === 'group' ? { groupId: snapshot?.yourGroup?.id } : {}),
    });
    setBusy(false);
    if (res.ok) setEditing(false);
    else setError(friendlyError(res.error.code, res.error.message));
  }

  async function voteFor(targetParticipantId: string): Promise<void> {
    const client = clientRef.current;
    if (!client || !interaction) return;
    setBusy(true);
    const res = await client.submit({
      command: 'qna.vote',
      interactionId: interaction.id,
      targetParticipantId,
    });
    setBusy(false);
    if (!res.ok) setError(friendlyError(res.error.code, res.error.message));
  }

  async function askSessionQuestion(text: string): Promise<void> {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    const res = await client.submit({
      command: 'qna.ask',
      questionId: crypto.randomUUID(),
      text,
    });
    setBusy(false);
    if (!res.ok) setError(friendlyError(res.error.code, res.error.message));
  }

  async function upvoteSessionQuestion(questionId: string): Promise<void> {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    const res = await client.submit({ command: 'qna.upvote', questionId });
    setBusy(false);
    if (!res.ok) setError(friendlyError(res.error.code, res.error.message));
  }

  const connectionNotice = useMemo(() => {
    if (status === 'offline') return 'Offline — reconnecting…';
    if (status === 'connecting' && snapshot) return 'Reconnecting…';
    return null;
  }, [status, snapshot]);

  // Pseudonymous sessions: the session-local handle, from the join response or (after
  // a reload with an older stored session) from the snapshot.
  const handle = session.handle ?? snapshot?.yourHandle;
  const participantLabel = handle ?? snapshot?.yourLabel;
  const [noticeSeen, setNoticeSeen] = useState(() => wasNoticeSeen(session.sessionCode));

  return (
    <main className="page" data-session>
      <div className="topbar">
        <span className="brand">OpenRoom</span>
        {participantLabel ? (
          <span className="handle" title="Your session name">
            <strong>{participantLabel}</strong>
          </span>
        ) : null}
        <button type="button" className="btn btn--leave" onClick={onLeave}>
          Leave
        </button>
      </div>

      {/* The pseudonymous-handle notice promises no name is collected, which is
          not true of a tutoring session: the tutor already knows the learner. */}
      {snapshot?.identityMode === 'pseudonymous' && handle && !noticeSeen ? (
        <div className="notice" role="status">
          <p className="notice__text">
            Handle: <strong>{handle}</strong>. Use it to rejoin. Answers are deleted 30 minutes
            after the session ends.
          </p>
          <button
            type="button"
            className="btn btn--gotit"
            onClick={() => {
              markNoticeSeen(session.sessionCode);
              setNoticeSeen(true);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* One wrapper, two behaviours: `display: contents` on the phone (the
          column is exactly what it was), a scrolling content region on the
          tutoring surface, where the action region below stays put.
          Ink is NOT mounted here — `display: contents` has no box, so an
          absolute overlay would float against the wrong frame. Ink sits on
          the slide plate itself (see StepView). */}
      <div className="page__body">
      <div aria-live="polite" className="stack">
        {connectionNotice ? (
          <p className="banner banner--offline">
            <span aria-hidden="true">⚠</span>
            {connectionNotice}
          </p>
        ) : null}
        {snapshot?.frozen ? (
          <p className="banner banner--paused">
            <span aria-hidden="true">⏸</span> Paused
          </p>
        ) : null}
        {error ? <p className="banner banner--error">{error}</p> : null}
      </div>

      {!snapshot ? (
        <div className="waiting">
          <span className="waiting__dot" aria-hidden="true" />
          <p className="waiting__title">Connecting…</p>
        </div>
      ) : (
        <>
          {snapshot.qna && snapshot.status !== 'ended' ? (
            <div className="viewtabs" role="tablist" aria-label="Session views">
              <button
                type="button"
                role="tab"
                className={`viewtabs__tab${view === 'now' ? ' viewtabs__tab--active' : ''}`}
                aria-selected={view === 'now'}
                onClick={() => setView('now')}
              >
                Now
              </button>
              <button
                type="button"
                role="tab"
                className={`viewtabs__tab${view === 'qna' ? ' viewtabs__tab--active' : ''}`}
                aria-selected={view === 'qna'}
                onClick={() => setView('qna')}
              >
                Q&amp;A ({snapshot.qna.questions.filter((q) => !q.hidden).length})
              </button>
            </div>
          ) : null}
          {snapshot.qna && snapshot.status !== 'ended' && view === 'qna' ? (
            <SessionQna
              qna={snapshot.qna}
              frozen={snapshot.frozen}
              busy={busy}
              onAsk={(text) => void askSessionQuestion(text)}
              onUpvote={(id) => void upvoteSessionQuestion(id)}
            />
          ) : (
            <Body
              snapshot={snapshot}
              participantId={session.participantId}
              join={joinFromSession(baseUrl, session.code)}
              busy={busy}
              editing={editing}
              onEdit={() => setEditing(true)}
              onAnswer={(a) => void submitAnswer(a)}
              onVote={(id) => void voteFor(id)}
              onLookUp={canLookUp ? setLookUpWord : undefined}
            />
          )}
        </>
      )}
      </div>

      {lookUpWord === null ? null : (
        <LearnerLookup
          baseUrl={baseUrl}
          sessionCode={session.sessionCode}
          token={session.token}
          word={lookUpWord}
          onClose={() => setLookUpWord(null)}
        />
      )}
    </main>
  );
}

function joinFromSession(
  baseUrl: string,
  code: string | undefined,
): { url: string; code: string } | undefined {
  if (!code) return undefined;
  try {
    const url = new URL(baseUrl);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    url.searchParams.set('code', code);
    return { url: url.toString(), code };
  } catch {
    return { url: `${baseUrl.replace(/\/$/, '')}/?code=${encodeURIComponent(code)}`, code };
  }
}

const NOTICE_PREFIX = 'openroom:notice:';

function wasNoticeSeen(sessionCode: string): boolean {
  try {
    return sessionStorage.getItem(NOTICE_PREFIX + sessionCode) === '1';
  } catch {
    return false;
  }
}

function markNoticeSeen(sessionCode: string): void {
  try {
    sessionStorage.setItem(NOTICE_PREFIX + sessionCode, '1');
  } catch {
    /* private mode — the notice just reappears on reload */
  }
}

function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'E_FROZEN':
      return 'Answers paused.';
    case 'E_NOT_OPEN':
      return 'Question closed. Answer not counted.';
    case 'E_ENDED':
      return 'The session has ended.';
    case 'E_NETWORK':
      return 'No connection to the session.';
    case 'E_INVALID_ANSWER':
      return 'Answer not accepted.';
    case 'E_FORBIDDEN':
      return message.includes('upvoted')
        ? 'Already upvoted.'
        : message || 'Action not allowed.';
    default:
      return message || 'Request failed.';
  }
}
