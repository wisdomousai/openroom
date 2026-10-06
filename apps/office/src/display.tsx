import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StageSnapshot } from '@openroom/sdk';
import { StageView } from '../../stage/src/StageView';
import './display.css';

function Preview() {
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'openroom.preview' || event.data.snapshot?.role !== 'stage') return;
      setSnapshot(event.data.snapshot as StageSnapshot);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'openroom.preview.ready' }, location.origin);
    const announce = setInterval(() => window.parent.postMessage({ type: 'openroom.preview.ready' }, location.origin), 1000);
    return () => { window.removeEventListener('message', receive); clearInterval(announce); };
  }, []);
  return snapshot ? <div className="office-preview"><StageView snapshot={snapshot} status="live" embedded hideRail /></div> : <div className="display-message"><p>Open an activity rehearsal from the OpenRoom pane.</p></div>;
}
createRoot(document.getElementById('app')!).render(<Preview />);
