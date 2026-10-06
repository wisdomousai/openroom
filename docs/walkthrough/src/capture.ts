import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadJourneys } from './journeys';
import { seedJourney } from './seed';
import type {
  WalkthroughAction,
  WalkthroughChapter,
  WalkthroughJourney,
  WalkthroughRuntime,
} from './types';

const walkthroughDir = resolve(import.meta.dir, '..');
const repoRoot = resolve(walkthroughDir, '../..');
const playwrightCli = resolve(walkthroughDir, 'scripts/playwright-cli.sh');
const origin = (process.env.OPENROOM_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const commandTimeoutMs = Number(process.env.WALKTHROUGH_COMMAND_TIMEOUT ?? 90_000);

interface CliResult {
  output: string;
  exitCode: number;
}

interface TimelineEntry {
  chapterId: string;
  title: string;
  narration: string;
  startMilliseconds: number;
  durationMilliseconds: number;
}

function cleanEnvironment(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

async function runCli(session: string, cwd: string, args: string[], timeoutMs = commandTimeoutMs): Promise<CliResult> {
  const child = Bun.spawn([playwrightCli, ...args], {
    cwd,
    env: cleanEnvironment({ PLAYWRIGHT_CLI_SESSION: session }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((_, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Playwright CLI timed out after ${timeoutMs}ms: ${args.join(' ')}`));
    }, timeoutMs);
  });
  try {
    const exitCode = await Promise.race([child.exited, timeout]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { output: `${stdout}${stderr}`.trim(), exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mustSucceed(result: CliResult, args: string[]): string {
  if (result.exitCode !== 0) {
    throw new Error(`Playwright CLI failed (${result.exitCode}) for ${args.join(' ')}\n${result.output}`);
  }
  return result.output;
}

function interpolate(value: string, runTag: string): string {
  return value.replaceAll('{{runTag}}', runTag);
}

function locatorCode(action: Extract<WalkthroughAction, { type: 'expectRole' | 'clickRole' }>, operation: string): string {
  const options = [
    `name: ${JSON.stringify(action.name)}`,
    `exact: ${action.exact ?? true}`,
    ...(action.type === 'expectRole' && action.level ? [`level: ${action.level}`] : []),
  ].join(', ');
  return `const locator = page.getByRole(${JSON.stringify(action.role)}, { ${options} }).first(); await locator.waitFor({ state: 'visible', timeout: 30000 }); ${operation}`;
}

function labelLocatorCode(label: string, exact = true): string {
  return `page.getByLabel(${JSON.stringify(label)}, { exact: ${exact} }).first()`;
}

function textLocatorCode(text: string, exact = true): string {
  return `page.getByText(${JSON.stringify(text)}, { exact: ${exact} }).first()`;
}

async function sessionCode(session: string, outputDir: string, body: string): Promise<void> {
  const code = `async (page) => { ${body} }`;
  mustSucceed(await runCli(session, outputDir, ['session-code', code]), ['session-code', code]);
}

async function executeAction(
  session: string,
  outputDir: string,
  action: WalkthroughAction,
  runtime: WalkthroughRuntime | null,
  runTag: string,
): Promise<void> {
  switch (action.type) {
    case 'goto': {
      const url = new URL(interpolate(action.path, runTag), origin).toString();
      mustSucceed(await runCli(session, outputDir, ['goto', url]), ['goto', url]);
      return;
    }
    case 'gotoRuntime': {
      if (!runtime) throw new Error(`Action needs seeded runtime, but this journey has none: ${action.target}`);
      const url = runtime.paths[action.target];
      mustSucceed(await runCli(session, outputDir, ['goto', url]), ['goto', url]);
      return;
    }
    case 'expectRole': {
      await sessionCode(session, outputDir, locatorCode(action, ''));
      return;
    }
    case 'expectText': {
      const body = `const locator = ${textLocatorCode(interpolate(action.text, runTag), action.exact ?? false)}; await locator.waitFor({ state: 'visible', timeout: 30000 });`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'expectTextCount': {
      const text = interpolate(action.text, runTag);
      const body = `const count = await page.getByText(${JSON.stringify(text)}, { exact: ${action.exact ?? false} }).count(); if (count !== ${action.count}) throw new Error('Expected ${action.count} matches for ${text}, got ' + count);`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'clickRole': {
      await sessionCode(session, outputDir, locatorCode(action, 'await locator.click();'));
      return;
    }
    case 'clickText': {
      const text = interpolate(action.text, runTag);
      const body = `const locator = ${textLocatorCode(text, action.exact ?? true)}; await locator.waitFor({ state: 'visible', timeout: 30000 }); await locator.click();`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'fillLabel': {
      const label = interpolate(action.label, runTag);
      const value = interpolate(action.value, runTag);
      const body = `const locator = ${labelLocatorCode(label, action.exact ?? true)}; await locator.waitFor({ state: 'visible', timeout: 30000 }); await locator.fill(${JSON.stringify(value)});`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'checkLabel': {
      const label = interpolate(action.label, runTag);
      const index = action.nth ?? 0;
      const body = `const locator = page.getByLabel(${JSON.stringify(label)}, { exact: ${action.exact ?? true} }).nth(${index}); await locator.waitFor({ state: 'visible', timeout: 30000 }); if (!(await locator.isChecked())) await locator.check();`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'selectLabelText': {
      const label = interpolate(action.label, runTag);
      const text = interpolate(action.text, runTag);
      const body = `const locator = ${labelLocatorCode(label, action.exact ?? true)}; await locator.waitFor({ state: 'visible', timeout: 30000 }); await locator.selectOption({ label: ${JSON.stringify(text)} });`;
      await sessionCode(session, outputDir, body);
      return;
    }
    case 'pause':
      await Bun.sleep(action.milliseconds);
      return;
  }
}

function narrationDurationMilliseconds(chapter: WalkthroughChapter): number {
  const words = chapter.narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2_500, Math.round((words / 2.45) * 1_000));
}

async function captureJourney(journey: WalkthroughJourney, outputRoot: string): Promise<void> {
  const outputDir = join(outputRoot, journey.id);
  await mkdir(join(outputDir, 'screenshots'), { recursive: true });
  await mkdir(join(outputDir, 'snapshots'), { recursive: true });
  const runtime = await seedJourney(journey, outputDir);
  const runTag = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
  const session = `walkthrough-${journey.id}-${Date.now()}`;
  const timeline: TimelineEntry[] = [];
  const browserErrors: string[] = [];
  const captureStartedAt = Date.now();
  let captureError: unknown = null;

  try {
    const initialUrl = new URL('/', origin).toString();
    const openArgs = ['open', initialUrl];
    if (process.env.WALKTHROUGH_HEADED === '1') openArgs.push('--headed');
    mustSucceed(await runCli(session, outputDir, openArgs), openArgs);
    mustSucceed(await runCli(session, outputDir, ['tracing-start']), ['tracing-start']);
    mustSucceed(await runCli(session, outputDir, ['video-start', `${journey.id}.webm`]), ['video-start']);

    for (const chapter of journey.chapters) {
      const startMilliseconds = Date.now() - captureStartedAt;
      for (const action of chapter.actions) {
        await executeAction(session, outputDir, action, runtime, runTag);
      }
      const screenshotName = `screenshots/${chapter.id}.png`;
      const snapshotName = `snapshots/${chapter.id}.yaml`;
      mustSucceed(
        await runCli(session, outputDir, ['snapshot', `--filename=${snapshotName}`]),
        ['snapshot', snapshotName],
      );
      mustSucceed(
        await runCli(session, outputDir, ['screenshot', `--filename=${screenshotName}`, '--full-page']),
        ['screenshot', screenshotName],
      );
      const chapterMarker = `video-chapter ${chapter.title}`;
      mustSucceed(await runCli(session, outputDir, ['video-chapter', chapter.title]), [chapterMarker]);
      const durationMilliseconds = narrationDurationMilliseconds(chapter);
      timeline.push({
        chapterId: chapter.id,
        title: chapter.title,
        narration: chapter.narration,
        startMilliseconds,
        durationMilliseconds,
      });
      await Bun.sleep(durationMilliseconds);
    }
  } catch (error) {
    captureError = error;
    browserErrors.push(error instanceof Error ? error.message : String(error));
    try {
      await runCli(session, outputDir, ['snapshot', '--filename=snapshots/failure.yaml']);
      await runCli(session, outputDir, ['screenshot', '--filename=screenshots/failure.png', '--full-page']);
    } catch (failureCaptureError) {
      browserErrors.push(`failure evidence: ${failureCaptureError instanceof Error ? failureCaptureError.message : String(failureCaptureError)}`);
    }
  } finally {
    for (const [name, args] of [
      ['trace-stop', ['tracing-stop']],
      ['video-stop', ['video-stop']],
    ] as const) {
      try {
        mustSucceed(await runCli(session, outputDir, args), args);
      } catch (error) {
        browserErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const [name, args] of [
      ['console', ['console']],
      ['requests', ['requests']],
    ] as const) {
      try {
        const result = await runCli(session, outputDir, args);
        await Bun.write(join(outputDir, `cli-${name}.txt`), `${result.output}\n`);
        if (result.output.includes('[ERROR]')) browserErrors.push(`${name} reported browser errors`);
      } catch (error) {
        browserErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      await runCli(session, outputDir, ['close']);
    } catch (error) {
      browserErrors.push(`close: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await Bun.write(join(outputDir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  await Bun.write(join(outputDir, 'browser-issues.json'), `${JSON.stringify(browserErrors, null, 2)}\n`);
  await Bun.write(join(outputDir, 'capture.json'), `${JSON.stringify({
    journeyId: journey.id,
    title: journey.title,
    capturedAt: new Date().toISOString(),
    runTag,
    runtime: runtime ? 'seeded' : 'none',
    chaptersCaptured: timeline.length,
    chapterCount: journey.chapters.length,
    outputDir,
  }, null, 2)}\n`);

  if (captureError) throw captureError;
}

export function walkthroughOutputRoot(): string {
  const configured = process.env.WALKTHROUGH_OUTPUT_DIR ?? 'docs/walkthrough/output';
  return resolve(repoRoot, configured);
}

export async function captureJourneys(ids: string[]): Promise<void> {
  const journeys = await loadJourneys();
  const selected = ids.length === 0 || ids.includes('all')
    ? journeys
    : journeys.filter((journey) => ids.includes(journey.id));
  if (selected.length === 0) throw new Error(`No matching journey: ${ids.join(', ')}`);
  const outputRoot = walkthroughOutputRoot();
  await mkdir(outputRoot, { recursive: true });
  for (const journey of selected) {
    console.log(`Capturing ${journey.id} into ${join(outputRoot, journey.id)}`);
    await captureJourney(journey, outputRoot);
    console.log(`Captured ${journey.id}`);
  }
}
