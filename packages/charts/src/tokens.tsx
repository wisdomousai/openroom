import type { ReactNode } from 'react';

/**
 * One span per word, numbered inside the part it sits in.
 *
 * Tutor ink names a word by part key and token index (docs/TUTORING.md), and a
 * live question is drawn here rather than by the slide skeleton — so the words
 * on a chart have to be numbered the same way, or the tutor cannot circle the
 * option the class is arguing about.
 *
 * The split is the one every other surface uses: whitespace, index >> 1.
 */
export function TokenWords({ text }: { text: string }): ReactNode {
  return (
    <>
      {text.split(/(\s+)/).map((chunk, index) =>
        /^\s+$/.test(chunk) ? (
          chunk
        ) : (
          <span key={`w-${String(index)}`} data-token={Math.floor(index / 2)}>
            {chunk}
          </span>
        ),
      )}
    </>
  );
}
