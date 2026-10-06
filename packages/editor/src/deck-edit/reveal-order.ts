/**
 * The editing algebra for a step's reveal order.
 *
 * A *resolved* reveal order (`resolveRevealOrder` in `@openroom/schema`) is an
 * ordered list of groups covering every part of a step exactly once. These
 * operations take such a grouping and return another one: every key that went
 * in comes out, once, and no group is ever empty. That invariant is the whole
 * point — the properties panel can hand any result straight back to the outline
 * as an authored `reveal` and the validator will accept it.
 *
 * Nothing here knows what a part key *means*. Part keys are derived once, in
 * the schema, so the editor and the validator cannot disagree.
 */

/** Where a part moves: towards the start of the sequence, or towards the end. */
export type MoveDirection = -1 | 1;

function prune(groups: readonly string[][]): string[][] {
  return groups.filter((group) => group.length > 0).map((group) => [...group]);
}

function indexOfGroupWith(groups: readonly string[][], key: string): number {
  return groups.findIndex((group) => group.includes(key));
}

/**
 * Move one part into the neighbouring group.
 *
 * Off either end it becomes a new group there, so a key can always be pushed
 * one reveal earlier or later — except when it is already alone at that end,
 * where the move would change nothing and is refused rather than churning the
 * authored value.
 *
 * A key arriving from below lands at the *end* of the previous group, and a key
 * arriving from above lands at the *start* of the next one, so its position
 * relative to the parts it passes stays what the eye expects.
 */
export function movePart(
  groups: readonly string[][],
  key: string,
  dir: MoveDirection,
): string[][] {
  const from = indexOfGroupWith(groups, key);
  if (from === -1) return prune(groups);

  const next = prune(groups);
  const source = next[from]!;
  const alone = source.length === 1;
  const atEdge = dir === -1 ? from === 0 : from === next.length - 1;
  if (alone && atEdge) return next;

  source.splice(source.indexOf(key), 1);

  if (atEdge) {
    // Off the end: the part earns a reveal step of its own.
    if (dir === -1) next.unshift([key]);
    else next.push([key]);
  } else if (dir === -1) {
    next[from - 1]!.push(key);
  } else {
    next[from + 1]!.unshift(key);
  }

  return prune(next);
}

/**
 * Pull a part out of a shared group into its own group immediately after.
 * A part that is already alone has nothing to split from, so this is a no-op.
 */
export function splitPart(groups: readonly string[][], key: string): string[][] {
  const at = indexOfGroupWith(groups, key);
  if (at === -1) return prune(groups);

  const next = prune(groups);
  const source = next[at]!;
  if (source.length === 1) return next;

  source.splice(source.indexOf(key), 1);
  next.splice(at + 1, 0, [key]);
  return prune(next);
}

/**
 * Fold the group after `index` into it, so the two reveal together.
 * Out of range — including the last group, which has no next — is a no-op.
 */
export function mergeNext(groups: readonly string[][], index: number): string[][] {
  const next = prune(groups);
  if (index < 0 || index + 1 >= next.length) return next;
  const [folded] = next.splice(index + 1, 1);
  next[index]!.push(...folded!);
  return prune(next);
}

/** Everything in one group: the step lands whole. */
export function setTogether(groups: readonly string[][]): string[][] {
  const all = groups.flat();
  return all.length === 0 ? [] : [all];
}

/** One part per group: the step lands a piece at a time, in the order shown. */
export function setSequence(groups: readonly string[][]): string[][] {
  return groups.flat().map((key) => [key]);
}
