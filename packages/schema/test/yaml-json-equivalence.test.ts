import { describe, expect, it } from 'vitest';

import { normalizeSession, parseSession } from '../src/index.js';

/** SESSION-02: equivalent YAML and JSON inputs must produce the same normalized session. */

const yamlText = `
version: 1
meta:
  title: Equivalence check
  description: same content, two serializations
  locale: en
defaults:
  resultVisibility: live
interactions:
  - id: q1
    type: choice
    prompt: Pick one
    options:
      - id: a
        label: A
        correct: true
      - id: b
        label: B
        misconception: wrong
    multiple: false
  - id: q2
    type: scale
    prompt: Rate it
    min: 1
    max: 5
  - id: q3
    type: numeric
    prompt: Guess
    correct: 42
    tolerance: 5
    unit: kg
  - id: q4
    type: text
    prompt: Say something
    maxLength: 100
  - id: q5
    type: qna
    prompt: Ask away
`;

describe('YAML/JSON equivalence (SESSION-02)', () => {
  it('produces an identical normalized session whether parsed from YAML or JSON', () => {
    const yamlResult = parseSession(yamlText, 'yaml');
    expect(yamlResult.ok).toBe(true);
    if (!yamlResult.ok) return;

    const jsonText = JSON.stringify(yamlResult.session);
    const jsonResult = parseSession(jsonText, 'json');
    expect(jsonResult.ok).toBe(true);
    if (!jsonResult.ok) return;

    const normalizedFromYaml = normalizeSession(yamlResult.session);
    const normalizedFromJson = normalizeSession(jsonResult.session);
    expect(normalizedFromJson).toEqual(normalizedFromYaml);
  });

  it('accepts a JSON document even without an explicit format argument (JSON is valid YAML)', () => {
    const session = {
      version: 1,
      meta: { title: 'implicit format' },
      interactions: [{ id: 'q', type: 'qna', prompt: 'Ask' }],
    };
    const viaAutoFormat = parseSession(JSON.stringify(session));
    const viaExplicitJson = parseSession(JSON.stringify(session), 'json');
    expect(viaAutoFormat.ok).toBe(true);
    expect(viaExplicitJson.ok).toBe(true);
    if (!viaAutoFormat.ok || !viaExplicitJson.ok) return;
    expect(normalizeSession(viaAutoFormat.session)).toEqual(normalizeSession(viaExplicitJson.session));
  });
});
