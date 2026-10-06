import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAgentSessionStore, type AgentSessionStore } from './session-store.js';
import type { AgentRunRequest } from './types.js';

const mcp = { command: '/App/OpenRoom', args: ['/App/mcp-stdio.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return { host: 'claude', prompt: 'go', attachments: [], folders: [], conversationId: null, ...overrides };
}

describe('agent session store', () => {
  let root: string;
  let skillsRoot: string;
  let store: AgentSessionStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-sessions-'));
    skillsRoot = join(root, 'skills');
    for (const name of ['prepare-a-tutoring-outline', 'run-a-session']) {
      await mkdir(join(skillsRoot, name), { recursive: true });
      await writeFile(join(skillsRoot, name, 'SKILL.md'), `# ${name}\n`, 'utf8');
    }
    store = createAgentSessionStore({
      runsRoot: () => join(root, 'runs'),
      workspacesRoot: () => join(root, 'workspaces'),
      skillsRoot: () => skillsRoot,
      mcp: () => mcp,
    });
  });

  it('creates a workdir with skills (including run-a-session) on the first turn', async () => {
    const session = await store.acquire(1, 'deck:one', request());
    expect(session.firstTurn).toBe(true);
    expect(existsSync(join(session.workdir.path, '.claude', 'skills', 'run-a-session', 'SKILL.md'))).toBe(true);
    expect(existsSync(session.workdir.claudeMcpConfigPath)).toBe(true);
  });

  it('reuses the workdir on later turns and copies only the new attachments', async () => {
    const fileA = join(root, 'a.pdf');
    const fileB = join(root, 'b.pdf');
    await writeFile(fileA, 'a', 'utf8');
    await writeFile(fileB, 'b', 'utf8');

    const first = await store.acquire(1, 'deck:one', request({ attachments: [fileA], folders: ['/School'] }));
    const second = await store.acquire(
      1,
      'deck:one',
      request({ conversationId: first.id, attachments: [fileB], folders: ['/School', '/More'] }),
    );
    expect(second.workdir.path).toBe(first.workdir.path);
    expect(second.firstTurn).toBe(false);
    expect(second.newAttachmentPaths).toEqual([join(second.workdir.attachmentsDir, 'b.pdf')]);
    expect(second.newFolders).toEqual(['/More']);
    expect(second.folders).toEqual(['/School', '/More']);
    expect(await readdir(first.workdir.attachmentsDir)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('starts fresh when the host changes mid-conversation', async () => {
    const first = await store.acquire(1, 'deck:one', request());
    const second = await store.acquire(1, 'deck:one', request({ conversationId: first.id, host: 'codex' }));
    expect(second.id).not.toBe(first.id);
    expect(second.firstTurn).toBe(true);
    expect(second.workdir.path).toBe(first.workdir.path);
    expect(existsSync(first.workdir.path)).toBe(true);
  });

  it('records the resume handle for follow-up turns', async () => {
    const session = await store.acquire(1, 'deck:one', request());
    await writeFile(join(session.workdir.path, 'notes.md'), 'deck notes', 'utf8');
    await store.recordResume(session, 'sess-1');
    expect(session.resumeId).toBe('sess-1');
    await store.recordResume(session, null);
    expect(session.resumeId).toBe('sess-1');
    await store.disposeSender(1);

    const restarted = createAgentSessionStore({
      runsRoot: () => join(root, 'runs'),
      workspacesRoot: () => join(root, 'workspaces'),
      skillsRoot: () => skillsRoot,
      mcp: () => mcp,
    });
    const active = (await restarted.load('deck:one')).active;
    const resumed = await restarted.acquire(
      2,
      'deck:one',
      request({ conversationId: active?.id ?? null }),
    );
    expect(resumed.resumeId).toBe('sess-1');
    expect(await readFile(join(resumed.workdir.path, 'notes.md'), 'utf8')).toBe('deck notes');
  });

  it('disposeSender removes temporary attachments but retains the deck workspace and chat', async () => {
    const attachment = join(root, 'private.pdf');
    await writeFile(attachment, 'private', 'utf8');
    const a = await store.acquire(1, 'deck:one', request({ attachments: [attachment] }));
    await store.beginTurn(a, request({ prompt: 'Keep this chat', attachments: [attachment] }));
    store.recordEvent(a, { kind: 'text', text: 'Done.' });
    await store.finishTurn(a);
    await store.disposeSender(1);
    expect(existsSync(a.workdir.path)).toBe(true);
    expect(existsSync(join(root, 'runs', a.id))).toBe(false);
    expect((await store.load('deck:one')).active?.messages).toHaveLength(2);
  });

  it('codexHandoff hands over the workdir, and the thread only when Codex owns it', async () => {
    // A Codex conversation with a recorded thread travels whole.
    const codexSession = await store.acquire(1, 'deck:one', request({ host: 'codex', model: 'gpt-5.6-luna' }));
    await store.beginTurn(codexSession, request({ host: 'codex' }));
    await store.finishTurn(codexSession);
    await store.recordResume(codexSession, 'thread-9');
    const handoff = await store.codexHandoff('deck:one');
    expect(handoff).toEqual({ workdir: codexSession.workdir.path, resumeId: 'thread-9', modelId: 'gpt-5.6-luna' });
    // The workdir carries the same brief the embedded run gets.
    expect(existsSync(join(handoff.workdir, 'AGENTS.md'))).toBe(true);

    // A Claude-owned conversation hands over the workdir but no foreign thread.
    const claudeSession = await store.acquire(1, 'deck:two', request());
    await store.beginTurn(claudeSession, request());
    await store.finishTurn(claudeSession);
    await store.recordResume(claudeSession, 'claude-sess');
    expect(await store.codexHandoff('deck:two')).toEqual({
      workdir: claudeSession.workdir.path,
      resumeId: null,
      modelId: null,
    });

    // A deck with no conversation still gets a briefed workdir to start in.
    const fresh = await store.codexHandoff('deck:new');
    expect(fresh.resumeId).toBeNull();
    expect(existsSync(join(fresh.workdir, 'AGENTS.md'))).toBe(true);
  });

  it('archives chats on reset and can select one again', async () => {
    const first = await store.acquire(1, 'deck:one', request({ prompt: 'First request' }));
    await store.beginTurn(first, request({ prompt: 'First request' }));
    store.recordEvent(first, { kind: 'text', text: 'First answer' });
    await store.finishTurn(first);
    const reset = await store.reset(1, 'deck:one');
    expect(reset.active).toBeNull();
    expect(reset.history.map((item) => item.preview)).toEqual(['First request']);
    const selected = await store.select('deck:one', first.id);
    expect(selected.active?.id).toBe(first.id);
  });
});
