/**
 * Turning Ajv's errors on an Outline into the errors an author can act on.
 *
 * The outline schema is full of unions: a step is one of 13 kinds, an element
 * one of five types, a reveal either "together" or a list of groups. Ajv runs
 * with `allErrors`, so one mistake comes back once per branch, and most of
 * those errors describe a shape the author never meant ("items/0 must be
 * string" on a cards step, "alt is required" on a text element). This module
 * walks the normative schema along each error's instance path, choosing at
 * every union the branch the document itself names (its `kind`, its `type`,
 * or the only branch its JSON type fits), and drops the errors that cannot
 * belong to that branch. Then it rewrites the remaining messages to say what
 * to write instead.
 */

import type { ErrorObject } from 'ajv';

import { outlineSchema } from './outline-schema.js';
import { ErrorCodes, type SessionError } from './types.js';

type Schema = Record<string, unknown>;

const DEFS = (outlineSchema['$defs'] ?? {}) as Record<string, Schema>;
const ROOT = outlineSchema as unknown as Schema;

function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Follow a local `$ref`; an external one (the interaction defs) is not walked. */
function resolve(schema: unknown): Schema | null {
  if (!isSchema(schema)) return null;
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;
  const match = /^#\/\$defs\/([^/]+)$/.exec(ref);
  if (match === null) return null;
  const target = DEFS[match[1]!];
  return target === undefined ? null : resolve(target);
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typesOf(schema: Schema): string[] {
  const type = schema['type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === 'string');
  if ('const' in schema) return [jsonType(schema['const'])];
  return [];
}

function typeFits(types: readonly string[], value: unknown): boolean {
  const actual = jsonType(value);
  return types.includes(actual) || (actual === 'integer' && types.includes('number'));
}

/**
 * The schema nodes that apply to `value` at one place, with `$ref` followed,
 * `allOf` flattened and each union narrowed to the branch the value names.
 * `definite` is false when something could not be narrowed (an external
 * reference, a union with no telling branch, a conditional), so absence of a
 * keyword proves nothing.
 */
interface Node {
  parts: Schema[];
  definite: boolean;
  /** A union was narrowed here, so the union's own error is noise. */
  narrowed: boolean;
}

function constOf(schema: Schema, key: string): unknown {
  for (const part of expand(schema, undefined).parts) {
    const property = resolve((part['properties'] as Record<string, unknown> | undefined)?.[key]);
    if (property !== null && 'const' in property) return property['const'];
  }
  return undefined;
}

/** The one branch of a union the value can be: by `kind` or `type`, else by JSON type. */
function branchOf(options: readonly unknown[], value: unknown): Schema | null {
  const resolved = options.map(resolve);
  if (resolved.some((option) => option === null)) return null;
  const branches = resolved as Schema[];
  if (isSchema(value)) {
    for (const key of ['kind', 'type']) {
      const tag = value[key];
      if (typeof tag !== 'string') continue;
      const matches = branches.filter((branch) => constOf(branch, key) === tag);
      if (matches.length === 1) return matches[0]!;
    }
  }
  const fitting = branches.filter((branch) => {
    const types = expand(branch, undefined).parts.flatMap(typesOf);
    return types.length === 0 || typeFits(types, value);
  });
  return fitting.length === 1 ? fitting[0]! : null;
}

function expand(schema: unknown, value: unknown): Node {
  const node: Node = { parts: [], definite: true, narrowed: false };
  const visit = (candidate: unknown): void => {
    const resolved = resolve(candidate);
    if (resolved === null) {
      node.definite = false;
      return;
    }
    node.parts.push(resolved);
    for (const part of (resolved['allOf'] as unknown[] | undefined) ?? []) visit(part);
    if ('if' in resolved || 'not' in resolved) node.definite = false;
    const union = (resolved['oneOf'] ?? resolved['anyOf']) as unknown[] | undefined;
    if (union !== undefined) {
      const branch = value === undefined ? null : branchOf(union, value);
      if (branch === null) {
        node.definite = false;
      } else {
        node.narrowed = true;
        visit(branch);
      }
    }
  };
  visit(schema);
  return node;
}

function decodePointer(path: string): string[] {
  if (path === '') return [];
  return path
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function valueAt(input: unknown, segments: readonly string[]): unknown {
  let value = input;
  for (const segment of segments) {
    if (Array.isArray(value)) value = value[Number(segment)];
    else if (isSchema(value)) value = value[segment];
    else return undefined;
  }
  return value;
}

/** True when this node can never hold a child named `segment`. */
function closedTo(node: Node, segment: string): boolean {
  if (!node.definite) return false;
  const types = node.parts.flatMap(typesOf);
  if (types.length > 0 && !types.some((type) => type === 'object' || type === 'array')) return true;
  const closed = node.parts.some(
    (part) => part['additionalProperties'] === false || part['unevaluatedProperties'] === false,
  );
  return closed && !/^\d+$/.test(segment);
}

/** The node at an instance path, 'closed' where the branch cannot reach, null where unknown. */
function nodeAt(input: unknown, segments: readonly string[]): Node | 'closed' | null {
  let node = expand(ROOT, input);
  for (let depth = 0; depth < segments.length; depth += 1) {
    const segment = segments[depth]!;
    const child = valueAt(input, segments.slice(0, depth + 1));
    const holder = valueAt(input, segments.slice(0, depth));
    let next: unknown[] = [];
    if (Array.isArray(holder)) {
      next = node.parts.map((part) => part['items']).filter((items) => items !== undefined);
    } else {
      next = node.parts
        .map((part) => (part['properties'] as Record<string, unknown> | undefined)?.[segment])
        .filter((property) => property !== undefined);
    }
    if (next.length === 0) return closedTo(node, segment) ? 'closed' : null;
    const merged: Node = { parts: [], definite: true, narrowed: false };
    for (const schema of next) {
      const expanded = expand(schema, child);
      merged.parts.push(...expanded.parts);
      merged.definite &&= expanded.definite;
      merged.narrowed ||= expanded.narrowed;
    }
    node = merged;
  }
  return node;
}

const LIMITS = new Set([
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minProperties',
  'maxProperties',
]);

/** Whether an error can have come from the branch the document chose. */
function belongs(err: ErrorObject, input: unknown): boolean {
  const segments = decodePointer(err.instancePath);
  const node = nodeAt(input, segments);
  if (node === 'closed') return false;
  if (node === null) return true;
  const value = valueAt(input, segments);
  const params = err.params as Record<string, unknown>;
  const has = (keyword: string): unknown[] =>
    node.parts.filter((part) => keyword in part).map((part) => part[keyword]);
  switch (err.keyword) {
    case 'oneOf':
    case 'anyOf':
      return !node.narrowed && (!node.definite || has(err.keyword).length > 0);
    case 'type': {
      const types = node.parts.flatMap(typesOf);
      if (types.length === 0) return !node.definite;
      const reported = String(params['type'] ?? '').split(',');
      return reported.some((type) => types.includes(type));
    }
    case 'required': {
      const missing = params['missingProperty'];
      const types = node.parts.flatMap(typesOf);
      if (node.definite && types.length > 0 && !types.includes('object')) return false;
      const required = has('required').flat();
      if (required.includes(missing)) return true;
      return !node.definite;
    }
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const extra = params['additionalProperty'] ?? params['unevaluatedProperty'];
      if (typeof extra !== 'string') return true;
      const known = node.parts.some((part) =>
        Object.prototype.hasOwnProperty.call((part['properties'] as object | undefined) ?? {}, extra),
      );
      if (known) return false;
      const types = node.parts.flatMap(typesOf);
      if (node.definite && types.length > 0 && !types.includes('object')) return false;
      return true;
    }
    case 'const': {
      const consts = has('const');
      if (consts.length === 0) return !node.definite;
      return !consts.some((entry) => entry === value);
    }
    case 'enum': {
      const enums = has('enum');
      if (enums.length === 0) return !node.definite;
      return !enums.some((entry) => Array.isArray(entry) && entry.includes(value));
    }
    case 'pattern': {
      const patterns = has('pattern');
      if (patterns.length === 0) return !node.definite;
      return patterns.includes(params['pattern']);
    }
    default: {
      if (!LIMITS.has(err.keyword)) return true;
      const limits = has(err.keyword);
      if (limits.length === 0) return !node.definite;
      return limits.includes(params['limit']);
    }
  }
}

/**
 * Drop the errors that belong to union branches the author did not choose,
 * then the combinator errors that only repeat what a deeper error says. If
 * nothing would be left, the input is returned unchanged: an error list is
 * never emptied by this pass.
 */
export function withoutBranchNoise(errors: readonly ErrorObject[], input: unknown): ErrorObject[] {
  const owned = errors.filter((err) => belongs(err, input));
  const deeper = (err: ErrorObject, under: string): boolean =>
    owned.some((other) => other !== err && (other.instancePath === under || other.instancePath.startsWith(`${under}/`)));
  const kept = owned.filter((err) => {
    // A failed `if` only says its `then` failed; the `then` errors are kept.
    if (err.keyword === 'if') return !deeper(err, err.instancePath);
    if (err.keyword === 'oneOf' || err.keyword === 'anyOf') {
      return !owned.some(
        (other) => other !== err && other.instancePath.startsWith(`${err.instancePath}/`),
      );
    }
    // A property that failed its own schema is also "not evaluated" by the
    // object around it; the property's own error is the one to read.
    if (err.keyword === 'unevaluatedProperties') {
      const extra = (err.params as { unevaluatedProperty?: string }).unevaluatedProperty;
      if (typeof extra === 'string') {
        const under = `${err.instancePath}/${extra.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (owned.some((other) => other !== err && (other.instancePath === under || other.instancePath.startsWith(`${under}/`)))) {
          return false;
        }
      }
    }
    return true;
  });
  return kept.length > 0 ? kept : [...errors];
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

const META_KEYS = new Set(
  Object.keys(((DEFS['meta'] ?? {})['properties'] as object | undefined) ?? {}),
);

const PART_KEY_PATTERN = ((DEFS['partKey'] ?? {})['pattern'] as string | undefined) ?? '';

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** The fields a node accepts, for "is not a field here" messages. */
function fieldsAt(input: unknown, segments: readonly string[]): string[] {
  const node = nodeAt(input, segments);
  if (node === null || node === 'closed') return [];
  const fields = new Set<string>();
  for (const part of node.parts) {
    for (const key of Object.keys((part['properties'] as object | undefined) ?? {})) fields.add(key);
  }
  return [...fields];
}

function quoted(values: readonly unknown[]): string {
  return values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(', ');
}

function unknownFieldMessage(err: ErrorObject, input: unknown, extra: string): string {
  const segments = decodePointer(err.instancePath);
  if (segments.length === 0) {
    const fields = fieldsAt(input, segments);
    const home = META_KEYS.has(extra) ? `; it belongs in meta.${extra}` : '';
    return `"${extra}" is not a top-level key${home} (top-level keys: ${fields.join(', ')})`;
  }
  const fields = fieldsAt(input, segments);
  const holder = valueAt(input, segments);
  const kind = isSchema(holder) && segments.length === 2 && segments[0] === 'steps' && typeof holder['kind'] === 'string'
    ? ` of a ${holder['kind']} step`
    : ' here';
  return fields.length === 0
    ? `"${extra}" is not a field${kind}`
    : `"${extra}" is not a field${kind} (fields: ${fields.join(', ')})`;
}

/** One Ajv error as an OpenRoom error: the path names the field, the message the fix. */
export function describeSchemaError(err: ErrorObject, input: unknown): SessionError {
  const params = err.params as Record<string, unknown>;
  let path = err.instancePath === '' ? '/' : err.instancePath;
  let message = err.message ?? 'schema violation';
  const value = valueAt(input, decodePointer(err.instancePath));

  if (err.keyword === 'required') {
    const missing = params['missingProperty'];
    if (typeof missing === 'string') path = `${err.instancePath}/${escapeToken(missing)}`;
  }
  if (err.keyword === 'additionalProperties' || err.keyword === 'unevaluatedProperties') {
    const extra = params['additionalProperty'] ?? params['unevaluatedProperty'];
    if (typeof extra === 'string') {
      path = `${err.instancePath}/${escapeToken(extra)}`;
      message = unknownFieldMessage(err, input, extra);
    }
  }
  if (err.keyword === 'enum' && Array.isArray(params['allowedValues'])) {
    message = `must be one of: ${quoted(params['allowedValues'] as unknown[])}`;
  }
  if (err.keyword === 'const' && 'allowedValue' in params) {
    message = /^\/steps\/\d+\/reveal$/.test(err.instancePath)
      ? 'must be "together" or a list of groups of part keys, for example [["header"], ["body"]]'
      : `must be ${JSON.stringify(params['allowedValue'])}`;
  }
  if (err.keyword === 'pattern' && params['pattern'] === PART_KEY_PATTERN) {
    message =
      `"${String(value)}" is not a part key: the keys are header, stat, body, materials, image, option-N, cell-N, gap-N and el-<element id>; ` +
      "a term's example is cell-0";
  }
  if (err.keyword === 'type' && params['type'] === 'object' && /^\/interactions\/\d+\/(options|left|right)\/\d+$/.test(err.instancePath)) {
    message = 'must be an object {id, label}; bare strings are accepted only in a SimpleSession (title plus questions)';
  }
  if (err.keyword === 'type' && params['type'] === 'array' && typeof value === 'string') {
    message = 'must be an array of strings, one entry per line, not a single string';
  }
  if (err.keyword === 'type' && params['type'] === 'string' && isSchema(value) && Object.keys(value).length === 1) {
    const [key] = Object.keys(value);
    message =
      `must be string, but YAML read it as the mapping "${key!}: …" because it contains a colon followed by a space; ` +
      'put the whole text in quotes';
  }
  return { code: ErrorCodes.E_SCHEMA, path, message };
}

/** YAML parse messages that an unquoted ": " inside a value produces. */
const COLON_MESSAGES = [
  'Nested mappings are not allowed in compact mappings',
  'Block collections are not allowed within flow collections',
  'Implicit map keys need to be followed by map values',
  'Implicit keys need to be on a single line',
];

/** The parse error, with a quoting hint when an unquoted colon is the likely cause. */
export function describeParseError(message: string): string {
  if (!COLON_MESSAGES.some((known) => message.includes(known))) return message;
  return (
    `${message.trimEnd()}\n` +
    'A text value that contains a colon followed by a space (for example "Attention : le verbe") must be in quotes.'
  );
}
