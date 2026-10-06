declare module 'archiver' {
  import type { Readable } from 'node:stream';
  interface EntryOptions { name: string; store?: boolean }
  interface Archive extends Readable {
    append(source: string | Buffer, options: EntryOptions): this;
    file(path: string, options: EntryOptions): this;
    finalize(): Promise<void>;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
  }
  export default function archiver(format: 'zip', options?: { zlib?: { level: number } }): Archive;
}
