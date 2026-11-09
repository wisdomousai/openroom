import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@openroom/ui/components/button';
import { useLearnerLanguage } from '../../lib/learner-language';
import { useLearnerLink } from '../../lib/learner-link';

/**
 * Reloads the lesson in place after a save answered 409 (the tutor changed the
 * task). The task component stays mounted, so the student's text or recording
 * stays in its local state while the revised prompt and revision replace the old.
 */
export function useRevisedTask(onLoaded: () => void) {
  const queryClient = useQueryClient();
  const link = useLearnerLink();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    setLoading(true); setFailed(false);
    try {
      await queryClient.refetchQueries({ queryKey: ['learner', 'sessions'] }, { throwOnError: true });
      onLoaded();
    } catch (cause) {
      if (!link.report(cause)) setFailed(true);
    } finally { setLoading(false); }
  };
  return { loading, failed, load };
}

export function TaskChangedNotice({ loading, failed, onShow }: { loading: boolean; failed: boolean; onShow: () => void }) {
  const { copy } = useLearnerLanguage();
  const link = useLearnerLink();
  return (
    <div className="grid gap-2">
      <p role="alert" className="text-secondary text-destructive">{copy.taskChanged}</p>
      {failed ? <p role="alert" className="text-secondary text-destructive">{copy.revisedTaskError}</p> : null}
      <Button type="button" variant="outline" className="min-h-11 w-fit" disabled={loading || link.refused} onClick={onShow}>{copy.showRevisedTask}</Button>
    </div>
  );
}
