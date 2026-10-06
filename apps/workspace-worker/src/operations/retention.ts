import type { ControlEnv } from '../auth';
import { expireSessionArchives } from '../archives';
import { expireLearnerAudio } from '../learner-audio';

/** Finish both bounded jobs even when one fails; cron failure must remain visible. */
export async function cleanupRetainedMedia(env: ControlEnv): Promise<void> {
  const kinds = ['learner-audio', 'session-archives'] as const;
  const results = await Promise.allSettled([expireLearnerAudio(env), expireSessionArchives(env)]);
  let failed = false;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') console.info(JSON.stringify({ event: 'retention.cleanup.completed', kind: kinds[index], processed: result.value, limit: 100 }));
    else {
      failed = true;
      // Provider errors can contain keys or payloads; log the job, never the raw cause.
      console.warn(JSON.stringify({ event: 'retention.cleanup.failed', kind: kinds[index] }));
    }
  });
  if (failed) throw new Error('Retention cleanup needs attention; see redacted retention diagnostics.');
}
