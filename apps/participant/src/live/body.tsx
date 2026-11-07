import type { AnswerInput, ParticipantSnapshot } from '@openroom/sdk';
import { splitFillTheGapsPrompt } from '@openroom/schema';
import {
  AnswerForm,
  DontKnowButton,
  QnaForm,
  describeAnswer,
  promptFontStyle,
  FillTheGapsOwnResult,
} from '../answer';
import { SpanText } from '@openroom/slides';
import { Results } from '../results';
import { CountdownLabel } from './countdown';
import { StepView, type ContentView } from './step-view';

/**
 * The prompt as the author wrote it, styled when the interaction carries spans.
 * A fill-the-gaps prompt never does — the ballot draws its blanks itself.
 */
function Prompt({ interaction, gaps }: { interaction: ParticipantSnapshot['interaction']; gaps?: Record<string, string> }) {
  const spans = interaction?.promptSpans;
  if (interaction === null || interaction === undefined) return null;
  if (interaction.type === 'fill-the-gaps') return <>{splitFillTheGapsPrompt(interaction.prompt).map((token, index) =>
    <span key={index}>{token.kind === 'text' ? token.text : gaps?.[token.id] || '____'}</span>,
  )}</>;
  if (spans === undefined) return <>{interaction.prompt}</>;
  return <SpanText spans={spans} />;
}

/** The lesson language, where the author declared one for typed answers. */
function lessonLocale(interaction: NonNullable<ParticipantSnapshot['interaction']>): string | undefined {
  return interaction.type === 'text' || interaction.type === 'fill-the-gaps'
    ? interaction.match?.locale
    : undefined;
}

interface BodyProps {
  snapshot: ParticipantSnapshot;
  participantId: string;
  join?: { url: string; code: string };
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onAnswer: (answer: AnswerInput) => void;
  onVote: (targetParticipantId: string) => void;
  /** Slide or Reading, as the learner last chose; null before any choice. */
  view: ContentView | null;
  onView: (view: ContentView) => void;
  /** Absent unless the learner has a lookup in this session. */
  onLookUp?: (word: string, token: Element) => void;
}

export function Body({
  snapshot,
  participantId,
  join,
  busy,
  editing,
  onEdit,
  onAnswer,
  onVote,
  view,
  onView,
  onLookUp,
}: BodyProps) {
  if (snapshot.status === 'ended') {
    return (
      <section className="waiting" aria-live="polite">
        <p className="waiting__title">Session ended</p>
        {snapshot.identityMode === 'identified' ? (
          <p className="hint">Your personal link opens your lesson page.</p>
        ) : null}
        <p className="hint">You can close this page.</p>
      </section>
    );
  }

  const interaction = snapshot.interaction;

  if (snapshot.status === 'lobby' || !interaction) {
    // A tutoring session is on a step even when no question is open, and the
    // learner is following that step on their own screen — so show it rather
    // than "waiting for the next question", which would be untrue.
    const step = snapshot.status === 'lobby' ? undefined : snapshot.outline?.currentStep;
    if (step !== undefined) {
      return (
        <StepView
          design={snapshot.outline?.design}
          hiddenParts={snapshot.outline?.hiddenParts}
          step={step}
          lane={snapshot.outline?.yourLane}
          marks={snapshot.marks}
          meaning={snapshot.meaning}
          dictionary={snapshot.dictionary}
          clock={snapshot.clock}
          join={join}
          view={view}
          onView={onView}
          onLookUp={onLookUp}
        />
      );
    }
    return (
      <section className="waiting" aria-live="polite">
        <span className="waiting__dot" aria-hidden="true" />
        <p className="waiting__title">
          {snapshot.status === 'lobby' ? 'Waiting to start' : 'Waiting for the next question'}
        </p>
      </section>
    );
  }

  const round2 = snapshot.round === 2;
  const peer =
    interaction.type === 'choice' &&
    (interaction as { peerInstruction?: boolean }).peerInstruction === true;
  const discuss =
    peer && snapshot.interactionStatus === 'closed' && (snapshot.round ?? 1) === 1 && !snapshot.aggregate;
  /** The question takes answers; a pause stops sending but keeps what is typed. */
  const accepting = snapshot.interactionStatus === 'open';
  const paused = accepting && snapshot.frozen;
  const open = accepting && !snapshot.frozen;
  const allowChange = interaction.allowAnswerChange !== false;
  const answered = snapshot.answered && snapshot.ownAnswer !== null;
  const groupQuestion = interaction.responseMode === 'group';
  const canAnswer = !groupQuestion || snapshot.yourGroup?.isSpokesperson === true;
  // The form stays mounted through a pause, disabled, so a half-typed answer is
  // still there when the tutor resumes.
  const showForm = accepting && canAnswer && (!answered || editing);

  if (interaction.type === 'qna') {
    const entries = snapshot.aggregate?.kind === 'qna' ? snapshot.aggregate.entries : [];
    const visible = entries.filter((e) => !e.hidden);
    return (
      <section className="stack">
        <h1 className="prompt"><Prompt interaction={interaction} /></h1>
        {open ? <CountdownLabel closesAt={snapshot.closesAt} /> : null}
        {accepting ? (
          <fieldset className="answer-fieldset" disabled={paused}>
            <QnaForm busy={busy} onSubmit={onAnswer} />
          </fieldset>
        ) : (
          <p className="hint">Closed</p>
        )}
        {paused ? <p className="hint">Answers paused.</p> : null}
        <h2 className="field__label" id="qna-heading">
          Questions ({visible.length})
        </h2>
        <ul className="qna" aria-labelledby="qna-heading">
          {visible.map((e, i) => {
            const own = e.participantId === participantId;
            return (
              <li className={`qna__item${own ? ' qna__item--own' : ''}`} key={`${e.participantId}-${i}`}>
                <div className="qna__text">
                  {own ? <span className="qna__own-tag">Your question</span> : null}
                  <div>{e.text}</div>
                </div>
                <button
                  type="button"
                  className="qna__vote"
                  disabled={busy || !open || own}
                  aria-label={`Upvote: ${e.text}. ${e.votes} votes.`}
                  onClick={() => onVote(e.participantId)}
                >
                  <span aria-hidden="true">▲</span>
                  <span aria-hidden="true">{e.votes}</span>
                  <small aria-hidden="true">votes</small>
                </button>
              </li>
            );
          })}
        </ul>
        {visible.length === 0 ? <p className="hint">No questions yet.</p> : null}
      </section>
    );
  }

  return (
    <section className="stack">
      {discuss ? (
        <div className="round" role="status">
          <p className="round__title">
            <span className="round__badge">Discuss</span>
            Talk it through, then vote again.
          </p>
        </div>
      ) : null}
      {round2 ? (
        <div className="round" role="status">
          <p className="round__title">
            <span className="round__badge">Second vote</span>
            Vote again.
          </p>
          {snapshot.ownRound1Answer ? (
            <p className="round__recall">
              First vote:{' '}
              <span className="round__recall-value">
                {describeAnswer(interaction, snapshot.ownRound1Answer)}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      <h1
        className={interaction.type === 'fill-the-gaps' && showForm ? 'sr-only' : 'prompt'}
        lang={lessonLocale(interaction)}
        style={
          interaction.type === 'fill-the-gaps' ? promptFontStyle(interaction.promptFont) : undefined
        }
      >
        <Prompt interaction={interaction} gaps={snapshot.ownAnswer?.kind === 'fill-the-gaps' ? snapshot.ownAnswer.gaps : undefined} />
      </h1>
      {open ? <CountdownLabel closesAt={snapshot.closesAt} /> : null}

      {groupQuestion ? (
        <div className="round" role="status">
          <p className="round__title">{snapshot.yourGroup?.name ?? 'Group response'}</p>
          <p className="hint">{!snapshot.yourGroup
            ? 'Your host will assign you to a group.'
            : canAnswer
              ? 'You are the spokesperson. Discuss together, then send one shared answer.'
              : 'Discuss together. Your spokesperson sends the shared answer.'}</p>
        </div>
      ) : null}

      {showForm ? (
        <fieldset className="answer-fieldset" disabled={paused}>
          <AnswerForm key={groupQuestion ? snapshot.yourGroup?.id : interaction.id}
            interaction={interaction}
            ownAnswer={snapshot.ownAnswer}
            participantId={participantId}
            busy={busy}
            onSubmit={onAnswer}
          />
          {interaction.allowDontKnow ? <DontKnowButton busy={busy} onSubmit={onAnswer} /> : null}
        </fieldset>
      ) : null}
      {showForm && paused ? (
        <p className="hint" aria-live="polite">Answers paused.</p>
      ) : null}

      {answered && !showForm ? (
        <div className="stack" aria-live="polite">
          <p className="ack">
            <span aria-hidden="true">✓</span>
            <span>{groupQuestion ? 'Group answer received' : 'Answer received'}</span>
          </p>
          {snapshot.ownAnswer ? (
            <p className="hint">
              Answered: <span className="ack__answer">{describeAnswer(interaction, snapshot.ownAnswer)}</span>
            </p>
          ) : null}
          {open && allowChange && canAnswer ? (
            <button type="button" className="btn btn--secondary btn--wide" onClick={onEdit} disabled={busy}>
              Change answer
            </button>
          ) : null}
          {open && !allowChange ? <p className="hint">Answer locked for this question.</p> : null}
        </div>
      ) : null}

      {!showForm && !open && !answered ? (
        <p className="hint" aria-live="polite">
          {snapshot.frozen ? 'Answers paused.' : 'Question closed.'}
        </p>
      ) : null}

      {/* No answers yet: an empty chart says nothing a one-learner lesson needs. */}
      {snapshot.aggregate && snapshot.aggregate.total > 0 ? (
        snapshot.identityMode === 'identified' &&
        interaction.type === 'fill-the-gaps' &&
        snapshot.interactionStatus === 'revealed' &&
        snapshot.ownAnswer?.kind === 'fill-the-gaps' ? (
          <FillTheGapsOwnResult interaction={interaction} ownAnswer={snapshot.ownAnswer} />
        ) : (
          <Results
            interaction={interaction}
            aggregate={snapshot.aggregate}
            revealed={snapshot.interactionStatus === 'revealed'}
            round1Aggregate={snapshot.round1Aggregate ?? null}
          />
        )
      ) : null}
    </section>
  );
}
