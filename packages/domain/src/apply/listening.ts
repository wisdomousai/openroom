import type { ApplyResult, Command, SessionState } from '../types.js';
import { listeningFor } from '../listening.js';
import { commit, fail, noop } from './helpers.js';

export function applyListeningCommands(state: SessionState, command: Command): ApplyResult | undefined {
  if (command.command !== 'listening.set') return undefined;
  const current = listeningFor(state);
  if (!current || current.stepId !== command.stepId) return fail('E_REVISION_CONFLICT', 'the audio slide has changed');
  if ((command.mode === undefined && command.transcriptShown === undefined)
    || (command.mode !== undefined && !['room', 'individual'].includes(command.mode))
    || (command.transcriptShown !== undefined && typeof command.transcriptShown !== 'boolean')) {
    return fail('E_INVALID_ANSWER', 'choose a playback mode or whether to show the transcript');
  }
  // A control changes only its own setting. Delayed snapshots and retries must
  // not restore the other setting from the presenter's previous render.
  const mode = command.mode ?? current.mode;
  const transcriptShown = command.transcriptShown ?? current.transcriptShown;
  if (current.mode === mode && current.transcriptShown === transcriptShown) return noop(state);
  return commit({ ...state, listening: { stepId: current.stepId, mode, transcriptShown } });
}
