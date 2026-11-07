import type { IpcMain } from 'electron';

/** The parts of `event.senderFrame` the check reads. */
export interface SenderFrame {
  readonly url: string;
  readonly parent: unknown;
}

interface IpcEventLike {
  senderFrame?: SenderFrame | null;
  returnValue?: unknown;
}

type Listener = (event: IpcEventLike, ...args: unknown[]) => unknown;

const INVOKE = new Set<PropertyKey>(['handle', 'handleOnce']);
const SEND = new Set<PropertyKey>(['on', 'once', 'addListener']);

/**
 * `ipcMain` for the Desktop bridge: every handler registered through it first
 * checks that the call came from a top frame on a trusted page. A foreign
 * document that ends up with the preload gets a refusal, never the handler.
 */
export function trustedIpc(ipc: IpcMain, trustedUrl: (url: string) => boolean): IpcMain {
  const trusted = (frame: SenderFrame | null | undefined): boolean =>
    frame != null && frame.parent === null && trustedUrl(frame.url);
  return new Proxy(ipc, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || (!INVOKE.has(property) && !SEND.has(property))) return value;
      const register = value as (channel: string, listener: Listener) => unknown;
      return (channel: string, listener: Listener) => {
        const result = register.call(target, channel, (event, ...args) => {
          if (trusted(event.senderFrame)) return listener(event, ...args);
          if (INVOKE.has(property)) throw new Error('This page cannot use OpenRoom Desktop.');
          // A synchronous send waits for a value; answer it so the page does not hang.
          event.returnValue = null;
          return undefined;
        });
        return result === target ? receiver : result;
      };
    },
  });
}
