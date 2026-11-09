import { createContext, useContext } from 'react';
import { ApiError } from '../api/client';

/**
 * A revoked, expired or lapsed link all answer 401, on reads and writes alike
 * (requireStudentLink). Every other failure leaves the link valid.
 */
export function isDeadLink(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export interface LearnerLink {
  /** true once any request with this link was refused; saves and sends stay off. */
  refused: boolean;
  /**
   * Tell the page about a failed request. Returns true when it was a refused
   * link, so the task shows no retry message of its own.
   */
  report: (error: unknown) => boolean;
}

const LearnerLinkContext = createContext<LearnerLink>({ refused: false, report: () => false });

/** Provided by the learner page; outside it (the tutor's views) nothing is refused. */
export const LearnerLinkProvider = LearnerLinkContext.Provider;

export function useLearnerLink(): LearnerLink {
  return useContext(LearnerLinkContext);
}
