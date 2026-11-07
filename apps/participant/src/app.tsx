import { useCallback, useEffect, useRef, useState } from 'react';
import { joinSession } from '@openroom/sdk';
import { GoneScreen, JoinScreen, WaitingToStartScreen } from './join';
import { isNotStarted, isTransient, joinErrorMessage } from './join-error';
import { LiveScreen } from './live/screen';
import {
  clearSession,
  forgetLinkInUrl,
  forgetSessionInUrl,
  loadSession,
  loadSessionByCode,
  readContextLink,
  readGuestLink,
  readQuery,
  rememberSessionInUrl,
  saveSession,
  type StoredSession,
} from './session';

const BASE_URL = '';

/** First retry of a link arrival that came before the tutor pressed start. */
const START_RETRY_MS = 5_000;
const START_RETRY_MAX_MS = 30_000;

export function App() {
  const [session, setSession] = useState<StoredSession | null>(() => {
    const { session: fromUrl } = readQuery();
    return fromUrl ? loadSession(fromUrl) : null;
  });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState('');
  /** A link arrival the session turned away because the tutor has not started yet. */
  const [waitingForStart, setWaitingForStart] = useState(false);
  /** The stored seat was refused; `identityMode` says how to come back. */
  const [gone, setGone] = useState<{ identityMode?: string } | null>(null);
  const autoJoined = useRef(false);
  const joiningRef = useRef(false);
  const waitingRef = useRef(false);
  waitingRef.current = waitingForStart;

  const doJoin = useCallback(async (code: string, recoveryName?: string) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    setError(null);
    const contextLink = readContextLink();
    const guestLink = readGuestLink();
    try {
      const normalizedCode = code.trim().toUpperCase();
      if (recoveryName === undefined) {
        const existing = loadSessionByCode(normalizedCode);
        if (existing) {
          rememberSessionInUrl(existing.sessionCode);
          setSession(existing);
          setWaitingForStart(false);
          return;
        }
      }

      /*
       * A tutoring learner arrives on `?code=…&link=orlnk_…`. The link is the
       * only way into an identified session, and it is used exactly here: sent
       * once with the join, then dropped from the URL. It is never written to
       * storage next to the session token — the session capability that comes back is
       * scoped to one session, the link is scoped to a person’s whole history.
       */
      const result = await joinSession(BASE_URL, normalizedCode, {
        ...(recoveryName === undefined ? {} : { recoveryName }),
        ...(contextLink === null ? {} : { contextLink }),
        ...(guestLink === null ? {} : { guestLink }),
      });
      if (contextLink !== null) forgetLinkInUrl();
      const next: StoredSession = {
        sessionCode: result.sessionCode,
        code: normalizedCode,
        token: result.participantToken,
        participantId: result.participantId,
        ...(result.name === undefined ? {} : { name: result.name }),
        ...(result.identityMode === undefined ? {} : { identityMode: result.identityMode }),
      };
      saveSession(next);
      rememberSessionInUrl(next.sessionCode);
      setWaitingForStart(false);
      setSession(next);
    } catch (err) {
      // Arriving by link before the tutor starts is not an error: wait, and
      // the retry below joins once the session is live. The gate itself is
      // unchanged — the session keeps refusing until then. A dropped
      // connection or a server fault while waiting keeps waiting too.
      const byLink = contextLink !== null || guestLink !== null;
      if (byLink && (isNotStarted(err) || (waitingRef.current && isTransient(err)))) {
        setWaitingForStart(true);
      } else {
        setWaitingForStart(false);
        setError(joinErrorMessage(err));
      }
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }, []);

  // A repeat QR scan resumes automatically when this browser kept its durable
  // session capability. Otherwise the prefilled screen leaves space for manual
  // name recovery before a new participant is created.
  useEffect(() => {
    if (session) return;
    const { code } = readQuery();
    if (!code) return;
    setPrefill(code);
    const existing = loadSessionByCode(code);
    if (existing) {
      rememberSessionInUrl(existing.sessionCode);
      setSession(existing);
      return;
    }
    // Arriving on an access link: the learner has nothing to choose here — the
    // link already says who they are — so the join screen is skipped entirely.
    if ((readContextLink() !== null || readGuestLink() !== null) && !autoJoined.current) {
      autoJoined.current = true;
      void doJoin(code);
    }
  }, [session, doJoin]);

  // Retry a waiting link arrival while the tab is visible, slower each time.
  useEffect(() => {
    if (!waitingForStart || session || prefill === '') return;
    let delay = START_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      if (document.visibilityState === 'visible') void doJoin(prefill);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        attempt();
        delay = Math.min(START_RETRY_MAX_MS, Math.round(delay * 1.5));
        schedule();
      }, delay);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [waitingForStart, session, prefill, doJoin]);

  const leave = useCallback(() => {
    if (session) clearSession(session);
    forgetSessionInUrl();
    setSession(null);
  }, [session]);

  // The server refused the stored seat for good. Forget it, so a reload does
  // not loop on a dead token, and say how to come back.
  const seatGone = useCallback((identityMode: string | undefined) => {
    if (session) clearSession(session);
    forgetSessionInUrl();
    setGone(identityMode === undefined ? {} : { identityMode });
    setSession(null);
  }, [session]);

  if (!session && waitingForStart) return <WaitingToStartScreen />;

  if (!session && gone) {
    return <GoneScreen identityMode={gone.identityMode} onJoinWithCode={() => setGone(null)} />;
  }

  if (!session) {
    return (
      <JoinScreen
        initialCode={prefill}
        busy={joining}
        error={error}
        onJoin={(code) => void doJoin(code)}
        onRecover={(code, name) => void doJoin(code, name)}
      />
    );
  }

  return <LiveScreen baseUrl={BASE_URL} session={session} onLeave={leave} onGone={seatGone} />;
}
