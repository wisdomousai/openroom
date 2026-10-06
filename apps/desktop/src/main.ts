import { localResourceResponse } from './resource-response.js';
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  webContents,
  type Display,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, rename, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { registerAgentIpc, type AgentIpcHandle } from './agents/ipc.js';
import { createAskQuestionBroker } from './agents/ask-question.js';
import { sweepAgentRuns } from './agents/session-store.js';
import {
  decideDesktopNavigation,
  desktopGoogleStartUrl,
  parseDesktopAuthHandoff,
  parseDesktopDeckHandoff,
  withDesktopAuthFlag,
} from './auth-navigation.js';
import { prepareDesktopDeckHandoff } from './deck-handoff.js';
import { createRelayStore, defaultRelayFile } from './relay.js';
import { desktopMcpSocketPath, startDesktopMcpServer } from './mcp-host.js';
import { adoptLoginShellPath } from './shell-path.js';
import { startDesktopUpdateChecks } from './updates.js';
import {
  createOpenRoomWorkingDirectory,
  disposeOpenRoomWorkingDirectory,
  copyPdfPages,
  extractPdfResource,
  importOpenRoomResource,
  inspectPdf,
  pdfPageRangeName,
  readOpenRoomPackage,
  writeOpenRoomPackage,
} from './openroom-package.js';
import type { OpenRoomFileResourceV1, OpenRoomResourceContentType } from '@openroom/schema';

protocol.registerSchemesAsPrivileged([{ scheme: 'openroom', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

interface RecoveryEnvelope {
  path: string | null;
  displayName: string;
  source: string;
  workingDirectory: string;
  updatedAt: number;
}

interface DocumentState {
  path: string | null;
  displayName: string;
  source: string | null;
  recoverySource: string | null;
  workingDirectory: string;
  /** Imports are available before the renderer's debounced recovery manifest arrives. */
  importedResources?: Record<string, OpenRoomFileResourceV1>;
}

interface PresentCursor { step: number; shown: number }
interface PresentationState { source: string; cursor: PresentCursor; listening?: { stepId: string; mode: 'room' | 'individual'; transcriptShown: boolean }; live?: { sessionCode: string; stageToken: string } }

const documents = new Map<number, DocumentState>();
const pendingPdfs = new Map<string, { path: string; ownerId: number }>();
const windowsByPath = new Map<string, BrowserWindow>();
let homeWindow: BrowserWindow | null = null;
let presentationWindow: BrowserWindow | null = null;
let presentationOwner: BrowserWindow | null = null;
let presentationState: PresentationState | null = null;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const rendererRoot = app.isPackaged ? join(app.getAppPath(), 'renderer') : resolve(moduleDir, '../renderer');
const onlineOrigin = (process.env['OPENROOM_ORIGIN'] ?? 'https://openroom.app').replace(/\/$/, '');

// Signed out, live sessions run on the teacher's own relay; see relay.ts.
const relay = createRelayStore({
  file: () => defaultRelayFile(app.getPath('userData')),
  safeStorage: () => safeStorage ?? null,
});

function recoveryDir(): string { return join(app.getPath('userData'), 'recovery'); }
function settingsDir(): string { return join(app.getPath('userData'), 'state'); }

async function deviceIdentity(): Promise<{ id: string; name: string }> {
  const file = join(settingsDir(), 'device-id');
  await mkdir(settingsDir(), { recursive: true });
  let id: string;
  try { id = (await readFile(file, 'utf8')).trim(); }
  catch {
    id = randomUUID();
    const handle = await open(file, 'w', 0o600);
    try { await handle.writeFile(id, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  }
  return { id, name: app.getName() === '' ? 'This computer' : `${process.platform === 'darwin' ? 'Mac' : 'Windows PC'}` };
}

function canonicalPath(value: string): string { return normalize(resolve(value)); }

function mime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.pdf': return 'application/pdf';
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.wav': return 'audio/wav';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function safeRendererPath(url: URL): string | null {
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const resolved = resolve(rendererRoot, relative);
  return resolved === rendererRoot || resolved.startsWith(`${rendererRoot}${sep}`) ? resolved : null;
}

function parsedFile(source: string | null): Record<string, unknown> | null {
  if (source === null) return null;
  try {
    const parsed = parseYaml(source);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function resourcePath(contentsId: number, resourceId: string): string | null {
  const audience = contentsId === presentationWindow?.webContents.id;
  const owner = documents.get(contentsId) ?? (audience && presentationOwner ? documents.get(presentationOwner.webContents.id) : undefined);
  if (owner === undefined) return null;
  const source = (audience ? presentationState?.source : null) ?? owner.recoverySource ?? owner.source;
  const parsed = parsedFile(source);
  const resources = parsed?.['resources'];
  const entry = (typeof resources === 'object' && resources !== null ? (resources as Record<string, unknown>)[resourceId] : undefined)
    ?? owner.importedResources?.[resourceId];
  if (typeof entry !== 'object' || entry === null) return null;
  const relative = (entry as Record<string, unknown>)['path'];
  if (typeof relative !== 'string' || relative === '' || relative.includes('\\') || isAbsolute(relative) || relative.split('/').some((part) => part === '..')) return null;
  const root = owner.workingDirectory;
  const candidate = resolve(root, relative);
  return candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function registerImportedResource(state: DocumentState, imported: { resourceId: string; resource: OpenRoomFileResourceV1 }) {
  (state.importedResources ??= {})[imported.resourceId] = imported.resource;
  return imported;
}

async function protocolResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === 'app') {
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.delete('origin');
      headers.delete('host');
      const init: RequestInit = { method: request.method, headers, redirect: 'follow' };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
      // Sessions created on the relay keep talking to it; everything else is the control plane.
      const origin = relay.originFor(url.pathname) ?? onlineOrigin;
      return session.defaultSession.fetch(`${origin}${url.pathname}${url.search}`, init);
    }
    const local = safeRendererPath(url);
    if (local === null) return new Response('Forbidden', { status: 403 });
    try { return localResourceResponse(request, await readFile(local), mime(local)); }
    catch { return new Response('Not found', { status: 404 }); }
  }
  if (url.hostname === 'auth') {
    void completeDesktopSignIn(request.url);
    return new Response('<!doctype html><p>Signing in…</p>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (url.hostname === 'deck') {
    void handleDesktopDeckHandoff(request.url);
    return new Response('<!doctype html><p>Opening deck…</p>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (url.hostname === 'local') {
    const [contentsIdText, resourceId] = url.pathname.replace(/^\//, '').split('/');
    const local = resourceId ? resourcePath(Number(contentsIdText), decodeURIComponent(resourceId)) : null;
    if (local === null) return new Response('Not found', { status: 404 });
    try { return localResourceResponse(request, await readFile(local), mime(local)); }
    catch { return new Response('Not found', { status: 404 }); }
  }
  return new Response('Not found', { status: 404 });
}

function secureWindow(options: Electron.BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#17140f',
    ...options,
    webPreferences: {
      preload: join(moduleDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer rides on the (legacy-named) plugin switch.
      // Without it a pdf element's iframe fails with ERR_BLOCKED_BY_CLIENT.
      plugins: true,
      ...(options.webPreferences ?? {}),
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    applyDesktopNavigation(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (decideDesktopNavigation(url, onlineOrigin) === 'allow') return;
    event.preventDefault();
    applyDesktopNavigation(url);
  });
  return window;
}

function applyDesktopNavigation(url: string): void {
  const decision = decideDesktopNavigation(url, onlineOrigin);
  if (decision === 'open-auth-start') void shell.openExternal(withDesktopAuthFlag(url));
  else if (decision === 'open-external') void shell.openExternal(url);
}

async function completeDesktopSignIn(url: string): Promise<void> {
  const ticket = parseDesktopAuthHandoff(url);
  if (ticket === null) return;
  const res = await session.defaultSession.fetch(`${onlineOrigin}/api/auth/desktop/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  if (!res.ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Sign-in did not finish',
      message: 'Sign in with Google again from OpenRoom.',
    });
    return;
  }
  deckSignInOpen = false;
  await resumePendingDeckHandoffs();
  if (homeWindow && !homeWindow.isDestroyed()) {
    await homeWindow.loadURL(`${onlineOrigin}/host/index.html#/`);
    homeWindow.focus();
    return;
  }
  createHomeWindow();
}

async function readDocument(path: string): Promise<DocumentState> {
  await mkdir(join(app.getPath('userData'), 'working'), { recursive: true });
  const workingDirectory = await createOpenRoomWorkingDirectory(join(app.getPath('userData'), 'working'));
  try {
    const opened = await readOpenRoomPackage(path, workingDirectory);
    return { path, displayName: basename(path), source: opened.source, recoverySource: null, workingDirectory };
  } catch (cause) {
    await disposeOpenRoomWorkingDirectory(workingDirectory);
    throw cause;
  }
}

function fileIdFromSource(source: string | null): string {
  if (source === null) return 'unknown';
  try {
    const parsed = parseYaml(source) as { fileId?: unknown };
    return typeof parsed.fileId === 'string' ? parsed.fileId : 'unknown';
  } catch {
    return 'unknown';
  }
}

function agentDeckKey(sender: WebContents, deckId: string | null): string {
  if (deckId !== null && deckId !== '') return `deck:${deckId}`;
  const state = documents.get(sender.id);
  if (state === undefined) throw new Error('This agent pane is not bound to a deck.');
  const fileId = fileIdFromSource(state.source ?? state.recoverySource);
  if (fileId !== 'unknown') return `file:${fileId}`;
  if (state.path !== null) return `path:${canonicalPath(state.path)}`;
  return `untitled:${String(sender.id)}`;
}

async function takeDesktopLock(path: string, source: string | null): Promise<void> {
  const lock = { fileId: fileIdFromSource(source), pid: process.pid, host: 'desktop' as const };
  await writeFile(`${path}.lock`, `${JSON.stringify(lock)}\n`, 'utf8');
}

async function releaseDesktopLock(path: string): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(`${path}.lock`, 'utf8')) as { pid?: unknown };
    if (raw.pid === process.pid) await unlink(`${path}.lock`);
  } catch {
    /* no lock or someone else's */
  }
}

async function openDocumentWindow(
  path?: string,
  recovered?: RecoveryEnvelope,
  prepared?: { displayName: string; source: string },
): Promise<BrowserWindow> {
  const canonical = path ? canonicalPath(path) : null;
  if (canonical !== null) {
    const existing = windowsByPath.get(canonical);
    if (existing && !existing.isDestroyed()) { existing.focus(); return existing; }
  }
  await mkdir(join(app.getPath('userData'), 'working'), { recursive: true });
  const state = recovered
    ?? (prepared === undefined
      ? (canonical ? await readDocument(canonical) : {
          path: null,
          displayName: 'Untitled.openroom',
          source: null,
          recoverySource: null,
          workingDirectory: await createOpenRoomWorkingDirectory(join(app.getPath('userData'), 'working')),
        })
      : {
          path: null,
          displayName: prepared.displayName,
          source: prepared.source,
          recoverySource: null,
          workingDirectory: await createOpenRoomWorkingDirectory(join(app.getPath('userData'), 'working')),
        });
  let documentState: DocumentState;
  if ('updatedAt' in state) {
    const workingDirectory = state.workingDirectory;
    let source: string | null = null;
    if (state.path !== null) {
      const freshDirectory = await createOpenRoomWorkingDirectory(join(app.getPath('userData'), 'working'));
      source = (await readOpenRoomPackage(state.path, freshDirectory).catch(() => null))?.source ?? null;
      if (source !== null && freshDirectory !== workingDirectory) await disposeOpenRoomWorkingDirectory(freshDirectory);
    }
    documentState = { path: state.path, displayName: state.displayName, source, recoverySource: state.source, workingDirectory };
  } else documentState = state;
  const window = secureWindow({ title: documentState.displayName });
  documents.set(window.webContents.id, documentState);
  if (canonical !== null) windowsByPath.set(canonical, window);
  const contentsId = window.webContents.id;
  window.on('closed', () => {
    documents.delete(contentsId);
    void agentIpc?.store.disposeSender(contentsId);
    if (canonical !== null && windowsByPath.get(canonical) === window) windowsByPath.delete(canonical);
    if (canonical !== null) void releaseDesktopLock(canonical);
    if (documentState.recoverySource === null) void disposeOpenRoomWorkingDirectory(documentState.workingDirectory);
  });
  if (canonical !== null) await takeDesktopLock(canonical, documentState.source ?? documentState.recoverySource);
  await window.loadURL('openroom://app/host/index.html#/desktop/file');
  if (canonical !== null) app.addRecentDocument(canonical);
  return window;
}

async function chooseOpenFile(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'OpenRoom deck', extensions: ['openroom'] }] });
  if (!result.canceled && result.filePaths[0]) await openDocumentWindow(result.filePaths[0]);
}

async function atomicWrite(target: string, source: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}

function stateFor(contents: WebContents): DocumentState {
  const state = documents.get(contents.id);
  if (!state) throw new Error('This window is not bound to an OpenRoom file.');
  return state;
}

async function saveAs(contents: WebContents, source: string): Promise<DocumentState | null> {
  const state = stateFor(contents);
  const options = {
    defaultPath: state.path ?? state.displayName,
    filters: [{ name: 'OpenRoom deck', extensions: ['openroom'] }],
  };
  const parent = BrowserWindow.fromWebContents(contents);
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  const target = result.filePath.endsWith('.openroom') ? result.filePath : `${result.filePath}.openroom`;
  await writeOpenRoomPackage(target, source, state.workingDirectory);
  if (state.path !== null) {
    windowsByPath.delete(canonicalPath(state.path));
    await releaseDesktopLock(canonicalPath(state.path));
  }
  state.path = canonicalPath(target);
  state.displayName = basename(target);
  state.source = source;
  state.recoverySource = null;
  const window = BrowserWindow.fromWebContents(contents);
  if (window) { window.setTitle(state.displayName); windowsByPath.set(state.path, window); }
  app.addRecentDocument(state.path);
  await takeDesktopLock(state.path, source);
  return state;
}

function displayLabel(display: Display, index: number): string {
  return display.label || (display.internal ? 'Built-in display' : `Display ${index + 1}`);
}

function ownerFor(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error('Window closed');
  return window;
}

let agentIpc: AgentIpcHandle | null = null;
const askBroker = createAskQuestionBroker();

function installIpc(): void {
  // The live console can run in a window that never opened a file (a session
  // started from the workspace), so asking whether this window holds a
  // document has to be answerable without throwing.
  ipcMain.handle('desktop:has-document', (event) => documents.has(event.sender.id));
  ipcMain.handle('desktop:get-document', async (event) => {
    const state = stateFor(event.sender);
    const device = await deviceIdentity();
    return { ...state, deviceId: device.id, deviceName: device.name, onlineOrigin: `${onlineOrigin}/` };
  });
  ipcMain.handle('desktop:save-document', async (event, source: string) => {
    const state = stateFor(event.sender);
    if (state.path === null) return saveAs(event.sender, source);
    await writeOpenRoomPackage(state.path, source, state.workingDirectory);
    state.source = source; state.recoverySource = null;
    app.addRecentDocument(state.path);
    return { ...state, ...(await deviceIdentity()) };
  });
  ipcMain.handle('desktop:save-document-as', (event, source: string) => saveAs(event.sender, source));
  ipcMain.handle('desktop:save-recovery', async (event, fileId: string, source: string) => {
    const state = stateFor(event.sender);
    state.recoverySource = source;
    await mkdir(recoveryDir(), { recursive: true });
    const envelope: RecoveryEnvelope = {
      path: state.path,
      displayName: state.displayName,
      source,
      workingDirectory: state.workingDirectory,
      updatedAt: Date.now(),
    };
    await atomicWrite(join(recoveryDir(), `${fileId}.json`), JSON.stringify(envelope));
  });
  ipcMain.handle('desktop:clear-recovery', async (_event, fileId: string) => { await unlink(join(recoveryDir(), `${fileId}.json`)).catch(() => undefined); });
  ipcMain.handle('desktop:open-file', () => chooseOpenFile());
  ipcMain.handle('desktop:new-file', () => openDocumentWindow());
  ipcMain.handle('desktop:pick-image', async (event) => {
    const result = await dialog.showOpenDialog(ownerFor(event), {
      properties: ['openFile'],
      filters: [{ name: 'Picture', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return null;
    const typeByExtension: Record<string, OpenRoomResourceContentType> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    };
    const contentType = typeByExtension[extname(path).toLowerCase()];
    if (contentType === undefined) throw new Error('Choose a PNG, JPEG, WebP, GIF, or AVIF image.');
    const state = stateFor(event.sender);
    return registerImportedResource(state, await importOpenRoomResource(state.workingDirectory, path, contentType));
  });
  ipcMain.handle('desktop:pick-audio', async (event) => {
    const result = await dialog.showOpenDialog(ownerFor(event), {
      properties: ['openFile'], filters: [{ name: 'Audio recording', extensions: ['mp3', 'wav', 'm4a'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return null;
    const extension = extname(path).toLowerCase();
    const contentType = extension === '.mp3' ? 'audio/mpeg' : extension === '.wav' ? 'audio/wav' : extension === '.m4a' ? 'audio/mp4' : null;
    if (contentType === null) throw new Error('Choose an MP3, WAV or M4A recording.');
    const state = stateFor(event.sender);
    return registerImportedResource(state, await importOpenRoomResource(state.workingDirectory, path, contentType));
  });
  ipcMain.handle('desktop:pick-pdf', async (event) => {
    const result = await dialog.showOpenDialog(ownerFor(event), {
      properties: ['openFile'], filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return null;
    const selectionId = randomUUID();
    pendingPdfs.set(selectionId, { path, ownerId: event.sender.id });
    return { selectionId, name: basename(path), pageCount: await inspectPdf(path) };
  });
  ipcMain.handle('desktop:extract-pdf', async (event, selectionId: string, fromPage: number, toPage: number) => {
    const selection = pendingPdfs.get(selectionId);
    if (selection === undefined || selection.ownerId !== event.sender.id) throw new Error('Choose the PDF again.');
    try {
      const state = stateFor(event.sender);
      return registerImportedResource(state, await extractPdfResource(state.workingDirectory, selection.path, fromPage, toPage));
    } finally {
      pendingPdfs.delete(selectionId);
    }
  });
  // A deck synced to a space has no .openroom package to embed into, so the pages come
  // back as bytes and the renderer uploads them to the space's asset store.
  ipcMain.handle('desktop:extract-pdf-bytes', async (event, selectionId: string, fromPage: number, toPage: number) => {
    const selection = pendingPdfs.get(selectionId);
    if (selection === undefined || selection.ownerId !== event.sender.id) throw new Error('Choose the PDF again.');
    const pageCount = await inspectPdf(selection.path);
    if (!Number.isInteger(fromPage) || !Number.isInteger(toPage) || fromPage < 1 || toPage < fromPage || toPage > pageCount) {
      throw new Error(`Choose an inclusive page range between 1 and ${String(pageCount)}.`);
    }
    try {
      return {
        name: pdfPageRangeName(selection.path, fromPage, toPage),
        bytes: await copyPdfPages(selection.path, fromPage, toPage),
      };
    } finally {
      pendingPdfs.delete(selectionId);
    }
  });
  ipcMain.handle('desktop:read-resource', async (event, resourceId: string) => {
    const path = resourcePath(event.sender.id, resourceId);
    if (path === null) throw new Error('Embedded resource not found.');
    return readFile(path);
  });
  ipcMain.handle('desktop:open-sign-in', () => {
    void shell.openExternal(desktopGoogleStartUrl(onlineOrigin));
    return { ok: true };
  });
  ipcMain.on('desktop:control-origin', (event) => {
    event.returnValue = onlineOrigin;
  });
  ipcMain.handle('desktop:relay:status', () => relay.status());
  ipcMain.handle('desktop:relay:save', async (_event, input: { origin?: unknown; key?: unknown }) => {
    try {
      const origin = typeof input?.origin === 'string' ? input.origin : '';
      const key = typeof input?.key === 'string' ? input.key : '';
      return { ok: true, status: await relay.save({ origin, key }) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:relay:clear', async () => {
    try { return { ok: true, status: await relay.clear() }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('desktop:relay:start-session', (_event, outline: unknown) => relay.startSession(outline));
  ipcMain.handle('desktop:show-in-folder', (event) => { const path = stateFor(event.sender).path; if (path) shell.showItemInFolder(path); });
  ipcMain.handle('desktop:list-displays', () => screen.getAllDisplays().map((display, index) => ({
    id: String(display.id), label: displayLabel(display, index), primary: display.id === screen.getPrimaryDisplay().id, external: !display.internal,
  })));
  ipcMain.handle('desktop:start-presentation', async (event, state: PresentationState, displayId?: string) => {
    presentationOwner = ownerFor(event);
    presentationState = state;
    if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.close();
    const target = screen.getAllDisplays().find((display) => String(display.id) === displayId)
      ?? screen.getDisplayMatching(presentationOwner.getBounds());
    presentationWindow = secureWindow({
      x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height,
      fullscreen: true, frame: false, alwaysOnTop: false, title: 'OpenRoom presentation',
    });
    presentationWindow.on('closed', () => {
      presentationWindow = null;
      presentationOwner?.webContents.send('desktop:presentation-state', null);
    });
    await presentationWindow.loadURL('openroom://app/host/index.html#/desktop/present');
  });
  ipcMain.handle('desktop:update-presentation', (_event, state: PresentationState) => {
    presentationState = state;
    presentationWindow?.webContents.send('desktop:presentation-state', state);
  });
  ipcMain.handle('desktop:close-presentation', () => { presentationWindow?.close(); presentationState = null; });
  ipcMain.handle('desktop:get-presentation', () => presentationState);
  ipcMain.on('desktop:presentation-command', (_event, command: string) => presentationOwner?.webContents.send('desktop:presentation-command', command));
  agentIpc = registerAgentIpc(ipcMain, {
    userData: () => app.getPath('userData'),
    skillsRoot: () =>
      app.isPackaged
        ? join(app.getAppPath(), 'plugin', 'skills')
        : resolve(moduleDir, '../../../plugin/skills'),
    mcpSocketPath: () => desktopMcpSocketPath(app.getPath('userData')),
    mcpStdioPath: () => join(moduleDir, 'agents/mcp-stdio.js'),
    electronExecPath: () => process.execPath,
    deckKey: agentDeckKey,
    getSenderWindow: (sender) => BrowserWindow.fromWebContents(sender),
    askBroker,
  });
}

function createHomeWindow(): void {
  homeWindow = secureWindow({ width: 1360, height: 900, title: 'OpenRoom' });
  void homeWindow.loadURL(`${onlineOrigin}/host/index.html#/`).catch(() => openDocumentWindow());
  homeWindow.on('closed', () => { homeWindow = null; });
}

function startUpdateChecks(): void {
  if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform)) return;
  const feed = process.env['OPENROOM_UPDATE_URL']
    ?? `${onlineOrigin}/desktop/updates/${process.platform}/${process.arch}/${app.getVersion()}`;
  const stop = startDesktopUpdateChecks(autoUpdater, feed);
  app.once('will-quit', stop);
}

function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => { void openDocumentWindow(); } },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseOpenFile(); } },
      { type: 'separator' }, { role: 'close' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
}

async function recoverDocuments(): Promise<boolean> {
  await mkdir(recoveryDir(), { recursive: true });
  const files = (await readdir(recoveryDir())).filter((file) => file.endsWith('.json'));
  if (files.length === 0) return false;
  const answer = await dialog.showMessageBox({
    type: 'question', buttons: ['Recover', 'Discard'], defaultId: 0, cancelId: 1,
    title: 'Unsaved decks found', message: `${files.length} ${files.length === 1 ? 'file has' : 'files have'} unsaved work.`,
    detail: 'Recovery copies are deleted after you save.',
  });
  if (answer.response === 1) {
    await Promise.all(files.map((file) => unlink(join(recoveryDir(), file))));
    return false;
  }
  for (const file of files) {
    try {
      const envelope = JSON.parse(await readFile(join(recoveryDir(), file), 'utf8')) as RecoveryEnvelope;
      await openDocumentWindow(envelope.path ?? undefined, envelope);
    } catch { /* leave unreadable recovery in place */ }
  }
  return true;
}

function openArgvFiles(argv: string[]): string[] {
  return argv.filter((arg) => arg.toLowerCase().endsWith('.openroom') && isAbsolute(arg));
}

function ownerWindowContents(contentsId: number): WebContents | undefined {
  return webContents.fromId(contentsId);
}

function currentDesktopDocument(): import('./mcp-host.js').DesktopDocument | null {
  const focused = BrowserWindow.getFocusedWindow();
  const focusedState = focused ? documents.get(focused.webContents.id) : undefined;
  const state = focusedState ?? [...documents.values()].find((item) => item.source !== null || item.recoverySource !== null);
  if (state === undefined) return null;
  return {
    path: state.path,
    source: state.recoverySource ?? state.source,
    async write(source: string) {
      state.source = source;
      state.recoverySource = null;
      if (state.path !== null) await writeOpenRoomPackage(state.path, source, state.workingDirectory);
      for (const [contentsId, owner] of documents) {
        if (owner !== state) continue;
        const contents = ownerWindowContents(contentsId);
        contents?.send('desktop:document-changed', {
          path: state.path,
          displayName: state.displayName,
          source,
        });
      }
    },
  };
}

app.setName('OpenRoom');
/**
 * `OPENROOM_DEBUG_PORT=9222 bun desktop` opens Chromium's DevTools protocol, so
 * the renderer can be read and driven from outside. Set as a switch rather than
 * an argv flag: it has to survive a relaunch, and argv does not.
 */
const debugPort = process.env['OPENROOM_DEBUG_PORT'] ?? '';
if (/^\d+$/.test(debugPort)) app.commandLine.appendSwitch('remote-debugging-port', debugPort);
if (process.platform === 'win32') app.setAppUserModelId('app.openroom.desktop');
const defaultAppEntry = process.defaultApp ? process.argv[1] : undefined;
if (defaultAppEntry !== undefined) {
  app.setAsDefaultProtocolClient('openroom', process.execPath, [resolve(defaultAppEntry)]);
} else {
  app.setAsDefaultProtocolClient('openroom');
}

const pendingDesktopAuthUrls: string[] = [];
const pendingDesktopDeckUrls: string[] = [];
let deckSignInOpen = false;

async function desktopControlApi(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({ accept: 'application/json', 'x-openroom-csrf': '1' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await session.defaultSession.fetch(`${onlineOrigin}${path}`, {
    method,
    headers,
    ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try { parsed = JSON.parse(text) as unknown; }
    catch { parsed = text; }
  }
  return { status: response.status, body: parsed };
}

async function handleDesktopDeckHandoff(url: string): Promise<void> {
  const handoff = parseDesktopDeckHandoff(url);
  if (handoff === null) return;
  if (handoff.origin !== new URL(onlineOrigin).origin) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Deck link not opened',
      message: 'This deck link belongs to a different OpenRoom server.',
    });
    return;
  }
  try {
    const prepared = await prepareDesktopDeckHandoff({
      ...handoff,
      api: desktopControlApi,
      device: await deviceIdentity(),
      readPath: (path) => readFile(path, 'utf8'),
      randomId: randomUUID,
    });
    if (prepared.kind === 'sign-in') {
      if (!pendingDesktopDeckUrls.includes(url)) pendingDesktopDeckUrls.push(url);
      if (!deckSignInOpen) {
        deckSignInOpen = true;
        await shell.openExternal(desktopGoogleStartUrl(onlineOrigin));
      }
      return;
    }
    if (prepared.kind === 'open-path') await openDocumentWindow(prepared.path);
    else await openDocumentWindow(undefined, undefined, prepared);
  } catch (cause) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Deck could not be opened',
      message: cause instanceof Error ? cause.message : 'Open the deck in the browser instead.',
    });
  }
}

async function resumePendingDeckHandoffs(): Promise<void> {
  const queued = pendingDesktopDeckUrls.splice(0);
  for (const url of queued) await handleDesktopDeckHandoff(url);
}

function enqueueDesktopUrl(url: string): void {
  if (parseDesktopAuthHandoff(url) !== null) {
    if (app.isReady()) void completeDesktopSignIn(url);
    else pendingDesktopAuthUrls.push(url);
    return;
  }
  if (parseDesktopDeckHandoff(url) !== null) {
    if (app.isReady()) void handleDesktopDeckHandoff(url);
    else pendingDesktopDeckUrls.push(url);
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  enqueueDesktopUrl(url);
});
app.on('open-file', (event, path) => { event.preventDefault(); void app.whenReady().then(() => openDocumentWindow(path)); });
app.on('second-instance', (_event, argv) => {
  for (const arg of argv) enqueueDesktopUrl(arg);
  for (const path of openArgvFiles(argv)) void openDocumentWindow(path);
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else void app.whenReady().then(async () => {
  await relay.hydrate();
  protocol.handle('openroom', protocolResponse);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://local.openroom.invalid/*'] }, (details, callback) => {
    const resourceId = new URL(details.url).pathname.replace(/^\//, '');
    callback({ redirectURL: `openroom://local/${details.webContentsId}/${resourceId}` });
  });
  // Agent workdirs hold copies of school files; never let them survive a crash.
  await sweepAgentRuns(join(app.getPath('userData'), 'agent-runs')).catch(() => undefined);
  // Pasted images are the same kind of borrowed material; they never outlive a session either.
  await sweepAgentRuns(join(app.getPath('userData'), 'agent-pastes')).catch(() => undefined);
  // Agent CLIs live in Homebrew/nvm/bun directories a windowed launch never inherits.
  await adoptLoginShellPath();
  installIpc();
  installMenu();
  startUpdateChecks();
  const mcp = await startDesktopMcpServer({
    socketPath: desktopMcpSocketPath(app.getPath('userData')),
    origin: onlineOrigin,
    currentDocument: currentDesktopDocument,
    ask: (args) => askBroker.ask(args),
    // A stamped save can come from the embedded pane mid-run or a handed-off
    // Codex terminal; every window hears it and the matching editor adopts it.
    onDeckSaved: (deckId) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('desktop:deck-saved', { deckId });
      }
    },
  });
  app.on('will-quit', () => {
    mcp.close();
    void agentIpc?.store.disposeAll();
  });
  const queuedAuth = [...pendingDesktopAuthUrls, ...process.argv.filter((arg) => parseDesktopAuthHandoff(arg) !== null)];
  const queuedDeck = [...pendingDesktopDeckUrls, ...process.argv.filter((arg) => parseDesktopDeckHandoff(arg) !== null)];
  pendingDesktopAuthUrls.length = 0;
  pendingDesktopDeckUrls.length = 0;
  const argvFiles = openArgvFiles(process.argv.slice(1));
  if (argvFiles.length > 0) for (const path of argvFiles) await openDocumentWindow(path);
  else if (!(await recoverDocuments())) createHomeWindow();
  for (const url of queuedAuth) await completeDesktopSignIn(url);
  for (const url of queuedDeck) await handleDesktopDeckHandoff(url);
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createHomeWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
