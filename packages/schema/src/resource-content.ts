import type { OpenRoomResourceContentType } from './openroom-file.js';

export const OPENROOM_RESOURCE_EXTENSIONS: Record<OpenRoomResourceContentType, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/avif': '.avif', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
};

/** Reject a mislabeled file before it becomes a portable deck resource. */
export function openRoomResourceBytesMatch(bytes: Uint8Array, contentType: string): boolean {
  const ascii = (start: number, length: number) => new TextDecoder('ascii').decode(bytes.subarray(start, start + length));
  switch (contentType) {
    case 'application/pdf': return ascii(0, 5) === '%PDF-';
    case 'image/png': return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case 'image/jpeg': return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif': return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'image/avif': return ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4));
    case 'audio/wav': return bytes.length >= 44 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
    case 'audio/mpeg': return bytes.length >= 10 && (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0));
    case 'audio/mp4': return bytes.length >= 12 && ascii(4, 4) === 'ftyp';
    default: return false;
  }
}
