import { parse } from 'yaml';
import type { Outline } from '@openroom/schema';
import frenchA1 from '../../../../examples/tutoring/french-a1.yaml?raw';
import frenchA2 from '../../../../examples/tutoring/french-a2.yaml?raw';
import frenchB1 from '../../../../examples/tutoring/french-b1.yaml?raw';
import frenchB2 from '../../../../examples/tutoring/french-b2.yaml?raw';
import germanA1 from '../../../../examples/tutoring/german-a1.yaml?raw';
import germanA2 from '../../../../examples/tutoring/german-a2.yaml?raw';
import germanB1 from '../../../../examples/tutoring/german-b1.yaml?raw';
import germanB2 from '../../../../examples/tutoring/german-b2.yaml?raw';

/** Authored YAML is the source for browser, CLI and external agents alike. */
export const LESSON_EXAMPLES = Object.entries({ 'french-a1': frenchA1, 'french-a2': frenchA2, 'french-b1': frenchB1, 'french-b2': frenchB2, 'german-a1': germanA1, 'german-a2': germanA2, 'german-b1': germanB1, 'german-b2': germanB2 })
  .map(([id, source]) => ({ id, outline: parse(source) as Outline }));

export function lessonExample(id: string): Outline {
  const example = LESSON_EXAMPLES.find((item) => item.id === id);
  if (!example) throw new Error('Unknown sample lesson.');
  return structuredClone(example.outline);
}
