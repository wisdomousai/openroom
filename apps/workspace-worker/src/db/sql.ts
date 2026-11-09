/**
 * SQLite fragments the Drizzle query builder has no method for. Column
 * references stay typed; keep this file to what the builder cannot express.
 */
import { type AnyColumn, type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/** `col COLLATE NOCASE`, for case-insensitive ordering. */
export function nocase(col: AnyColumn | SQLWrapper): SQL {
  return sql`${col} COLLATE NOCASE`;
}

/**
 * A lower-cased `%text%` pattern for `likeEscaped`. LIKE wildcards in the
 * caller's text would silently widen the filter, so they are escaped.
 */
export function containsNeedle(text: string): string {
  return `%${text.replace(/[%_\\]/g, (ch) => `\\${ch}`).toLowerCase()}%`;
}

/** `lower(expr) LIKE needle ESCAPE '\'`, with a needle from `containsNeedle`. */
export function likeEscaped(expr: AnyColumn | SQLWrapper, needle: string): SQL {
  return sql`lower(${expr}) LIKE ${needle} ESCAPE '\\'`;
}
