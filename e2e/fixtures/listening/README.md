# Listening codec fixtures

These are locally synthesized, quiet 440 Hz tones, each approximately 20 seconds.
They test MP3 and AAC-in-M4A decoding, seeking and portable deck storage. They are
not lesson recordings. WAV bytes are generated directly by the journeys.

Created with FFmpeg 9.0.1:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=20 -filter:a volume=0.02 -c:a libmp3lame -b:a 32k tone.mp3
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=20 -filter:a volume=0.02 -c:a aac -b:a 24k tone.m4a
```
