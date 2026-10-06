import { useEffect, useState } from 'react';

/** A content add-in may be created directly in Slide Show, with no view-change event. */
export function useOfficeView(office: typeof Office | null) {
  const [view, setView] = useState<'edit' | 'read' | null>(null);
  useEffect(() => {
    if (!office || typeof office.context.document.getActiveViewAsync !== 'function') return;
    let stopped = false;
    const read = () => office.context.document.getActiveViewAsync((result) => {
      if (!stopped && result.status === office.AsyncResultStatus.Succeeded) setView(result.value === 'read' ? 'read' : 'edit');
    });
    const changed = read;
    read();
    office.context.document.addHandlerAsync(office.EventType.ActiveViewChanged, changed);
    document.addEventListener('visibilitychange', read);
    return () => {
      stopped = true;
      office.context.document.removeHandlerAsync(office.EventType.ActiveViewChanged, { handler: changed });
      document.removeEventListener('visibilitychange', read);
    };
  }, [office]);
  return view;
}
