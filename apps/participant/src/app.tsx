import { useCallback, useEffect, useRef, useState } from 'react';
import { joinSession } from '@openroom/sdk';
import { JoinScreen } from './join';
import { joinErrorMessage } from './join-error';
import { LiveScreen } from './live/screen';
import {
  clearSession,
  forgetLinkInUrl,
  forgetSessionInUrl,
  loadSession,
  loadSessionByCode,
  readContextLink,
  readRosterInvite,
  readQuery,
  rememberSessionInUrl,
  saveSession,
  type StoredSession,
} from './session';

const BASE_URL = '';

export function App() {
  const [session, setSession] = useState<StoredSession | null>(() => {
    const { session: fromUrl } = readQuery();
    return fromUrl ? loadSession(fromUrl) : null;
  });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState('');
  const autoJoined = useRef(false);

  const doJoin = useCallback(async (code: string, recoveryHandle?: string) => {
    setJoining(true);
    setError(null);
    try {
      const normalizedCode = code.trim().toUpperCase();
      if (recoveryHandle === undefined) {
        const existing = loadSessionByCode(normalizedCode);
        if (existing) {
          rememberSessionInUrl(existing.sessionCode);
          setSession(existing);
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
      const contextLink = readContextLink();
      const rosterInvite = readRosterInvite();
      const result = await joinSession(BASE_URL, normalizedCode, {
        ...(recoveryHandle === undefined ? {} : { recoveryHandle }),
        ...(contextLink === null ? {} : { contextLink }),
        ...(rosterInvite === null ? {} : { rosterInvite }),
      });
      if (contextLink !== null) forgetLinkInUrl();
      const next: StoredSession = {
        sessionCode: result.sessionCode,
        code: normalizedCode,
        token: result.participantToken,
        participantId: result.participantId,
        ...(result.handle === undefined ? {} : { handle: result.handle }),
      };
      saveSession(next);
      rememberSessionInUrl(next.sessionCode);
      setSession(next);
    } catch (err) {
      setError(joinErrorMessage(err));
    } finally {
      setJoining(false);
    }
  }, []);

  // A repeat QR scan resumes automatically when this browser kept its durable
  // session capability. Otherwise the prefilled screen leaves space for manual
  // handle recovery before a new participant is created.
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
    if ((readContextLink() !== null || readRosterInvite() !== null) && !autoJoined.current) {
      autoJoined.current = true;
      void doJoin(code);
    }
  }, [session, doJoin]);

  const leave = useCallback(() => {
    if (session) clearSession(session);
    forgetSessionInUrl();
    setSession(null);
  }, [session]);

  if (!session) {
    return (
      <JoinScreen
        initialCode={prefill}
        busy={joining}
        error={error}
        onJoin={(code) => void doJoin(code)}
        onRecover={(code, handle) => void doJoin(code, handle)}
      />
    );
  }

  return <LiveScreen baseUrl={BASE_URL} session={session} onLeave={leave} />;
}
