import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { walkthroughOutputRoot } from './capture';

interface TimelineEntry {
  chapterId: string;
  title: string;
  narration: string;
  startMilliseconds: number;
  durationMilliseconds: number;
}

interface AudioChapter {
  chapterId: string;
  audioPath: string;
  durationMilliseconds: number;
}

interface AudioManifest {
  chapters: AudioChapter[];
}

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${args[0]} failed: ${stderr || stdout}`);
  return stdout;
}

function timestamp(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export async function renderJourneys(ids: string[]): Promise<void> {
  const root = walkthroughOutputRoot();
  const entries = ids.length === 0 || ids.includes('all')
    ? (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== 'openroom-baseline').map((entry) => entry.name)
    : ids;
  if (entries.length === 0) throw new Error('No captured journeys to render.');

  for (const id of entries) {
    const outputDir = join(root, id);
    const videoPath = join(outputDir, `${id}.webm`);
    const timelinePath = join(outputDir, 'timeline.json');
    const manifestPath = join(outputDir, 'audio-manifest.json');
    if (!(await Bun.file(videoPath).exists())) throw new Error(`Missing captured video: ${videoPath}`);
    if (!(await Bun.file(manifestPath).exists())) throw new Error(`Narrate first; missing ${manifestPath}`);
    const timeline = await Bun.file(timelinePath).json() as TimelineEntry[];
    const manifest = await Bun.file(manifestPath).json() as AudioManifest;
    const byChapter = new Map(manifest.chapters.map((chapter) => [chapter.chapterId, chapter]));
    const audioChapters = timeline.map((chapter) => {
      const audio = byChapter.get(chapter.chapterId);
      if (!audio) throw new Error(`Audio missing for ${id}/${chapter.chapterId}`);
      return { chapter, audio };
    });
    const filterParts: string[] = [];
    const inputs = ['-i', videoPath];
    audioChapters.forEach(({ chapter, audio }, index) => {
      inputs.push('-i', audio.audioPath);
      const delay = Math.max(0, Math.round(chapter.startMilliseconds));
      filterParts.push(`[${index + 1}:a]adelay=${delay}|${delay}[a${index}]`);
    });
    filterParts.push(`${audioChapters.map((_, index) => `[a${index}]`).join('')}amix=inputs=${audioChapters.length}:duration=longest:dropout_transition=0[aout]`);
    const mp4Path = join(outputDir, `${id}.mp4`);
    await command([
      'ffmpeg', '-y', ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '0:v:0', '-map', '[aout]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', mp4Path,
    ], outputDir);

    const vtt = ['WEBVTT', ''];
    audioChapters.forEach(({ chapter, audio }, index) => {
      const start = chapter.startMilliseconds;
      const end = start + audio.durationMilliseconds;
      vtt.push(String(index + 1), `${timestamp(start)} --> ${timestamp(end)}`, chapter.narration, '');
    });
    await Bun.write(join(outputDir, `${id}.vtt`), `${vtt.join('\n')}\n`);
    console.log(`Rendered ${mp4Path}`);
  }
}
