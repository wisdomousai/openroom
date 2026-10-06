/**
 * Session codes.
 *
 * Alphabet: Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, which already
 * drops I, L, O and U) with the remaining vowels A and E removed so no code can
 * spell a word, and with the digits 0 and 1 removed because they are read aloud
 * and typed as O and I/l.
 *
 * Resulting 28-character alphabet:
 *
 *     23456789BCDFGHJKMNPQRSTVWXYZ
 *
 * Codes are 8 characters, giving 28^8 ≈ 3.78e11 possibilities.
 */
export const SESSION_CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
export const SESSION_CODE_LENGTH = 8;

/**
 * Reader-error corrections applied when a human types a code:
 * O/o → 0 is impossible (0 is not in the alphabet), so ambiguous glyphs are
 * mapped onto the nearest alphabet member instead.
 */
const CONFUSABLES: Record<string, string> = {
  O: 'Q',
  I: 'J',
  L: 'J',
  U: 'V',
  A: '4',
  E: '3',
  '0': 'Q',
  '1': 'J',
};

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webcrypto === undefined || typeof webcrypto.getRandomValues !== 'function') {
    throw new Error('generateSessionCode requires a global crypto.getRandomValues');
  }
  webcrypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a cryptographically random 8-character session code.
 * Uses rejection sampling so every character is uniformly distributed
 * (256 % 28 = 4, so bytes >= 252 are discarded).
 */
export function generateSessionCode(length: number = SESSION_CODE_LENGTH): string {
  const alphabetSize = SESSION_CODE_ALPHABET.length;
  const limit = 256 - (256 % alphabetSize);
  let code = '';
  while (code.length < length) {
    const batch = randomBytes(length * 2);
    for (const byte of batch) {
      if (byte >= limit) continue;
      code += SESSION_CODE_ALPHABET[byte % alphabetSize];
      if (code.length === length) break;
    }
  }
  return code;
}

/** Uppercase, strip separators and fold confusable glyphs onto the alphabet. */
export function normalizeSessionCode(input: string): string {
  let out = '';
  for (const char of input.toUpperCase()) {
    if (char === ' ' || char === '-' || char === '_') continue;
    const folded = CONFUSABLES[char] ?? char;
    if (SESSION_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

export function isValidSessionCode(code: string): boolean {
  if (code.length !== SESSION_CODE_LENGTH) return false;
  for (const char of code) {
    if (!SESSION_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}
