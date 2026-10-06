/**
 * Built-in English profanity / slur blocklist for participant free text.
 *
 * Design notes
 * ------------
 * Matching is a hybrid:
 *
 *  - `SUBSTRING_TERMS` are unambiguous strings that essentially never occur inside
 *    an innocent English word. They match anywhere, so inflections ("fucking",
 *    "bitchy", "shithole") are caught without listing every form.
 *  - `WORD_TERMS` are short or ambiguous strings that DO occur inside innocent
 *    words (the Scunthorpe problem: "cunt" in Scunthorpe, "ass" in class,
 *    "spic" in suspicion, "coon" in raccoon, "anal" in analysis, "rapist" in
 *    therapist). They only match as whole words.
 *
 * Before matching, text is normalized: lowercased, common leetspeak glyphs are
 * folded back to letters (a→@, e→3, i→1, o→0, s→5, plus $→s, !→i, 4→a), runs of
 * three or more identical letters are collapsed ("fuuuuck" → "fuck"), and every
 * run of non-alphanumeric characters becomes a single space so that punctuation
 * cannot be used to break a word apart.
 *
 * A hit only sets `hidden: true` on the ballot. Nothing is deleted, and the
 * host can always unhide via the `text.unhide` command.
 */

/** Leetspeak glyph → letter. Keys are single characters. */
const LEET_MAP: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
};

/**
 * Matched anywhere in the normalized text. Only strings that do not appear
 * inside ordinary English words belong here.
 */
export const SUBSTRING_TERMS: readonly string[] = [
  // general profanity
  'fuck',
  'motherfuck',
  'clusterfuck',
  'shit',
  'shithead',
  'bullshit',
  'piss',
  'twat',
  'wank',
  'bugger',
  'bitch',
  'whore',
  'slut',
  'skank',
  'douche',
  'jackass',
  'dumbass',
  'asshole',
  'asshat',
  'arsehole',
  'dickhead',
  'cocksucker',
  'knobhead',
  'numbnuts',
  'nutsack',
  'ballsack',
  'bollock',
  'goddamn',
  'bastard',
  // racial and ethnic slurs
  'nigger',
  'nigga',
  'beaner',
  'wetback',
  'raghead',
  'towelhead',
  'zipperhead',
  'redskin',
  'darkie',
  'jigaboo',
  'golliwog',
  'pikey',
  'muzzie',
  // homophobic and transphobic slurs
  'faggot',
  'tranny',
  'shemale',
  'lesbo',
  'poofter',
  // ableist slurs
  'retarded',
  'retards',
  'mongoloid',
  // sexual content
  'molest',
  'pedophile',
  'paedophile',
  'porn',
  'dildo',
  'blowjob',
  'handjob',
  'jizz',
  'cumshot',
  'titties',
  'boobs',
  // drug / abuse
  'crackhead',
];

/**
 * Matched only on word boundaries. Everything here appears inside at least one
 * innocent English word, or is short enough to collide by accident.
 */
export const WORD_TERMS: readonly string[] = [
  // general profanity (short / collision-prone)
  'ass',
  'arse',
  'cock',
  'dick',
  'prick',
  'knob',
  'tit',
  'tits',
  'boob',
  'cum',
  'anal',
  'anus',
  'penis',
  'pussy',
  'pussies',
  'clit',
  'minge',
  'fart',
  'turd',
  'crap',
  'damn',
  'hell',
  'cunt',
  'tosser',
  'wtf',
  'stfu',
  'gtfo',
  'kys',
  // slurs (short / collision-prone)
  'fag',
  'fags',
  'homo',
  'queer',
  'dyke',
  'spic',
  'coon',
  'chink',
  'gook',
  'kike',
  'jap',
  'japs',
  'paki',
  'wop',
  'dago',
  'gyp',
  'kraut',
  'injun',
  'squaw',
  'abo',
  'coolie',
  'negro',
  'darky',
  'sambo',
  'yid',
  'heeb',
  'nazi',
  // ableist
  'retard',
  'spastic',
  'spaz',
  'cretin',
  'midget',
  'psycho',
  'schizo',
  // sexual violence / exploitation
  'rape',
  'raped',
  'rapist',
  'rapists',
  'pedo',
  'hoe',
  'hoes',
  'slag',
  'hooker',
  'pimp',
  'milf',
  // substance abuse
  'junkie',
];

/** Total entries in the built-in list. */
export const BLOCKLIST_SIZE = SUBSTRING_TERMS.length + WORD_TERMS.length;

const WORD_TERM_SET: ReadonlySet<string> = new Set(WORD_TERMS);

/**
 * Fold leetspeak, collapse stretched letters and reduce punctuation to spaces.
 * Exported for tests and for callers that want to reuse the same normalization.
 */
export function normalizeForMatch(text: string): string {
  let out = '';
  for (const char of text.toLowerCase()) {
    const mapped = LEET_MAP[char];
    out += mapped ?? char;
  }
  // collapse 3+ repeats of the same character ("fuuuuck" -> "fuck")
  out = out.replace(/(.)\1{2,}/g, '$1');
  // any run of non-alphanumerics becomes one space
  out = out.replace(/[^a-z0-9]+/g, ' ');
  return out.trim();
}

export interface BlocklistMatch {
  hidden: boolean;
  /** The blocklist entry that matched, when one did. Useful for host tooling. */
  term?: string;
}

/**
 * Decide whether a piece of participant text should be hidden by default.
 * Pure and allocation-light; never throws.
 */
export function applyBlocklist(text: string): BlocklistMatch {
  const normalized = normalizeForMatch(text);
  if (normalized === '') return { hidden: false };

  for (const term of SUBSTRING_TERMS) {
    if (normalized.includes(term)) return { hidden: true, term };
  }

  for (const token of normalized.split(' ')) {
    if (WORD_TERM_SET.has(token)) return { hidden: true, term: token };
  }

  return { hidden: false };
}
