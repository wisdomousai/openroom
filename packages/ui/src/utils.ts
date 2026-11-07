import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** The nine type tokens from DESIGN.md. They are font sizes, not text colours. */
const TYPE_TOKENS = [
  'page-title',
  'screen-title',
  'section',
  'row-title',
  'secondary',
  'caption',
  'option',
  'title-bar',
  'rail',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_TOKENS }],
    },
  },
});

/** shadcn's class combiner: conditional classes, last Tailwind utility wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
