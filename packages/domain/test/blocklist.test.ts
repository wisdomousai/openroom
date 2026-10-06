import { describe, expect, it } from 'vitest';

import { applyBlocklist } from '../src/index.js';

describe('blocklist — matching behavior', () => {
  it('catches plain lowercase profanity', () => {
    expect(applyBlocklist('this is bullshit').hidden).toBe(true);
  });

  it('catches UPPERCASE profanity', () => {
    expect(applyBlocklist('THIS IS BULLSHIT').hidden).toBe(true);
    expect(applyBlocklist('WHAT THE FUCK').hidden).toBe(true);
  });

  it('catches leetspeak substitutions', () => {
    expect(applyBlocklist('sh1t').hidden).toBe(true);
    expect(applyBlocklist('SH1T').hidden).toBe(true);
    expect(applyBlocklist('@ss').hidden).toBe(true);
    expect(applyBlocklist('f4ggot').hidden).toBe(true);
  });

  it('does NOT flag Scunthorpe-style embeddings of word-boundary entries', () => {
    // "class" contains "ass", "assess" contains "ass" twice, "Scunthorpe" contains
    // "cunt" — all must pass clean because these terms are WORD_TERMS (word-boundary
    // matched only), not SUBSTRING_TERMS.
    expect(applyBlocklist('class').hidden).toBe(false);
    expect(applyBlocklist('assess').hidden).toBe(false);
    expect(applyBlocklist('Scunthorpe').hidden).toBe(false);
    expect(applyBlocklist('the whole class passed the assessment').hidden).toBe(false);
    expect(applyBlocklist('I am from Scunthorpe').hidden).toBe(false);
  });

  it('still catches those same short terms on their own as whole words', () => {
    expect(applyBlocklist('ass').hidden).toBe(true);
    expect(applyBlocklist('cunt').hidden).toBe(true);
    expect(applyBlocklist('what an ass').hidden).toBe(true);
  });

  it('clean text is never hidden', () => {
    expect(applyBlocklist('I really enjoyed this session, thank you!').hidden).toBe(false);
    expect(applyBlocklist('').hidden).toBe(false);
  });
});
