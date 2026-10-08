import { spawn, type ChildProcess } from 'node:child_process';

export interface CliLoginEvents {
  onOutput: (line: string) => void;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

export interface StartCliLoginInput extends CliLoginEvents {
  bin: string;
  args: string[];
  signedIn: () => boolean;
  openUrl: (url: string) => void;
  spawn?: typeof spawn;
  pollMs?: number;
  missingBinaryMessage: string;
}

export function firstHttpUrl(line: string): string | null {
  const match = line.match(/https?:\/\/\S+/);
  return match?.[0]?.replace(/[),.;]+$/, '') ?? null;
}

export function shouldOpenLoginUrl(line: string, url: string): boolean {
  return (
    /login|auth|oauth|accounts\.google\.com|openai\.com|chatgpt\.com/i.test(line) ||
    /accounts\.google\.com|auth\.openai\.com|chatgpt\.com/i.test(url)
  );
}

/** Spawn the Codex login CLI, stream output, open the OAuth URL, resolve when signedIn(). */
export function startCliLogin(input: StartCliLoginInput): () => void {
  const spawnFn = input.spawn ?? spawn;
  const child: ChildProcess = spawnFn(input.bin, input.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let settled = false;

  const finish = (err?: Error) => {
    if (settled) return;
    settled = true;
    clearInterval(poll);
    if (err) input.onError(err);
    else input.onSuccess();
  };

  const considerSuccess = () => {
    if (input.signedIn()) finish();
  };

  const handleChunk = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() === '') continue;
      input.onOutput(line);
      const url = firstHttpUrl(line);
      if (url !== null && shouldOpenLoginUrl(line, url)) input.openUrl(url);
    }
    considerSuccess();
  };

  child.on('error', (err: NodeJS.ErrnoException) => {
    finish(
      err.code === 'ENOENT' ? new Error(input.missingBinaryMessage) : err instanceof Error ? err : new Error(String(err)),
    );
  });
  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);
  child.on('exit', () => {
    if (input.signedIn()) finish();
    else finish(new Error('Sign-in finished before credentials were available.'));
  });

  const poll = setInterval(considerSuccess, input.pollMs ?? 750);
  considerSuccess();

  return () => {
    if (!settled) {
      settled = true;
      clearInterval(poll);
      if (!child.killed) child.kill();
    }
  };
}
