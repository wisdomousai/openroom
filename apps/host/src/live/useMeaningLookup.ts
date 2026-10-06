import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalJson } from '@openroom/schema';
import { ApiError, lookupDictionary, setSpaceLanguages, unconfiguredSpace } from '../api';
import type { BreakoutLookup } from '../MeaningBreakout';
import { useLanguagePair } from '../components/LanguagePairFields';
import type { HostCommand, HostSnapshot } from '../types';

interface MeaningLookupDeps {
  sessionCode: string;
  snapshot: HostSnapshot | null;
  run: (command: HostCommand) => Promise<boolean>;
}

/**
 * Lookup flow: click a word on the plate → the meaning breakout opens over
 * the slide and owns everything from there — sense choice, typed meanings,
 * the pair setter, the push. Not free-floating “type anything” translation.
 *
 * What the last lookup produced stays private to this console until the tutor
 * presses the push — the projection is the command, so there is nowhere else
 * for a draft to live. It is kept across Close so “Reopen card” works.
 */
export function useMeaningLookup({ sessionCode, snapshot, run }: MeaningLookupDeps) {
  const [lookUpTarget, setLookUpTarget] = useState<{
    stepId: string;
    partKey: string;
    token: number;
    word: string;
  } | null>(null);
  /** The ribbon launcher armed the next word click. Single-shot. */
  const [lookUpArmed, setLookUpArmed] = useState(false);
  const [lookup, setLookup] = useState<BreakoutLookup | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  /** The meaning that would go under the word — picked or typed on the card. */
  const [chosen, setChosen] = useState('');
  const [sections, setSections] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const publishLock = useRef(false);
  const stepId = snapshot?.outline?.content.steps[snapshot.outline.currentStepIndex]?.id;
  /*
   * Set when a lookup failed only because the space has no language pair, and
   * the failure named the space. The card then carries the picker itself: the
   * setting is two clicks away, not a page away, and the session keeps running.
   */
  const [unconfigured, setUnconfigured] = useState<{ spaceId: string; canEdit: boolean } | null>(
    null,
  );
  const [pairSaving, setPairSaving] = useState(false);
  // No stored pair to seed from — an unconfigured space is the only way here.
  const languagePair = useLanguagePair(null);

  const toggleArmed = useCallback(() => {
    setCardOpen(false);
    setLookUpArmed((armed) => !armed);
  }, []);
  const openCard = useCallback(() => {
    setLookUpArmed(false);
    setCardOpen(true);
  }, []);
  const closeCard = useCallback(() => {
    setCardOpen(false);
    if (lookup?.kind === 'loading') {
      epoch.current += 1; request.current?.abort();
      setLookup({ kind: 'typed', word: lookup.word, note: 'Lookup cancelled. Type a meaning or look up the word again.' });
    }
  }, [lookup]);

  useEffect(() => {
    epoch.current += 1; request.current?.abort();
    setLookUpTarget(null); setLookup(null); setCardOpen(false); setChosen('');
    setSections([]); setPublishError(null); setPairSaving(false); setLookUpArmed(false);
    return () => { epoch.current += 1; request.current?.abort(); };
  }, [sessionCode, stepId]);

  /**
   * Look a word up where it stands: fetch it and open the breakout over the
   * slide. Nothing is published here — the card owns the push, so nothing has
   * left this screen until the tutor presses it.
   *
   * A lookup that finds nothing keeps the card open in its typed state, where
   * the tutor writes the meaning themselves.
   */
  const lookUpWord = useCallback(
    (target: { partKey: string; token: number; word: string }) => {
      if (!stepId) return;
      const generation = ++epoch.current;
      request.current?.abort();
      const controller = new AbortController(); request.current = controller;
      setLookUpTarget({ ...target, stepId });
      setChosen('');
      setSections([]); setPublishError(null); setPairSaving(false);
      setUnconfigured(null);
      setLookUpArmed(false);
      setLookup({ kind: 'loading', word: target.word });
      setCardOpen(true);
      void lookupDictionary({ word: target.word, scope: { sessionCode } }, controller.signal)
        .then((result) => {
          if (generation !== epoch.current) return;
          if (result.entry === null) {
            setLookup({
              kind: 'typed',
              word: target.word,
              note:
                result.unsupported === 'language'
                  ? 'No dictionary for this language. Type what it means and it goes up as it stands.'
                  : 'No entry found. Type what it means and it goes up as it stands.',
            });
            return;
          }
          /*
           * The translation leads and the entry's own senses follow it: for an
           * English-speaking class the two are the same list, and for everyone
           * else the translation is the one the tutor actually wants.
           */
          setChosen(result.meaning ?? result.entry.senses[0]?.gloss ?? '');
          setLookup({
            kind: 'entry',
            word: target.word,
            entry: result.entry,
            translation: result.meaning,
            note:
              result.unsupported === 'meaning-language'
                ? 'No translation for this pair — showing the entry’s own senses.'
                : null,
          });
        })
        .catch((error: unknown) => {
          if (generation !== epoch.current || controller.signal.aborted) return;
          /*
           * An unconfigured space is the one failure the tutor can clear from
           * here, so it is the one that gets its own branch. Everything else —
           * including this route's other 422, an unusable word — is a note.
           */
          const space = unconfiguredSpace(error);
          if (space !== null) {
            setUnconfigured(space);
            if (space.canEdit) {
              setLookup({
                kind: 'pair',
                word: target.word,
                note: 'This space has no language pair set, so there is nothing to look it up in.',
              });
            } else {
              setLookup({
                kind: 'typed',
                word: target.word,
                note: 'This space has no language pair set. An editor can set it — type a meaning.',
              });
            }
            return;
          }
          setLookup({
            kind: 'typed',
            word: target.word,
            note:
              error instanceof ApiError && error.status === 429
                ? 'Too many lookups — wait a minute, or type a meaning.'
                : 'Lookup failed — type a meaning.',
          });
        });
    },
    [sessionCode, stepId],
  );

  const entry = lookup?.kind === 'entry' ? { ...lookup.entry, sections: lookup.entry.sections.filter((section) => sections.includes(section.key)) } : undefined;
  const hasPublishedHere = Boolean(lookUpTarget && lookUpTarget.stepId === stepId && (
    snapshot?.meaning?.partKey === lookUpTarget.partKey && snapshot.meaning.token === lookUpTarget.token ||
    snapshot?.dictionary?.partKey === lookUpTarget.partKey && snapshot.dictionary.token === lookUpTarget.token));
  const pushedHere = hasPublishedHere && (snapshot?.meaning?.text ?? '') === chosen.trim() && canonicalJson(snapshot?.dictionary?.entry ?? null) === canonicalJson(entry ?? null);
  const canPublish = Boolean(lookUpTarget && lookUpTarget.stepId === stepId && lookup?.kind !== 'loading' && lookup?.kind !== 'pair' && chosen.length <= 200 && (chosen.trim() || sections.length));

  /** One live command publishes or replaces the complete card. Drafts never leave this hook. */
  const pushCard = async () => {
    if (!lookUpTarget || !canPublish || publishLock.current) return;
    publishLock.current = true; setPublishing(true); setPublishError(null);
    const generation = epoch.current;
    try {
      const ok = await run({ command: 'meaning.publish', ...lookUpTarget,
        ...(chosen.trim() ? { text: chosen.trim() } : {}), ...(entry ? { entry } : {}),
      });
      if (!ok && generation === epoch.current) setPublishError('The card could not be shown. Your draft is still here; try again.');
    } catch {
      if (generation === epoch.current) setPublishError('The card could not be shown. Your draft is still here; try again.');
    } finally { publishLock.current = false; setPublishing(false); }
  };

  const takeDownCard = async () => {
    if (!lookUpTarget || publishLock.current) return;
    publishLock.current = true; setPublishing(true); setPublishError(null);
    const generation = epoch.current;
    try {
      const ok = await run({ command: 'meaning.clear', stepId: lookUpTarget.stepId, partKey: lookUpTarget.partKey, token: lookUpTarget.token });
      if (!ok && generation === epoch.current) setPublishError('The card could not be taken down. Try again.');
    } catch { if (generation === epoch.current) setPublishError('The card could not be taken down. Try again.'); }
    finally { publishLock.current = false; setPublishing(false); }
  };

  /** Fall back to typing when the entry will not do (or the pair cannot be saved). */
  const typeInstead = useCallback((word: string) => {
    epoch.current += 1; request.current?.abort(); setSections([]); setPairSaving(false); setPublishError(null);
    setLookup({
      kind: 'typed',
      word,
      note: 'Type what it means and it goes up as it stands.',
    });
  }, []);

  const savePair = useCallback(() => {
    const target = lookUpTarget;
    if (target === null || unconfigured === null) return;
    const generation = epoch.current;
    setPairSaving(true);
    void setSpaceLanguages(unconfigured.spaceId, {
      taught: languagePair.taught,
      native: languagePair.native,
    })
      .then(() => {
        // The word the tutor clicked is still the word they want, so the pair
        // lands and the lookup resumes.
        if (generation === epoch.current) lookUpWord(target);
      })
      .catch(() => {
        if (generation !== epoch.current) return;
        setLookup({
          kind: 'typed',
          word: target.word,
          note: 'Could not save the language pair — type a meaning.',
        });
      })
      .finally(() => {
        if (generation === epoch.current) setPairSaving(false);
      });
  }, [lookUpTarget, unconfigured, languagePair, lookUpWord]);

  return {
    lookUpTarget,
    lookUpArmed,
    toggleArmed,
    lookup,
    chosen,
    setChosen,
    cardOpen,
    openCard,
    closeCard,
    unconfigured,
    pairSaving,
    languagePair,
    pushedHere,
    hasPublishedHere,
    canPublish,
    publishing,
    publishError,
    sections,
    setSections,
    lookUpWord,
    pushCard,
    takeDownCard,
    savePair,
    typeInstead,
  };
}
