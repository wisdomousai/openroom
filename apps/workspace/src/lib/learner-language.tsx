import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { learnerCopy, resolveLearnerLocale, type LearnerLocale } from './learner-copy';

const preferenceKey = 'openroom.learner.interface-language';
const LanguageContext = createContext({ locale: 'en' as LearnerLocale, copy: learnerCopy.en, setLocale: (_locale: LearnerLocale) => {} });

export function LearnerLanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(preferenceKey); } catch { /* Storage can be disabled. */ }
    return resolveLearnerLocale(saved, navigator.languages);
  });
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => { document.documentElement.lang = previous; };
  }, [locale]);
  const value = useMemo(() => ({ locale, copy: learnerCopy[locale], setLocale: (next: LearnerLocale) => {
    updateLocale(next);
    // Only the interface choice is persisted, never credentials, identity or work.
    try { localStorage.setItem(preferenceKey, next); } catch { /* The current page still changes. */ }
  } }), [locale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Shared audio also serves tutor pages, where the default English copy applies. */
export const useLearnerLanguage = () => useContext(LanguageContext);
