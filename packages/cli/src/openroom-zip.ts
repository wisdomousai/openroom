import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(name: string): boolean {
  return name !== '' && !name.startsWith('/') && !name.includes('\\')
    && name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function readOpenRoomArchive(path: string): Map<string, Buffer> {
  const zip = readFileSync(path);
  let end = -1;
  for (let offset = Math.max(0, zip.length - 65_557); offset <= zip.length - 22; offset += 1) {
    if (zip.readUInt32LE(offset) === END) end = offset;
  }
  if (end < 0) throw new Error('invalid .openroom ZIP');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(cursor) !== CENTRAL) throw new Error('invalid .openroom central directory');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!safeName(name)) throw new Error('unsafe .openroom ZIP entry');
    if (!name.endsWith('/')) {
      if (zip.readUInt32LE(localOffset) !== LOCAL) throw new Error('invalid .openroom local entry');
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      const bytes = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
      if (bytes === null || bytes.length !== uncompressedSize) throw new Error('unsupported .openroom compression');
      entries.set(name, bytes);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function writeOpenRoomArchive(path: string, entries: ReadonlyMap<string, Uint8Array>): void {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    if (!safeName(name)) throw new Error('unsafe .openroom ZIP entry');
    const nameBytes = Buffer.from(name, 'utf8');
    const bytes = Buffer.from(value);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, bytes);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + bytes.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  const temporary = join(dirname(path), `.${randomUUID()}.openroom.tmp`);
  writeFileSync(temporary, Buffer.concat([...local, ...central, end]), { mode: 0o600 });
  renameSync(temporary, path);
}
