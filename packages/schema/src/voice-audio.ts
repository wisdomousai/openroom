/** Voice uploads have one metadata-free format whose duration is independently verifiable. */
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 300;
export const VOICE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const VOICE_WAV_MAX_BYTES = 44 + VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS * 2;
export const VOICE_RETENTION_DAYS = 90;
export const VOICE_TRASH_DAYS = 7;
export const VOICE_MAX_RECORDINGS_PER_TASK = 10;

export function encodeVoiceWav(samples: Float32Array): Uint8Array {
  if (samples.length === 0 || samples.length > VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS) throw new Error('voice-duration');
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true); view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i]!)) : 0;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

/** Reject truncated, oversized, multi-channel or mislabeled bytes, not just a claimed duration. */
export function voiceWavDuration(bytes: Uint8Array): number | null {
  if (bytes.length <= 44 || bytes.length > VOICE_WAV_MAX_BYTES || (bytes.length - 44) % 2 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, value: string) => [...value].every((char, i) => view.getUint8(offset + i) === char.charCodeAt(0));
  if (!text(0, 'RIFF') || !text(8, 'WAVE') || !text(12, 'fmt ') || !text(36, 'data') ||
    view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== VOICE_SAMPLE_RATE || view.getUint32(28, true) !== VOICE_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44) return null;
  return Math.ceil((bytes.length - 44) / 2 / VOICE_SAMPLE_RATE * 1000);
}
