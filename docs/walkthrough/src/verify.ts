import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { walkthroughOutputRoot } from './capture';

interface VerifyResult {
  journeyId: string;
  screenshots: number;
  browserIssues: number;
  video: boolean;
  narration: boolean;
  rendered: boolean;
  passed: boolean;
  problems: string[];
}

async function probe(path: string): Promise<string> {
  const child = Bun.spawn([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height',
    '-of', 'json', path,
  ], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error(`ffprobe failed for ${path}: ${stderr || stdout}`);
  return stdout;
}

async function verifyJourney(id: string, root: string): Promise<VerifyResult> {
  const outputDir = join(root, id);
  const problems: string[] = [];
  const capturePath = join(outputDir, 'capture.json');
  const timelinePath = join(outputDir, 'timeline.json');
  const issuesPath = join(outputDir, 'browser-issues.json');
  let capture: { chaptersCaptured?: number; chapterCount?: number } | null = null;
  if (!(await Bun.file(capturePath).exists())) {
    problems.push('capture.json missing');
  } else {
    capture = await Bun.file(capturePath).json() as { chaptersCaptured?: number; chapterCount?: number };
    if (capture.chaptersCaptured !== capture.chapterCount) {
      problems.push(`capture incomplete: ${capture.chaptersCaptured ?? 0}/${capture.chapterCount ?? 0} chapters`);
    }
  }
  if (!(await Bun.file(timelinePath).exists())) problems.push('timeline.json missing');
  const screenshotDir = join(outputDir, 'screenshots');
  let screenshots = 0;
  try {
    screenshots = (await readdir(screenshotDir)).filter((file) => file.endsWith('.png')).length;
  } catch {
    screenshots = 0;
  }
  const expectedChapters = (await Bun.file(timelinePath).exists())
    ? (await Bun.file(timelinePath).json() as unknown[]).length
    : 0;
  if (screenshots !== expectedChapters) problems.push(`expected ${expectedChapters} screenshots, found ${screenshots}`);
  const browserIssues = (await Bun.file(issuesPath).exists())
    ? (await Bun.file(issuesPath).json() as unknown[]).length
    : 0;
  if (browserIssues > 0 && process.env.WALKTHROUGH_ALLOW_BROWSER_ISSUES !== '1') {
    problems.push(`${browserIssues} browser issue(s) recorded`);
  }
  const videoPath = join(outputDir, `${id}.webm`);
  const renderedPath = join(outputDir, `${id}.mp4`);
  const narration = await Bun.file(join(outputDir, 'audio-manifest.json')).exists();
  const rendered = await Bun.file(renderedPath).exists();
  const video = await Bun.file(videoPath).exists();
  if (!video) problems.push('captured WebM missing');
  if (video) {
    try {
      const metadata = JSON.parse(await probe(videoPath)) as { streams?: Array<{ codec_type?: string }> };
      if (!metadata.streams?.some((stream) => stream.codec_type === 'video')) problems.push('WebM has no video stream');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (narration) {
    const manifest = await Bun.file(join(outputDir, 'audio-manifest.json')).json() as { chapters?: unknown[] };
    if (!manifest.chapters || manifest.chapters.length !== expectedChapters) problems.push('audio chapter count does not match timeline');
  }
  if (process.env.WALKTHROUGH_REQUIRE_NARRATION === '1' && !narration) problems.push('narration required but audio-manifest.json is missing');
  if (process.env.WALKTHROUGH_REQUIRE_RENDERED === '1' && !rendered) problems.push('rendered MP4 required but missing');
  if (rendered) {
    try {
      const metadata = JSON.parse(await probe(renderedPath)) as { streams?: Array<{ codec_type?: string; codec_name?: string }> };
      const streams = metadata.streams ?? [];
      if (!streams.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264')) problems.push('rendered file has no H.264 video stream');
      if (!streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')) problems.push('rendered file has no AAC audio stream');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { journeyId: id, screenshots, browserIssues, video, narration, rendered, passed: problems.length === 0, problems };
}

export async function verifyJourneys(ids: string[]): Promise<void> {
  const root = walkthroughOutputRoot();
  let selected: string[];
  if (ids.length === 0 || ids.includes('all')) {
    selected = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'openroom-baseline' && await Bun.file(join(root, entry.name, 'capture.json')).exists()) {
        selected.push(entry.name);
      }
    }
  } else {
    selected = ids;
  }
  if (selected.length === 0) throw new Error('No captured journeys to verify.');
  const results: VerifyResult[] = [];
  for (const id of selected) results.push(await verifyJourney(id, root));
  await Bun.write(join(root, 'verification.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2)}\n`);
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.journeyId}: ${result.screenshots} screenshots, ${result.browserIssues} browser issues, narration=${result.narration}, rendered=${result.rendered}`);
    for (const problem of result.problems) console.log(`  - ${problem}`);
  }
  if (results.some((result) => !result.passed)) throw new Error('Walkthrough verification found failures.');
}
