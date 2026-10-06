import { useEffect, useRef, useState } from 'react';
import {
  gradeFillTheGaps,
  seededShuffle,
  splitFillTheGapsPrompt,
} from '@openroom/schema';
import type { AnswerInput, Ballot, InteractionView, TextSpanView } from '@openroom/sdk';
import { SpanText } from '@openroom/slides';

/** An option label as the author styled it, or the plain string when unstyled. */
function OptionLabel({ label, spans }: { label: string; spans?: TextSpanView[] }) {
  return spans === undefined ? <>{label}</> : <SpanText spans={spans} />;
}

/**
 * A fill-the-gaps prompt is drawn expanded from its `{{id}}` placeholders, so no
 * span list describes it: its styling is one family over the whole sentence.
 */
export function promptFontStyle(
  font: 'default' | 'display' | 'serif' | 'mono' | undefined,
): { fontFamily: string } | undefined {
  return font === undefined || font === 'default'
    ? undefined
    : { fontFamily: `var(--font-${font})` };
}

interface Props {
  interaction: InteractionView;
  ownAnswer: Ballot | null;
  busy: boolean;
  onSubmit: (answer: AnswerInput) => void;
}

export function AnswerForm(props: Props) {
  const { interaction } = props;
  switch (interaction.type) {
    case 'choice':
      return <ChoiceAnswer {...props} interaction={interaction} />;
    case 'scale':
      return <ScaleAnswer {...props} interaction={interaction} />;
    case 'numeric':
      return <NumericAnswer {...props} interaction={interaction} />;
    case 'text':
      return <TextAnswer {...props} interaction={interaction} />;
    case 'ranking':
      return <RankingAnswer {...props} interaction={interaction} />;
    case 'fill-the-gaps':
      return <FillTheGapsAnswer {...props} interaction={interaction} />;
    case 'match':
      return <MatchAnswer {...props} interaction={interaction} />;
    default:
      return null;
  }
}

export function DontKnowButton({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (answer: AnswerInput) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn--text btn--wide dont-know"
      disabled={busy}
      onClick={() => onSubmit({ kind: 'dont-know' })}
    >
      Don't know
    </button>
  );
}

/* ---------------------------------------------------------------- choice */

function ChoiceAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'choice' }> }) {
  const initial = ownAnswer?.kind === 'choice' ? ownAnswer.optionIds : [];
  const [selected, setSelected] = useState<string[]>(initial);
  const multiple = interaction.multiple === true;

  useEffect(() => {
    setSelected(ownAnswer?.kind === 'choice' ? ownAnswer.optionIds : []);
  }, [interaction.id, ownAnswer]);

  function toggle(id: string): void {
    if (multiple) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
      onSubmit({ kind: 'choice', optionIds: [id] });
    }
  }

  return (
    <div className="stack" role={multiple ? 'group' : 'radiogroup'} aria-label="Answer options">
      {interaction.options.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            className={`btn option ${multiple ? 'option--check' : 'option--radio'}`}
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on ? 'true' : 'false'}
            disabled={busy}
            onClick={() => toggle(opt.id)}
          >
            <span className="option__mark" aria-hidden="true">
              {on ? (multiple ? '✓' : '●') : ''}
            </span>
            <span>
              <OptionLabel label={opt.label} spans={opt.labelSpans} />
            </span>
          </button>
        );
      })}
      {multiple ? (
        <button
          type="button"
          className="btn btn--primary btn--wide"
          disabled={busy || selected.length === 0}
          onClick={() => onSubmit({ kind: 'choice', optionIds: selected })}
        >
          {busy ? 'Sending…' : `Send ${selected.length} selected`}
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- scale */

function ScaleAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'scale' }> }) {
  const values: number[] = [];
  for (let v = interaction.min; v <= interaction.max; v++) values.push(v);
  const current = ownAnswer?.kind === 'scale' ? ownAnswer.value : null;

  return (
    <div className="scale">
      <div className="scale__row" role="radiogroup" aria-label={`Scale from ${interaction.min} to ${interaction.max}`}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className="scale__dot"
            role="radio"
            aria-checked={current === v ? 'true' : 'false'}
            aria-label={`${v}${v === interaction.min && interaction.minLabel ? `, ${interaction.minLabel}` : ''}${
              v === interaction.max && interaction.maxLabel ? `, ${interaction.maxLabel}` : ''
            }`}
            disabled={busy}
            onClick={() => onSubmit({ kind: 'scale', value: v })}
          >
            {v}
          </button>
        ))}
      </div>
      {interaction.minLabel || interaction.maxLabel ? (
        <div className="scale__labels">
          <span>{interaction.minLabel ?? ''}</span>
          <span>{interaction.maxLabel ?? ''}</span>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- numeric */

function NumericAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'numeric' }> }) {
  const [text, setText] = useState(
    ownAnswer?.kind === 'numeric' ? String(ownAnswer.value) : '',
  );
  const parsed = Number(text.replace(',', '.'));
  const valid = text.trim().length > 0 && Number.isFinite(parsed);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit({ kind: 'numeric', value: parsed });
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="numeric-answer">
          Estimate{interaction.unit ? ` (${interaction.unit})` : ''}
        </label>
        <div className="unit">
          <input
            id="numeric-answer"
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            enterKeyHint="send"
            onInput={(e) => setText(e.currentTarget.value)}
          />
          {interaction.unit ? <span className="unit__suffix">{interaction.unit}</span> : null}
        </div>
      </div>
      <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Send answer'}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ text */

const ACCENT_STRIPS: Record<string, string> = {
  fr: 'à â é è ê ë ï î ô ù û ü ç œ æ',
  de: 'ä ö ü ß',
  es: 'á é í ó ú ü ñ ¿ ¡',
  it: 'à è é ì ò ù',
  pt: 'á â ã à ç é ê í ó ô õ ú',
};

function accentChars(locale: string | undefined): string[] {
  if (!locale) return [];
  const key = locale.slice(0, 2).toLowerCase();
  const row = ACCENT_STRIPS[key];
  return row ? row.split(' ') : [];
}

function TextAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'text' }> }) {
  const max = interaction.maxLength ?? 200;
  const [text, setText] = useState(ownAnswer?.kind === 'text' ? ownAnswer.text : '');
  const over = text.length > max;
  const valid = text.trim().length > 0 && !over;
  const accents = accentChars(interaction.match?.locale);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit({ kind: 'text', text: text.trim() });
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="text-answer">
          Answer
        </label>
        <textarea
          id="text-answer"
          className="textarea"
          value={text}
          maxLength={max}
          lang={interaction.match?.locale}
          aria-describedby="text-counter"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        {accents.length > 0 ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Accents">
            {accents.map((char) => (
              <button
                key={char}
                type="button"
                className="btn btn--ghost btn--compact"
                onClick={() => setText((current) => (current + char).slice(0, max))}
              >
                {char}
              </button>
            ))}
          </div>
        ) : null}
        <span id="text-counter" className={`counter${over ? ' counter--over' : ''}`}>
          {text.length} / {max} characters
        </span>
      </div>
      <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Send answer'}
      </button>
    </form>
  );
}

/* --------------------------------------------------------------- ranking */

/**
 * Order the interaction's options by a previously submitted ballot, keeping any
 * option the ballot did not mention at the end (defensive: a stored ballot is
 * always a complete permutation, but the UI must never drop an option).
 */
export function orderedBy(optionIds: string[], options: { id: string; label: string }[]): string[] {
  const known = new Set(options.map((o) => o.id));
  const ordered = optionIds.filter((id) => known.has(id));
  for (const option of options) if (!ordered.includes(option.id)) ordered.push(option.id);
  return ordered;
}

function RankingAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'ranking' }> }) {
  const initial = (): string[] =>
    ownAnswer?.kind === 'ranking'
      ? orderedBy(ownAnswer.optionIds, interaction.options)
      : interaction.options.map((o) => o.id);

  const [order, setOrder] = useState<string[]>(initial);
  const [announcement, setAnnouncement] = useState('');
  // A snapshot refetch hands back a fresh `ownAnswer` object on every revision
  // bump, so the reset below keys off the VALUE, not the object identity —
  // otherwise someone else answering would wipe an in-progress reorder.
  const submitted =
    ownAnswer?.kind === 'ranking' ? ownAnswer.optionIds.join('|') : '';
  // Keyboard operability: the button that performed a move travels with its
  // item, so focus is restored to it after the list re-renders.
  const focusKey = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setOrder(initial());
    setAnnouncement('');
  }, [interaction.id, submitted]);

  useEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    focusKey.current = null;
    buttons.current.get(key)?.focus();
  }, [order]);

  const optionFor = (id: string) => interaction.options.find((o) => o.id === id);
  const labelFor = (id: string): string => optionFor(id)?.label ?? id;

  function move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const moved = next[index] as string;
    next[index] = next[target] as string;
    next[target] = moved;
    focusKey.current = `${moved}:${delta === -1 ? 'up' : 'down'}`;
    setOrder(next);
    setAnnouncement(`${labelFor(moved)} moved to position ${target + 1} of ${next.length}.`);
  }

  return (
    <div className="stack">
      <ol className="ranking" aria-label="Your ranking, first place at the top">
        {order.map((id, index) => (
          <li className="ranking__item" key={id}>
            <span className="ranking__pos" aria-hidden="true">
              {index + 1}
            </span>
            <span className="ranking__label">
              <OptionLabel label={labelFor(id)} spans={optionFor(id)?.labelSpans} />
            </span>
            <span className="ranking__moves">
              <button
                type="button"
                className="ranking__move"
                ref={(el) => {
                  if (el) buttons.current.set(`${id}:up`, el);
                  else buttons.current.delete(`${id}:up`);
                }}
                disabled={busy || index === 0}
                aria-label={`Move ${labelFor(id)} up`}
                onClick={() => move(index, -1)}
              >
                <span aria-hidden="true">▲</span>
              </button>
              <button
                type="button"
                className="ranking__move"
                ref={(el) => {
                  if (el) buttons.current.set(`${id}:down`, el);
                  else buttons.current.delete(`${id}:down`);
                }}
                disabled={busy || index === order.length - 1}
                aria-label={`Move ${labelFor(id)} down`}
                onClick={() => move(index, 1)}
              >
                <span aria-hidden="true">▼</span>
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <p className="hint">First choice at the top.</p>
      <button
        type="button"
        className="btn btn--primary btn--wide"
        disabled={busy}
        onClick={() => onSubmit({ kind: 'ranking', optionIds: order })}
      >
        {busy ? 'Sending…' : 'Send ranking'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------- qna */

export function QnaForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (answer: AnswerInput) => void;
}) {
  const max = 300;
  const [text, setText] = useState('');
  const valid = text.trim().length > 0;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || busy) return;
        onSubmit({ kind: 'qna', text: text.trim() });
        setText('');
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="qna-input">
          Ask a question
        </label>
        <textarea
          id="qna-input"
          className="textarea"
          value={text}
          maxLength={max}
          aria-describedby="qna-counter"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <span id="qna-counter" className="counter">
          {text.length} / {max} characters
        </span>
      </div>
      <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Send question'}
      </button>
    </form>
  );
}

/** Human-readable echo of the participant's own accepted answer. */
export function describeAnswer(interaction: InteractionView, ballot: Ballot): string {
  switch (ballot.kind) {
    case 'dont-know':
      return "Don't know";
    case 'choice': {
      if (interaction.type !== 'choice') return ballot.optionIds.join(', ');
      const labels = ballot.optionIds.map(
        (id) => interaction.options.find((o) => o.id === id)?.label ?? id,
      );
      return labels.join(', ');
    }
    case 'scale':
      return String(ballot.value);
    case 'numeric':
      return interaction.type === 'numeric' && interaction.unit
        ? `${ballot.value} ${interaction.unit}`
        : String(ballot.value);
    case 'ranking': {
      if (interaction.type !== 'ranking') return ballot.optionIds.join(' → ');
      return ballot.optionIds
        .map((id) => interaction.options.find((o) => o.id === id)?.label ?? id)
        .join(' → ');
    }
    case 'text':
    case 'qna':
      return ballot.text;
    case 'fill-the-gaps':
      return Object.values(ballot.gaps).join(', ');
    case 'match': {
      if (interaction.type !== 'match') return Object.values(ballot.pairs).join(', ');
      return Object.entries(ballot.pairs)
        .map(([leftId, rightId]) => {
          const left = interaction.left.find((item) => item.id === leftId)?.label ?? leftId;
          const right = interaction.right.find((item) => item.id === rightId)?.label ?? rightId;
          return `${left} → ${right}`;
        })
        .join('; ');
    }
    default:
      return '';
  }
}

function FillTheGapsAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'fill-the-gaps' }> }) {
  const initial = ownAnswer?.kind === 'fill-the-gaps' ? ownAnswer.gaps : {};
  const [gaps, setGaps] = useState<Record<string, string>>(initial);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const gapRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    setGaps(ownAnswer?.kind === 'fill-the-gaps' ? ownAnswer.gaps : {});
    setOpenGap(null);
  }, [interaction.id, ownAnswer]);

  const tokens = splitFillTheGapsPrompt(interaction.prompt);
  const valid = interaction.gaps.every((gap) => (gaps[gap.id] ?? '').trim() !== '');
  const display = interaction.display ?? 'gaps';
  const selectable = display === 'bank' || display === 'choices';
  const bankWords = interaction.bankWords ?? [];
  const used = new Set(Object.values(gaps).filter((word) => word.trim() !== ''));

  function pick(gapId: string, word: string | null): void {
    setGaps((current) => {
      const next = { ...current };
      if (word === null || word === '') delete next[gapId];
      else next[gapId] = word;
      return next;
    });
    setOpenGap(null);
    queueMicrotask(() => gapRefs.current[gapId]?.focus());
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit({ kind: 'fill-the-gaps', gaps });
      }}
    >
      <p className="prompt" id="fill-the-gaps-prompt" style={promptFontStyle(interaction.promptFont)}>
        {tokens.map((token, index) => {
          if (token.kind === 'text') return <span key={index}>{token.text}</span>;
          const id = token.id;
          const filled = (gaps[id] ?? '').trim();
          if (!selectable) {
            return (
              <input
                key={id}
                className="input"
                aria-label={`Gap ${id}`}
                value={gaps[id] ?? ''}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setGaps((current) => ({ ...current, [id]: value }));
                }}
              />
            );
          }
          return (
            <button
              key={id}
              ref={(node) => {
                gapRefs.current[id] = node;
              }}
              type="button"
              className={`gap-slot${filled !== '' ? ' gap-slot--filled' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={openGap === id}
              aria-label={filled !== '' ? `Gap ${id}: ${filled}` : `Gap ${id}`}
              onClick={() => setOpenGap(id)}
            >
              {filled !== '' ? filled : '\u00a0'}
            </button>
          );
        })}
      </p>
      {selectable && openGap !== null ? (
        <GapPicker
          font={interaction.promptFont}
          options={
            display === 'choices'
              ? seededShuffle(
                  interaction.gaps.find((entry) => entry.id === openGap)?.options ?? [],
                  `${interaction.id}:${openGap}`,
                )
              : seededShuffle(bankWords, interaction.id)
          }
          used={used}
          value={gaps[openGap] ?? ''}
          onPick={(word) => pick(openGap, word)}
          onClose={() => {
            const id = openGap;
            setOpenGap(null);
            queueMicrotask(() => {
              if (id !== null) gapRefs.current[id]?.focus();
            });
          }}
        />
      ) : null}
      <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Send answer'}
      </button>
    </form>
  );
}

function GapPicker({
  options,
  used,
  value,
  font,
  onPick,
  onClose,
}: {
  options: string[];
  used: Set<string>;
  value: string;
  font?: 'default' | 'display' | 'serif' | 'mono';
  onPick: (word: string | null) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLButtonElement>('.option')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gap-picker" role="dialog" aria-modal="true" aria-label="Choose a word">
      <button type="button" className="gap-picker__backdrop" aria-label="Close" onClick={onClose} />
      <div className="gap-picker__panel" ref={panel} style={promptFontStyle(font)}>
        {options.map((word) => (
          <button
            key={word}
            type="button"
            className={`option${used.has(word) && word !== value ? ' option--used' : ''}`}
            aria-pressed={word === value}
            onClick={() => onPick(word)}
          >
            {word}
          </button>
        ))}
        {value.trim() !== '' ? (
          <button type="button" className="option" onClick={() => onPick(null)}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 1:1 tutoring reveal: the learner's own sentence, graded per gap. No audience tally. */
export function FillTheGapsOwnResult({
  interaction,
  ownAnswer,
}: {
  interaction: Extract<InteractionView, { type: 'fill-the-gaps' }>;
  ownAnswer: Extract<Ballot, { kind: 'fill-the-gaps' }>;
}) {
  const grade = gradeFillTheGaps(interaction, ownAnswer.gaps);
  const byId = new Map(grade.gaps.map((row) => [row.id, row]));
  const tokens = splitFillTheGapsPrompt(interaction.prompt);
  return (
    <p
      className="prompt fill-the-gaps-own"
      aria-live="polite"
      style={promptFontStyle(interaction.promptFont)}
    >
      {tokens.map((token, index) => {
        if (token.kind === 'text') return <span key={index}>{token.text}</span>;
        const row = byId.get(token.id);
        const expected = interaction.gaps.find((gap) => gap.id === token.id)?.answers?.[0];
        const word = row?.answer || ownAnswer.gaps[token.id] || '';
        return (
          <span
            key={token.id}
            className={`gap-result${row?.correct ? ' gap-result--ok' : ' gap-result--bad'}`}
          >
            {word === '' ? '____' : word}
            <span className="gap-result__mark" aria-hidden="true">
              {row?.correct ? '✓' : '✗'}
            </span>
            {row?.correct === false && expected !== undefined && expected !== '' ? (
              <span className="gap-result__expected"> {expected}</span>
            ) : null}
          </span>
        );
      })}
    </p>
  );
}

function shuffleIds(ids: string[], seed: string): string[] {
  const next = [...ids];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = next.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function MatchAnswer({
  interaction,
  ownAnswer,
  busy,
  onSubmit,
}: Props & { interaction: Extract<InteractionView, { type: 'match' }> }) {
  const initial = ownAnswer?.kind === 'match' ? ownAnswer.pairs : {};
  const [pairs, setPairs] = useState<Record<string, string>>(initial);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setPairs(ownAnswer?.kind === 'match' ? ownAnswer.pairs : {});
    setPicked(null);
  }, [interaction.id, ownAnswer]);

  const rightOrder = shuffleIds(
    interaction.right.map((item) => item.id),
    interaction.id,
  );
  const valid =
    interaction.left.length > 0 && interaction.left.every((item) => Boolean(pairs[item.id]));

  function pair(leftId: string, rightId: string): void {
    setPairs((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(next)) {
        if (value === rightId) delete next[key];
      }
      next[leftId] = rightId;
      return next;
    });
    setPicked(null);
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit({ kind: 'match', pairs });
      }}
    >
      <div className="stack" role="group" aria-label="Match">
        {interaction.left.map((left) => (
          <div key={left.id} className="stack">
            <button
              type="button"
              className={`btn ${picked === left.id ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={picked === left.id}
              onClick={() => setPicked(left.id)}
            >
              <OptionLabel label={left.label} spans={left.labelSpans} />
              {pairs[left.id]
                ? ` — ${interaction.right.find((item) => item.id === pairs[left.id])?.label ?? ''}`
                : ''}
            </button>
          </div>
        ))}
        <p className="hint">Tap a word, then tap its match.</p>
        <div className="stack" role="group" aria-label="Meanings">
          {rightOrder.map((id) => {
            const item = interaction.right.find((right) => right.id === id);
            if (!item) return null;
            return (
              <button
                key={id}
                type="button"
                className="btn btn--ghost"
                disabled={picked === null}
                onClick={() => {
                  if (picked) pair(picked, id);
                }}
              >
                <OptionLabel label={item.label} spans={item.labelSpans} />
              </button>
            );
          })}
        </div>
      </div>
      <button className="btn btn--primary btn--wide" type="submit" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Send answer'}
      </button>
    </form>
  );
}
