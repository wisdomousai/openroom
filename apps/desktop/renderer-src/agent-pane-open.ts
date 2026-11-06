/**
 * Whether the file window shows the Agent pane, remembered on this computer.
 *
 * Until the tutor opens or closes it once, the pane opens only when an agent
 * host is signed in: without one it would hold 22rem of a laptop window and
 * leave the slide canvas too small to edit.
 */
const KEY = 'openroom.desktop.agent-pane';

export function storedAgentPaneOpen(): boolean | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'open' ? true : value === 'closed' ? false : null;
  } catch {
    return null;
  }
}

export function storeAgentPaneOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? 'open' : 'closed');
  } catch {
    // Storage can be unavailable; the pane then starts from the signed-in rule again.
  }
}
