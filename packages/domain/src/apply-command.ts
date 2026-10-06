/**
 * THE core state transition. Pure and total: it never throws, never performs
 * I/O, and returns a brand-new state object on success.
 *
 * Idempotency keys are the CALLER's responsibility (the Durable Object stores
 * key → result); this function assumes a fresh key.
 *
 * Authorization, terminal-state, no-op and revision gates run here, before the
 * command is dispatched to its family in `apply/`. A family returns
 * `undefined` for commands it does not own; families are disjoint by command
 * name, so dispatch order carries no meaning.
 */
import { isPollOnlyOutline } from './create-session.js';
import { ensureQna } from './qna.js';
import { applyFacilitationCommand, facilitatorCanCommand } from './facilitation.js';
import type { ApplyResult, Command, CommandEnvelope, SessionState } from './types.js';

import { detectNoop } from './apply/detect-noop.js';
import { fail, noop } from './apply/helpers.js';
import { applyInteractionCommands } from './apply/interactions.js';
import { applyMarkCommands } from './apply/marks.js';
import { applyListeningCommands } from './apply/listening.js';
import { applyGroupCommands } from './apply/groups.js';
import { applyNavigateCommands } from './apply/navigate.js';
import { applyQnaCommands } from './apply/qna.js';
import { applySessionCommands } from './apply/session.js';
import { applyTextCommands } from './apply/text.js';
import { applyWriteCommands } from './apply/writes.js';

export { isPeerInstruction } from './apply/helpers.js';

const PARTICIPANT_COMMANDS: ReadonlySet<Command['command']> = new Set([
  'answer.submit',
  'qna.vote',
  'qna.ask',
  'qna.upvote',
]);

export function applyCommand(
  input: SessionState,
  env: CommandEnvelope,
  now: number,
): ApplyResult {
  // Session states stored before the session-Q&A region get it patched in here so
  // every branch below can rely on `state.qna` being present.
  const state = ensureQna(input);
  const { command, actor, expectedRevision } = env;
  const isParticipantCommand = PARTICIPANT_COMMANDS.has(command.command);

  // ---- authorization ------------------------------------------------
  if (isParticipantCommand) {
    if (actor.role !== 'participant' || typeof actor.participantId !== 'string' || actor.participantId === '') {
      return fail('E_FORBIDDEN', `${command.command} requires a participant actor`);
    }
  } else if (actor.role !== 'host') {
    return fail('E_FORBIDDEN', `${command.command} is host-only`);
  } else if (!facilitatorCanCommand(state, actor.facilitatorId ?? '', command)) {
    return fail('E_FORBIDDEN', 'The active presenter controls this action. Co-facilitators can moderate responses and organize groups.');
  }

  // ---- terminal state -----------------------------------------------
  if (state.status === 'ended') {
    return fail('E_ENDED', 'the session has ended');
  }

  // ---- idempotent no-ops, checked BEFORE expectedRevision ------------
  // Retrying a command that has already taken effect must not fail with a
  // revision conflict (INT-06 retry safety).
  const alreadyApplied = detectNoop(state, command);
  if (alreadyApplied) return noop(state);

  // ---- optimistic concurrency ----------------------------------------
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    return fail(
      'E_REVISION_CONFLICT',
      `expected revision ${expectedRevision}, session is at ${state.revision}`,
    );
  }

  // ---- panic freeze ---------------------------------------------------
  if (state.frozen && isParticipantCommand) {
    return fail('E_FROZEN', 'the session is frozen; submissions are paused');
  }

  return (
    applyFacilitationCommand(state, command, actor.facilitatorId ?? '') ??
    applySessionCommands(state, command, actor, now) ??
    applyInteractionCommands(state, command, actor, now) ??
    applyNavigateCommands(state, command, actor, now) ??
    applyMarkCommands(state, command, actor, now) ??
    applyListeningCommands(state, command) ??
    applyGroupCommands(state, command) ??
    applyWriteCommands(state, command, actor, now) ??
    applyTextCommands(state, command, actor, now) ??
    applyQnaCommands(state, command, actor, now) ??
    fail('E_INVALID_TRANSITION', `unknown command: ${JSON.stringify(command)}`)
  );
}
