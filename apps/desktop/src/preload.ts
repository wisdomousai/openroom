import { contextBridge, ipcRenderer } from 'electron';

type Listener<T> = (value: T) => void;

function subscribe<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('openroomDesktop', {
  controlOrigin: ipcRenderer.sendSync('desktop:control-origin') as string,
  hasDocument: () => ipcRenderer.invoke('desktop:has-document'),
  getDocument: () => ipcRenderer.invoke('desktop:get-document'),
  saveDocument: (source: string) => ipcRenderer.invoke('desktop:save-document', source),
  saveDocumentAs: (source: string) => ipcRenderer.invoke('desktop:save-document-as', source),
  saveRecovery: (fileId: string, source: string) => ipcRenderer.invoke('desktop:save-recovery', fileId, source),
  clearRecovery: (fileId: string) => ipcRenderer.invoke('desktop:clear-recovery', fileId),
  openFile: () => ipcRenderer.invoke('desktop:open-file'),
  newFile: () => ipcRenderer.invoke('desktop:new-file'),
  pickImage: () => ipcRenderer.invoke('desktop:pick-image'),
  pickAudio: () => ipcRenderer.invoke('desktop:pick-audio'),
  pickPdf: () => ipcRenderer.invoke('desktop:pick-pdf'),
  extractPdf: (selectionId: string, fromPage: number, toPage: number) =>
    ipcRenderer.invoke('desktop:extract-pdf', selectionId, fromPage, toPage),
  extractPdfBytes: (selectionId: string, fromPage: number, toPage: number) =>
    ipcRenderer.invoke('desktop:extract-pdf-bytes', selectionId, fromPage, toPage),
  readResource: (resourceId: string) => ipcRenderer.invoke('desktop:read-resource', resourceId),
  showInFolder: () => ipcRenderer.invoke('desktop:show-in-folder'),
  listDisplays: () => ipcRenderer.invoke('desktop:list-displays'),
  startPresentation: (state: unknown, displayId?: string) => ipcRenderer.invoke('desktop:start-presentation', state, displayId),
  updatePresentation: (state: unknown) => ipcRenderer.invoke('desktop:update-presentation', state),
  closePresentation: () => ipcRenderer.invoke('desktop:close-presentation'),
  getPresentation: () => ipcRenderer.invoke('desktop:get-presentation'),
  sendPresentationCommand: (command: string) => ipcRenderer.send('desktop:presentation-command', command),
  onPresentationState: (listener: Listener<unknown>) => subscribe('desktop:presentation-state', listener),
  onPresentationCommand: (listener: Listener<string>) => subscribe('desktop:presentation-command', listener),
  onDocumentChanged: (listener: Listener<unknown>) => subscribe('desktop:document-changed', listener),
  onDeckSaved: (listener: Listener<unknown>) => subscribe('desktop:deck-saved', listener),
  openSignIn: () => ipcRenderer.invoke('desktop:open-sign-in'),
  relayStatus: () => ipcRenderer.invoke('desktop:relay:status'),
  saveRelay: (input: { origin: string; key?: string }) => ipcRenderer.invoke('desktop:relay:save', input),
  clearRelay: () => ipcRenderer.invoke('desktop:relay:clear'),
  relayStartSession: (outline: unknown) => ipcRenderer.invoke('desktop:relay:start-session', outline),
  // Sandboxed preload: no relative imports, so channel names are inline literals.
  // src/agents/channels.test.ts asserts they stay in sync with AGENT_CHANNELS.
  listAgentHosts: () => ipcRenderer.invoke('desktop:agents:list'),
  loginAgentHost: (host: string) => ipcRenderer.invoke('desktop:agents:login', host),
  listAgentKeys: () => ipcRenderer.invoke('desktop:agents:list-keys'),
  setAgentKey: (provider: string, credential: unknown) =>
    ipcRenderer.invoke('desktop:agents:set-key', provider, credential),
  clearAgentKey: (provider: string) => ipcRenderer.invoke('desktop:agents:clear-key', provider),
  pickAgentAttachments: () => ipcRenderer.invoke('desktop:agents:pick-attachments'),
  pickAgentFolders: () => ipcRenderer.invoke('desktop:agents:pick-folders'),
  saveAgentPastedImages: (images: unknown) => ipcRenderer.invoke('desktop:agents:save-pasted', images),
  listAgentModels: (host: string) => ipcRenderer.invoke('desktop:agents:models', host),
  loadAgentChat: (deckId?: string | null) => ipcRenderer.invoke('desktop:agents:load', deckId),
  selectAgentChat: (conversationId: string, deckId?: string | null) =>
    ipcRenderer.invoke('desktop:agents:select', conversationId, deckId),
  runAgent: (request: unknown) => ipcRenderer.invoke('desktop:agents:run', request),
  openAgentInCodex: (deckId?: string | null) => ipcRenderer.invoke('desktop:agents:open-codex', deckId),
  warmAgentCache: (model: string | null) => ipcRenderer.invoke('desktop:agents:warmup', model),
  cancelAgent: () => ipcRenderer.invoke('desktop:agents:cancel'),
  resetAgentChat: (deckId?: string | null) => ipcRenderer.invoke('desktop:agents:reset', deckId),
  answerAgentQuestion: (payload: unknown) => ipcRenderer.invoke('desktop:agents:answer', payload),
  onAgentEvent: (listener: Listener<unknown>) => subscribe('desktop:agents:event', listener),
  onAgentLoginOutput: (listener: Listener<unknown>) => subscribe('desktop:agents:login-output', listener),
});
