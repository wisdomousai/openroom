import { expect, it } from 'vitest';
import { encodeVoiceWav, voiceWavDuration, VOICE_SAMPLE_RATE, VOICE_WAV_MAX_BYTES } from '../src/voice-audio.js';

it('encodes bounded mono PCM and derives duration from complete bytes', () => {
  const samples = new Float32Array(VOICE_SAMPLE_RATE);
  samples[0] = -1; samples[1] = 1; samples[2] = Number.NaN;
  const wav = encodeVoiceWav(samples);
  expect(voiceWavDuration(wav)).toBe(1000);
  const pcm = new DataView(wav.buffer);
  expect([pcm.getInt16(44, true), pcm.getInt16(46, true), pcm.getInt16(48, true)]).toEqual([-32768, 32767, 0]);
  expect(voiceWavDuration(wav.subarray(0, wav.length - 2))).toBeNull();
  pcm.setUint16(22, 2, true);
  expect(voiceWavDuration(wav)).toBeNull();
  expect(voiceWavDuration(new Uint8Array(VOICE_WAV_MAX_BYTES + 2))).toBeNull();
});
