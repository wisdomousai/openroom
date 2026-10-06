/**
 * Session-wide audience Q&A: ask as many questions as you like, see everyone's
 * visible questions sorted by votes, upvote each once. Open for the whole
 * session — this view is reachable from the session tab bar regardless of which
 * poll is currently on stage.
 */
import { useState } from 'react';
import type { ParticipantQnaView } from '@openroom/sdk';

interface Props {
  qna: ParticipantQnaView;
  frozen: boolean;
  busy: boolean;
  onAsk: (text: string) => void;
  onUpvote: (questionId: string) => void;
}

export function SessionQna({ qna, frozen, busy, onAsk, onUpvote }: Props) {
  const [text, setText] = useState('');
  const valid = text.trim().length > 0;
  const max = qna.maxLength;

  return (
    <section className="stack">
      {frozen ? (
        <p className="hint">Paused</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || busy) return;
            onAsk(text.trim());
            setText('');
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="session-qna-input">
              Ask a question
            </label>
            <textarea
              id="session-qna-input"
              className="textarea"
              value={text}
              maxLength={max}
              aria-describedby="session-qna-counter"
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <span id="session-qna-counter" className="counter">
              {text.length} / {max} characters
            </span>
          </div>
          <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
            {busy ? 'Sending…' : 'Send question'}
          </button>
        </form>
      )}

      <h2 className="field__label" id="session-qna-heading">
        Questions ({qna.questions.length})
      </h2>
      <ul className="qna" aria-labelledby="session-qna-heading">
        {qna.questions.map((question) => (
          <li
            className={`qna__item${question.own ? ' qna__item--own' : ''}`}
            key={question.id}
          >
            <div className="qna__text">
              {question.own ? <span className="qna__own-tag">Your question</span> : null}
              <div>{question.text}</div>
              {question.handle && !question.own ? (
                <span className="qna__handle">{question.handle}</span>
              ) : null}
              {question.hidden ? (
                <p className="hint">Hidden</p>
              ) : null}
            </div>
            <button
              type="button"
              className="qna__vote"
              disabled={busy || frozen || question.votedByYou || question.hidden}
              aria-label={`Upvote: ${question.text}. ${question.votes} votes${question.votedByYou ? ', you upvoted this' : ''}.`}
              onClick={() => onUpvote(question.id)}
            >
              <span aria-hidden="true">▲</span>
              <span aria-hidden="true">{question.votes}</span>
              <small aria-hidden="true">{question.votedByYou ? 'voted' : 'votes'}</small>
            </button>
          </li>
        ))}
      </ul>
      {qna.questions.length === 0 && !frozen ? (
        <p className="hint">No questions yet.</p>
      ) : null}
    </section>
  );
}
