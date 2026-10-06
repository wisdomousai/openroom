/**
 * A dictionary entry, rendered.
 *
 * Shared because all three surfaces show the same table: the console strip
 * before it is projected, the wall once it is, and the phone when the tutor
 * put it there. Structure only — the class names below are styled by
 * `stage-ui.css` on the wall and by the participant sheet on a phone.
 *
 * There is no `switch (pos)` here and there must never be one. Sections and
 * axes are computed from grammatical tags in `@openroom/schema`, so a verb's
 * conjugation, a noun's declension and an adjective's degree ladder all arrive
 * as the same `{ columnLabels, rows }` and render through this one path.
 */
import type { DictionaryEntry, FormSection } from '@openroom/schema';

/** The headword line: what the word is, and the facts that are not in a table. */
export function DictionaryHead({ entry }: { entry: DictionaryEntry }) {
  return (
    <span className="dict-head">
      <span className="dict-head__pos">{entry.pos}</span>
      {entry.headword === undefined ? null : (
        <span className="dict-head__word">{entry.headword}</span>
      )}
      {entry.labels.map((label) => (
        <span key={label} className="dict-head__label">
          {label}
        </span>
      ))}
      {entry.resolvedFrom === undefined ? null : (
        <span className="dict-head__from">from {entry.resolvedFrom}</span>
      )}
    </span>
  );
}

/**
 * One section. A section with no columns is a flat list of forms — a
 * preposition's handful, a noun's plural-only oddity — and gets chips rather
 * than a one-column grid pretending to be a table.
 */
export function DictionarySection({
  section,
  highlight,
}: {
  section: FormSection;
  /** The form the tutor clicked, marked wherever it appears. */
  highlight?: string;
}) {
  const flat = section.columnLabels.length === 0;
  return (
    <div className="dict-section">
      <div className="dict-section__label">{section.label}</div>
      {flat ? (
        <div className="dict-chips">
          {section.rows.flatMap((row) =>
            row.cells.map((cell, index) =>
              cell === null ? null : (
                <span
                  key={`${row.label}-${String(index)}`}
                  className={cell === highlight ? 'dict-chip dict-chip--on' : 'dict-chip'}
                >
                  {cell}
                </span>
              ),
            ),
          )}
        </div>
      ) : (
        <div className="dict-scroll">
          <table className="dict-table">
            <thead>
              <tr>
                <th scope="col" />
                {section.columnLabels.map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                    <td
                      key={`${row.label}-${String(index)}`}
                      className={cell !== null && cell === highlight ? 'dict-cell--on' : undefined}
                    >
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface DictionaryTableProps {
  entry: DictionaryEntry;
  /** The word as it was clicked, marked in the table so the class can find it. */
  highlight?: string;
  /** Senses are noise on a wall showing forms; the console strip wants them. */
  showSenses?: boolean;
}

export function DictionaryTable({ entry, highlight, showSenses = false }: DictionaryTableProps) {
  return (
    <div className="dict">
      <div className="dict__lemma">
        {entry.lemma}
        <DictionaryHead entry={entry} />
      </div>
      {showSenses && entry.senses.length > 0 ? (
        <ol className="dict__senses">
          {entry.senses.map((sense) => (
            <li key={sense.gloss}>{sense.gloss}</li>
          ))}
        </ol>
      ) : null}
      {entry.sections.map((section) => (
        <DictionarySection key={section.key} section={section} highlight={highlight} />
      ))}
      {/*
        Wiktionary is CC BY-SA. The attribution is part of the artifact, not a
        footer we can drop when the table gets tall.
      */}
      <div className="dict__source">{entry.source.name}</div>
    </div>
  );
}
