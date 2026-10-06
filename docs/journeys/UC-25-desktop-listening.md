# UC-25 — Portable listening recordings

## Purpose

A recording belongs to its deck and plays after the file is reopened without a
cloud asset service. The tutor can seek, replay and reveal the transcript on an
audience window without creating a live session.

## Fixture and surfaces

An isolated macOS Electron profile opens a two-slide `.openroom` file. A test-only
replacement chooses the fixture in the OS file picker; import IPC, package save,
package verification, reload and the native resource protocol are real.

WAV, MP3 and AAC-in-M4A recordings are locally synthesized 20-second tones.
See `e2e/fixtures/listening/README.md`. These are codec fixtures, not teaching audio.

## Lifecycle and acceptance

1. Choose the recording through the editor and add a private transcript.
2. Save the file and independently reopen its package to verify embedded audio
   identity, content type, listening mode and transcript.
3. Block the local cloud endpoint and reload the desktop editor. The recording
   loads from the portable deck and plays.
4. Enter Present. Editor preview playback stops and the presenter player is paused.
5. Open the audience window. It has no audio player or unreleased transcript.
6. Play from the tutor console, seek to 12 seconds and slow playback to 0.75×.
7. Show and hide the transcript; the audience window follows both changes.
8. Move to the next slide. Playback stops and the audience follows the new slide.

## Visual notes

The editor labels the recording as saved in the deck, without exposing its
internal resource address. Playback stays beside the tutor's preview. The
audience window contains the slide and the released transcript only.

## Playwright map and status

`e2e/journeys/UC-25-desktop-listening.spec.ts`

Run from `e2e` with `RUN_DESKTOP_JOURNEY=1` after building Desktop. All three codec
journeys are green on the local macOS development build. Tutor and audience-window
screenshots were inspected.
Signed distribution, Windows, physical loudspeakers and an external projector
remain separate acceptance checks.
