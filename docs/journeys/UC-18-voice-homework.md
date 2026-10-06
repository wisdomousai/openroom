# UC-18 — Private voice homework

A tutor sets a voice prompt in a deck and publishes it with the session notes.
A learner uses their personal link to record a response or choose an audio file.
They can listen, record again, download their copy, send, and retry a failed send.
A tutor reviews the original task beside the recording, saves private feedback,
and deliberately shares comments tied to positions in that response.

## Acceptance

- Five-minute responses; source files at most 20 MiB. The browser converts locally
  to mono PCM WAV. The server derives duration from the verified bytes.
- Microphone denial leaves the file choice available. Switching away from the
  Lesson tab, hiding the page, or leaving it releases microphone tracks.
- Learner requests carry the personal link in an authorization header and omit cookies.
  No credential or public audio URL is handed to the player.
- A failed upload leaves the preview and download available. Retrying the same
  submission is idempotent; it never replaces an earlier recording.
- Only the submitting learner and context editors can read, trash or restore audio.
  Draft feedback remains private; published comments reach only that learner.
- Comments are bounded by the recording duration and seek to the selected moment.
- Up to ten retained recordings per learner/task, including recoverable trash. Cleanup frees space.
- Trash denies playback and allows restoration for seven days, within the 90-day
  retention limit. Cleanup permanently removes bytes after either deadline.
  Browser-confirmed context/session purge removes indexed bytes. Feedback remains.
- The 390px view has no horizontal overflow and usable playback/delete controls.

## Evidence

`UC-18-voice-homework.spec.ts` exercises microphone denial, local conversion, a failed
upload/retry, both playback surfaces, private/published timed feedback, trash/restore,
reload, and a second learner. It also drives real MediaRecorder and audio decoding
with a synthetic microphone, checking that tab changes stop its track.

Worker tests cover ownership, credential-family denial, invalid/oversized content,
range responses, immutable uploads, revision conflicts, retention, purge and limits.
Schema tests validate the PCM header, sample conversion, and duration bound. Editor
fuzz exercises adding voice homework through the structured write path.

Physical microphones, Safari/mobile codecs, Windows, hosted cleanup and production
storage are release checks; the synthetic Chromium microphone does not prove them.

## Status

Green in Chromium on 2026-09-18 with fresh disposable D1/R2 storage. The final journey
passed in 8.3 seconds, including trash/restore. Four Worker suites passed 77 tests,
including authenticated MCP audio delivery. CLI audio-byte parity passed four tests.
No deployment or physical-device release claim is implied.
