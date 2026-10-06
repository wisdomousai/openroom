/**
 * The normative Outline v1 JSON Schema, served over `resources/`.
 *
 * Tool descriptions carry the shape an author needs to start (AGENTS.md, "one
 * source per fact"), but they are prose and cannot state every constraint. An
 * agent that wants the contract itself had no way to read it: the only way to
 * learn the document shape was to guess and read the validator's complaints,
 * which is exactly the loop this resource exists to end.
 *
 * The schema is a plain JSON import, inlined by the bundler. It needs none of
 * the standalone-codegen treatment the Ajv validators get — that exists only
 * because workerd forbids runtime code generation, and inert data triggers none.
 */

import { OUTLINE_SCHEMA_ID, outlineSchema } from '@openroom/schema';

/**
 * The schema's own `$id`, reused as the resource uri. One identifier for one
 * document, rather than a second `schema://` name that would have to agree
 * with it forever.
 */
export const OUTLINE_SCHEMA_RESOURCE_URI = OUTLINE_SCHEMA_ID;

export const SCHEMA_MIME_TYPE = 'application/schema+json';

export function outlineSchemaResource(): {
  descriptor: Record<string, unknown>;
  content: Record<string, unknown>;
} {
  return {
    descriptor: {
      uri: OUTLINE_SCHEMA_RESOURCE_URI,
      name: 'OpenRoom Outline v1 schema',
      title: 'Outline v1 schema',
      description:
        'The normative JSON Schema (draft 2020-12) an outline is validated against. ' +
        'Read it before authoring an outline, or to resolve a validation error exactly.',
      mimeType: SCHEMA_MIME_TYPE,
    },
    content: {
      uri: OUTLINE_SCHEMA_RESOURCE_URI,
      mimeType: SCHEMA_MIME_TYPE,
      text: JSON.stringify(outlineSchema),
    },
  };
}
