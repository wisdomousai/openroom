import { JoinError } from '@openroom/sdk';

/** The line the join screen shows for a failed join. */
export function joinErrorMessage(error: unknown): string {
  if (error instanceof JoinError && error.code === 'session-full') return 'This session is full.';
  return error instanceof Error ? error.message : 'Join failed.';
}
