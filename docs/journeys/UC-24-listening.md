# UC-24 — Listening in a live lesson

## Purpose

A tutor adds a recording, chooses who plays it, and reveals the transcript when
learners are ready. Starting participation preserves that choice. Leaving the
slide stops playback.

## Fixture and surfaces

A two-slide appointment lesson with a locally synthesized 20-second WAV and a
German transcript. The host, projector, learner phone and presenter remote use
the real local Worker. The tone checks playback, not the quality of spoken teaching
material. The test account has its own ordinary session-start quota.

## Lifecycle and acceptance

1. Upload the WAV through the editor, change its label, write the transcript and
   verify the saved draft.
2. Play the editor preview. Enter Present and confirm the preview stops.
3. Select individual listening and show the transcript. Start participation;
   the first live view retains both choices and each learner player starts paused.
4. Switch to room audio. Only the tutor console has a player; the projector and
   learner devices stay silent. Hide the transcript and verify it is absent from
   the audience response, as well as the screen. These consecutive actions must
   preserve each other even while a previous command's snapshot is still arriving.
5. Replay, slow down, show and hide the transcript on the projector and phone.
6. Switch to individual listening. Fail the learner's download, retry it, replay
   and change speed. The tutor's room player is removed and stops.
7. Return to room audio, play, then navigate away. The recording stops. Revisiting
   starts paused, restores the authored mode and keeps the transcript hidden.
8. Open the presenter remote. Reveal and hide the transcript there and verify
   that the other three surfaces follow the same live state.

The session owns the playback mode and transcript visibility. Audio position and
speed remain local user actions; the journey does not imply synchronized playback
clocks across devices. No audio starts automatically.

## Visual notes

Listening controls occupy the tutor's existing session pane. The projector has
no playback controls. Learner playback fits the phone reading view. The private
transcript stays in a collapsed tutor-only section until intentionally published.

## Playwright map and status

`e2e/journeys/UC-24-listening.spec.ts`

Green in Chromium, including the presenter handoff and phone remote. Host,
learner-phone and presenter-remote screenshots were inspected.
Physical phone output, Bluetooth, Safari and production delivery remain separate.
