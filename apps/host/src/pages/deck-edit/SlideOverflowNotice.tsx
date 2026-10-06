import { Button } from '../../components/ui/button';
import type { SlideOverflowIssue } from './slide-overflow';

export function SlideOverflowNotice({ issues, onReview }: { issues: SlideOverflowIssue[]; onReview: () => void }) {
  return issues.length > 0 ? <div data-slide-overflow className="flex w-full min-w-0 max-w-[1000px] shrink-0 flex-wrap items-center justify-between gap-2">
    <p role="status" className="text-sm text-destructive">
      {issues.length === 1 ? 'One item does' : `${issues.length} items do`} not fit on this slide.
    </p>
    <Button size="sm" variant="outline" onClick={onReview}>Review overflow</Button>
  </div> : null;
}
