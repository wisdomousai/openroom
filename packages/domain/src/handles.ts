/**
 * Session-local handles (PRD "Pseudonymous mode"): a random adjective+animal+number
 * handle assigned at join time, stable within one session and never linked across
 * sessions. System-assigned — participants never type a name, so no self-declared
 * PII enters the system and the text blocklist is not needed here. The numeric
 * suffix gives manual session-local recovery enough search space to rate-limit
 * sensibly while keeping the handle easy to read and type.
 *
 * This wordlist serves `identityMode: 'pseudonymous'` only. It is not the sole
 * source of handles in the product: `'anonymous'` assigns none, and
 * `'identified'` takes the handle from `contexts.display_name` — a name the
 * tutor authored, reached through a context access link. The "participants
 * never type a name" invariant holds in every mode; "the handle is
 * system-generated" holds only here.
 */

const ADJECTIVES = [
  'Amber', 'Azure', 'Bold', 'Brave', 'Bright', 'Calm', 'Cedar', 'Clever',
  'Copper', 'Coral', 'Crimson', 'Curious', 'Dapper', 'Deft', 'Eager', 'Emerald',
  'Gentle', 'Golden', 'Hazel', 'Indigo', 'Ivory', 'Jade', 'Keen', 'Lively',
  'Lucid', 'Mellow', 'Merry', 'Nimble', 'Olive', 'Onyx', 'Patient', 'Plucky',
  'Quiet', 'Rosy', 'Rustic', 'Scarlet', 'Silver', 'Steady', 'Swift', 'Violet',
] as const;

const ANIMALS = [
  'Badger', 'Bee', 'Bison', 'Crane', 'Cricket', 'Deer', 'Dolphin', 'Falcon',
  'Fox', 'Gecko', 'Hare', 'Hedgehog', 'Heron', 'Ibex', 'Jay', 'Koala',
  'Lark', 'Lemur', 'Lynx', 'Marmot', 'Marten', 'Mole', 'Moose', 'Newt',
  'Otter', 'Owl', 'Panda', 'Pelican', 'Petrel', 'Puffin', 'Quail', 'Raven',
  'Robin', 'Seal', 'Sparrow', 'Stork', 'Swan', 'Tern', 'Wombat', 'Wren',
] as const;

function pick<T>(items: readonly T[]): T {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return items[buf[0]! % items.length]!;
}

function pickSuffix(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 1000 + (buf[0]! % 9000);
}

/**
 * Generate a handle not present in `taken`. The four-digit suffix expands the
 * space to 14.4 million session-local handles. The final monotonic fallback keeps
 * the function terminating even under deliberately hostile collision input.
 */
export function generateHandle(taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${pickSuffix()}`;
    if (!taken.has(candidate)) return candidate;
  }
  const base = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
  for (let suffix = 1000; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
