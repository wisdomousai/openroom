import type { OpenRoomDesktopBridge } from '@openroom/editor';

declare global {
  interface Window {
    openroomDesktop?: OpenRoomDesktopBridge;
  }
}

export function desktopBridge(): OpenRoomDesktopBridge | null {
  return window.openroomDesktop ?? null;
}
