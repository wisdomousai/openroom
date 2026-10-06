/**
 * The language-pair picker, shared by the space settings page and the live
 * lookup strip.
 *
 * Shared because the two must offer the same pairs. The dictionary can only
 * serve a pair it has a verified source for, so a picker that drifted from
 * `packages/schema/src/languages.ts` would be offering a lookup that returns
 * nothing — and a second copy of this logic is exactly how that drift starts.
 *
 * Order is fixed: students' language first, because it narrows what can be
 * taught. Not every language is taught into every one.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  NATIVE_LANGUAGES,
  isSupportedPair,
  taughtLanguagesFor,
  type LanguageChoice,
  type SpaceLanguages,
} from '@openroom/schema';

import { Label } from '@openroom/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@openroom/ui/components/select';

function label(choice: LanguageChoice): string {
  return choice.endonym === choice.name ? choice.name : `${choice.name} — ${choice.endonym}`;
}

/**
 * Choosing a students' language drops a taught one it cannot pair with.
 * Dropping it beats leaving a pair that no lookup can serve.
 */
export function taughtAfterNative(taught: string, native: string): string {
  return taught !== '' && !isSupportedPair(taught, native) ? '' : taught;
}

export interface LanguagePair {
  native: string;
  taught: string;
  chooseNative: (value: string) => void;
  chooseTaught: (value: string) => void;
  /** Both halves picked and the pair is one the dictionary can serve. */
  complete: boolean;
  /** Differs from what is stored, so Save has something to do. */
  changed: boolean;
}

/**
 * Pair state, seeded from what the space already has.
 *
 * `stored` may arrive late (it comes from a query), hence the effect rather
 * than a lazy initial value.
 */
export function useLanguagePair(stored: SpaceLanguages | null): LanguagePair {
  const [native, setNative] = useState<string>('');
  const [taught, setTaught] = useState<string>('');

  useEffect(() => {
    setNative(stored?.native ?? '');
    setTaught(stored?.taught ?? '');
  }, [stored?.native, stored?.taught]);

  const chooseNative = useCallback((value: string) => {
    setNative(value);
    setTaught((current) => taughtAfterNative(current, value));
  }, []);

  return {
    native,
    taught,
    chooseNative,
    chooseTaught: setTaught,
    complete: native !== '' && taught !== '' && isSupportedPair(taught, native),
    changed: taught !== (stored?.taught ?? '') || native !== (stored?.native ?? ''),
  };
}

/**
 * The two selects. `idPrefix` keeps the label/control association valid when
 * both this and another copy are on one page.
 */
export function LanguagePairFields({
  pair,
  disabled = false,
  idPrefix,
  className = 'flex flex-col gap-4',
  triggerClassName = 'w-[18rem]',
}: {
  pair: Pick<LanguagePair, 'native' | 'taught' | 'chooseNative' | 'chooseTaught'>;
  disabled?: boolean;
  idPrefix: string;
  className?: string;
  triggerClassName?: string;
}) {
  const taughtChoices = pair.native === '' ? [] : taughtLanguagesFor(pair.native);
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-native`}>Students’ language</Label>
        <Select value={pair.native} disabled={disabled} onValueChange={pair.chooseNative}>
          <SelectTrigger id={`${idPrefix}-native`} className={triggerClassName}>
            <SelectValue placeholder="Pick a language" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {NATIVE_LANGUAGES.map((choice) => (
                <SelectItem key={choice.code} value={choice.code}>
                  {label(choice)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-taught`}>Teaching</Label>
        <Select
          value={pair.taught}
          disabled={disabled || pair.native === ''}
          onValueChange={pair.chooseTaught}
        >
          <SelectTrigger id={`${idPrefix}-taught`} className={triggerClassName}>
            <SelectValue
              placeholder={pair.native === '' ? 'Pick a students’ language first' : 'Pick a language'}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {taughtChoices.map((choice) => (
                <SelectItem key={choice.code} value={choice.code}>
                  {label(choice)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
