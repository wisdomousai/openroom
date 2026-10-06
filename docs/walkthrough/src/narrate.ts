import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadJourneys } from './journeys';
import { walkthroughOutputRoot } from './capture';

interface TimelineEntry {
  chapterId: string;
  title: string;
  narration: string;
  startMilliseconds: number;
  durationMilliseconds: number;
}

interface AudioChapter {
  journeyId: string;
  chapterId: string;
  title: string;
  narration: string;
  sourceHash: string;
  audioPath: string;
  durationMilliseconds: number;
}

interface AudioManifest {
  journeyId: string;
  generatedAt: string;
  model: string;
  voice: string;
  style: string;
  chapters: AudioChapter[];
}

const model = process.env.MIMO_TTS_MODEL ?? 'mimo-v2.5-tts';
const voice = process.env.MIMO_TTS_VOICE ?? 'Milo';
const style = process.env.MIMO_TTS_STYLE ?? 'Warm, specific product guide. Speak like an experienced colleague walking through the real workflow.';
const baseUrl = (process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1').replace(/\/$/, '');
const timeoutSeconds = Number(process.env.MIMO_TTS_TIMEOUT ?? 180);

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${args[0]} failed: ${stderr || stdout}`);
  return stdout;
}

async function durationMilliseconds(audioPath: string): Promise<number> {
  const output = await command([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioPath,
  ], dirname(audioPath));
  const seconds = Number.parseFloat(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read audio duration: ${audioPath}`);
  return Math.round(seconds * 1_000);
}

function hashFor(narration: string): string {
  return createHash('sha256').update(JSON.stringify({ model, voice, style, narration })).digest('hex');
}

async function generateChapter(journeyId: string, chapter: TimelineEntry, audioDir: string): Promise<AudioChapter> {
  const narration = chapter.narration.trim();
  const sourceHash = hashFor(narration);
  const stem = `${journeyId}-${chapter.chapterId}`;
  const mp3Path = join(audioDir, `${stem}.mp3`);
  const cachePath = join(audioDir, `${stem}.json`);
  if (await Bun.file(mp3Path).exists() && await Bun.file(cachePath).exists()) {
    const cached = await Bun.file(cachePath).json() as AudioChapter;
    if (cached.sourceHash === sourceHash) return cached;
  }

  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) throw new Error('MIMO_API_KEY is missing. Put it in docs/walkthrough/.env.local.');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutSeconds * 1_000),
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: style },
        { role: 'assistant', content: narration },
      ],
      audio: { format: 'wav', voice },
    }),
  });
  if (!response.ok) throw new Error(`MiMo TTS failed: HTTP ${response.status} ${await response.text()}`);
  const payload = await response.json() as {
    choices?: Array<{ message?: { audio?: { data?: string } } }>;
  };
  const base64 = payload.choices?.[0]?.message?.audio?.data;
  if (!base64) throw new Error('MiMo TTS response did not contain choices[0].message.audio.data');

  const wavPath = join(audioDir, `${stem}.wav`);
  await Bun.write(wavPath, Buffer.from(base64, 'base64'));
  await command(['ffmpeg', '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3Path], audioDir);
  const duration = await durationMilliseconds(mp3Path);
  const result: AudioChapter = {
    journeyId,
    chapterId: chapter.chapterId,
    title: chapter.title,
    narration,
    sourceHash,
    audioPath: mp3Path,
    durationMilliseconds: duration,
  };
  await Bun.write(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  await rm(wavPath, { force: true });
  return result;
}

export async function narrateJourneys(ids: string[]): Promise<void> {
  const journeys = await loadJourneys();
  const selected = ids.length === 0 || ids.includes('all')
    ? journeys
    : journeys.filter((journey) => ids.includes(journey.id));
  if (selected.length === 0) throw new Error(`No matching journey: ${ids.join(', ')}`);
  if (!process.env.MIMO_API_KEY) throw new Error('MIMO_API_KEY is missing. Put it in docs/walkthrough/.env.local.');

  for (const journey of selected) {
    const outputDir = join(walkthroughOutputRoot(), journey.id);
    const timelinePath = join(outputDir, 'timeline.json');
    if (!(await Bun.file(timelinePath).exists())) {
      throw new Error(`Capture first; missing ${timelinePath}`);
    }
    const timeline = await Bun.file(timelinePath).json() as TimelineEntry[];
    const audioDir = join(outputDir, 'audio');
    await Bun.write(join(audioDir, '.keep'), '');
    const chapters: AudioChapter[] = [];
    for (const chapter of timeline) {
      console.log(`Narrating ${journey.id}/${chapter.chapterId}`);
      chapters.push(await generateChapter(journey.id, chapter, audioDir));
    }
    const manifest: AudioManifest = {
      journeyId: journey.id,
      generatedAt: new Date().toISOString(),
      model,
      voice,
      style,
      chapters,
    };
    await Bun.write(join(outputDir, 'audio-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
