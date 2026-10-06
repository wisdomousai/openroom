import { useEffect, useRef, useState } from 'react';
import { useSessionTheme } from './theme';

interface Props {
  initialCode: string;
  busy: boolean;
  error: string | null;
  onJoin: (code: string) => void;
  onRecover: (code: string, handle: string) => void;
}

/** Join codes are Crockford-base32-ish: letters + digits, no spaces. */
const CLEAN = /[^A-Z0-9]/g;

export function JoinScreen({ initialCode, busy, error, onJoin, onRecover }: Props) {
  // Before a session is joined there is no session theme yet — the default one it is.
  useSessionTheme(null);
  const [code, setCode] = useState(initialCode);
  const [recovering, setRecovering] = useState(false);
  const [handle, setHandle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);

  useEffect(() => {
    if (!initialCode) inputRef.current?.focus();
  }, [initialCode]);

  useEffect(() => {
    if (recovering) handleRef.current?.focus();
  }, [recovering]);

  const ready = code.length === 8 && !busy;
  const recoveryReady = ready && handle.trim().length >= 3;

  return (
    <main className="page">
      <div className="topbar">
        <span className="brand">OpenRoom</span>
      </div>

      <div className="join">
        <h1 className="prompt">Join</h1>
        <p className="hint">8-character code</p>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (recovering) {
              if (recoveryReady) onRecover(code, handle.trim());
            } else if (ready) {
              onJoin(code);
            }
          }}
        >
          <div className="field">
            <label className="sr-only" htmlFor="session-code">
              Join code
            </label>
            <input
              id="session-code"
              ref={inputRef}
              className="input input--code"
              value={code}
              onInput={(e) =>
                setCode((e.currentTarget.value || '').toUpperCase().replace(CLEAN, '').slice(0, 8))
              }
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={8}
              aria-describedby="code-help"
              aria-invalid={error ? 'true' : 'false'}
              enterKeyHint="go"
            />
            <p id="code-help" className="hint hint--center">
              {code.length}/8 characters
            </p>
          </div>

          {!recovering ? (
            <>
              <button className="btn btn--primary btn--wide" type="submit" disabled={!ready}>
                {busy ? 'Joining…' : 'Join'}
              </button>
              <button
                className="btn btn--text btn--wide"
                type="button"
                disabled={!ready}
                onClick={() => setRecovering(true)}
              >
                Rejoin with handle
              </button>
            </>
          ) : (
            <div className="stack">
              <div className="field">
                <label className="field__label" htmlFor="session-handle">
                  Handle
                </label>
                <input
                  id="session-handle"
                  ref={handleRef}
                  className="input"
                  value={handle}
                  onInput={(e) => setHandle(e.currentTarget.value.slice(0, 64))}
                  autoCapitalize="words"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  placeholder="Amber Fox 4827"
                />
              </div>
              <button className="btn btn--primary btn--wide" type="submit" disabled={!recoveryReady}>
                {busy ? 'Rejoining…' : 'Rejoin'}
              </button>
              <button
                className="btn btn--ghost btn--wide"
                type="button"
                disabled={busy}
                onClick={() => setRecovering(false)}
              >
                Back
              </button>
            </div>
          )}
        </form>

        <div role="status" aria-live="polite">
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </div>
    </main>
  );
}
