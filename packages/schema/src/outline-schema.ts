import outlineSchemaJson from '../schema/outline.schema.json' with { type: 'json' };

/** Normative OpenRoom Outline JSON Schema (draft 2020-12). */
export const outlineSchema: Record<string, unknown> = outlineSchemaJson as Record<
  string,
  unknown
>;

export const OUTLINE_SCHEMA_ID = 'https://openroom.app/schema/outline.schema.json';
