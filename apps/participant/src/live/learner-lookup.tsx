import { useEffect, useRef, useState } from 'react';
import { DictionaryTable } from '@openroom/slides';
import type { DictionaryEntry } from '@openroom/schema';

/**
 * The learner's own word lookup.
 *
 * Private to this phone: it publishes nothing, no one else sees it, and it is
 * not recorded. This reverses the older rule that students never get a
 * translate control — a learner reading a foreign sentence needs the same
 * affordance the tutor has. What stays tutor-only is putting something on the
 * wall.
 */
interface LookupResult {
  entry: DictionaryEntry | null;
  meaning: string | null;
  unsupported?: 'language' | 'meaning-language';
}

export function LearnerLookup({
  baseUrl,
  sessionCode,
  token,
  word,
  returnFocus,
  onClose,
}: {
  baseUrl: string;
  sessionCode: string;
  token: string;
  word: string;
  /** The tapped word: focus goes back to it when the sheet closes. */
  returnFocus?: Element | null;
  onClose: () => void;
}) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeLatest = useRef(onClose);
  closeLatest.current = onClose;
  const returnLatest = useRef(returnFocus);
  returnLatest.current = returnFocus;

  // The sheet is not modal: the sentence stays tappable and a second tap
  // replaces the word. It still takes focus, and Escape closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeLatest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      focusBack(returnLatest.current);
    };
  }, []);

  // Each new word moves focus to the sheet, so it is announced.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [word]);

  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    void fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionCode)}/dictionary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ word }),
    })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          const code = await res
            .json()
            .then((body: { error?: unknown }) => (typeof body?.error === 'string' ? body.error : undefined))
            .catch(() => undefined);
          if (live) setError(lookupError(res.status, code));
          return;
        }
        const body = (await res.json()) as LookupResult;
        if (live) setResult(body);
      })
      .catch(() => {
        if (live) setError('Lookup failed. Check the connection and try again.');
      });
    return () => {
      live = false;
    };
  }, [baseUrl, sessionCode, token, word]);

  return (
    <div className="learner-lookup" role="dialog" aria-label={`Dictionary: ${word}`}>
      <div className="learner-lookup__bar">
        <strong>{word}</strong>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {error !== null ? <p className="learner-lookup__note">{error}</p> : null}
      {error === null && result === null ? (
        <p className="learner-lookup__note">Looking up…</p>
      ) : null}
      {result !== null ? (
        <>
          {result.meaning !== null ? (
            <p className="learner-lookup__meaning">{result.meaning}</p>
          ) : null}
          {result.entry !== null ? (
            <DictionaryTable entry={result.entry} highlight={word} showSenses />
          ) : error === null ? (
            <p className="learner-lookup__note">No entry found.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** What the learner can do about a refused lookup, by the route's error code. */
export function lookupError(status: number, code: string | undefined): string {
  if (status === 429 || code === 'lookup-rate-limited') return 'Lookup limit reached. Try again in a minute.';
  if (code === 'invalid-word') return 'This word cannot be looked up. Tap a single word.';
  if (code === 'languages-not-configured' || status === 404) return 'No dictionary for this session.';
  return 'Lookup failed. Try again.';
}

function focusBack(target: Element | null | undefined): void {
  if (!(target instanceof HTMLElement) || !target.isConnected) return;
  // A word token is a span: it takes focus only for this hand-back.
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}
