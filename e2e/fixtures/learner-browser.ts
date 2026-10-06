import { test as base, chromium, webkit, type Browser } from '@playwright/test';

// The tutor keeps Playwright's normal browser. Learners run in another process,
// with independent contexts for each person. WebKit is an optional local check.
export const test = base.extend<{ learnerBrowser: Browser }>({
  learnerBrowser: async ({}, use, testInfo) => {
    const name = process.env.OPENROOM_E2E_LEARNER_ENGINE ?? 'chromium';
    if (name !== 'chromium' && name !== 'webkit') throw new Error(`Unsupported learner engine: ${name}`);
    const browser = await (name === 'webkit' ? webkit : chromium).launch();
    try {
      testInfo.annotations.push({ type: 'learner-browser', description: `${name} ${browser.version()} · separate process` });
      await use(browser);
    } finally { await browser.close(); }
  },
});
