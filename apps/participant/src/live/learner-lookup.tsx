import { useEffect, useState } from 'react';
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
  onClose,
}: {
  baseUrl: string;
  sessionCode: string;
  token: string;
  word: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (res.status === 429) {
          setError('Lookup limit reached.');
          return;
        }
        if (!res.ok) {
          setError('No dictionary for this session.');
          return;
        }
        setResult((await res.json()) as LookupResult);
      })
      .catch(() => {
        if (live) setError('Lookup failed.');
      });
    return () => {
      live = false;
    };
  }, [baseUrl, sessionCode, token, word]);

  return (
    <div className="learner-lookup" role="dialog" aria-label={`Dictionary: ${word}`}>
      <div className="learner-lookup__bar">
        <strong>{word}</strong>
        <button type="button" onClick={onClose} aria-label="Close">
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
