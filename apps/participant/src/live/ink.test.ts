import { describe, expect, it } from 'vitest';
import { lookupWord } from './ink';

describe('lookupWord', () => {
  it('drops the punctuation a word carries in running text', () => {
    expect(lookupWord('passé,')).toBe('passé');
    expect(lookupWord('(vraiment)')).toBe('vraiment');
    expect(lookupWord('«Bonjour»')).toBe('Bonjour');
    expect(lookupWord('¿Qué?')).toBe('Qué');
  });

  it('keeps inner apostrophes and hyphens', () => {
    expect(lookupWord("l'école,")).toBe("l'école");
    expect(lookupWord('peut-être;')).toBe('peut-être');
    expect(lookupWord('qu’il.')).toBe('qu’il');
  });

  it('gives nothing for a token without letters', () => {
    expect(lookupWord('—')).toBeNull();
    expect(lookupWord('42.')).toBeNull();
  });

  it('does not turn a number with a suffix into another word', () => {
    expect(lookupWord('1er')).toBeNull();
    expect(lookupWord('19h30,')).toBeNull();
  });
});
