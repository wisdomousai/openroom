import { createRoot } from 'react-dom/client';
import { App } from './App';
import { slidePreview } from './slide-preview';

const onEmbed = new URLSearchParams(location.search).has('embed') && window.parent !== window
  ? async (binding: Parameters<typeof slidePreview>[1], outline: Parameters<typeof slidePreview>[0]) => {
    window.parent.postMessage({ ...slidePreview(outline, binding), type: 'openroom.slide.selected' }, location.origin);
  } : undefined;

const root = createRoot(document.getElementById('app')!);
root.render(<p role="status" className="boot">Connecting to PowerPoint…</p>);
async function start() {
  // The chooser lives in our own same-origin iframe. Office APIs belong to the
  // containing content runtime, including its selected slide and document settings.
  if (onEmbed) {
    try {
      const parent = window.parent as unknown as { Office: typeof Office; PowerPoint: typeof PowerPoint };
      Object.assign(window, { Office: parent.Office, PowerPoint: parent.PowerPoint });
    } catch { root.render(<App office={null} />); return; }
  }
  if (typeof Office === 'undefined') { root.render(<App office={null} onEmbed={onEmbed} />); return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([Office.onReady(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8000); })]);
    root.render(<App office={info?.host === Office.HostType.PowerPoint ? Office : null} onEmbed={onEmbed} />);
  } catch { root.render(<App office={null} onEmbed={onEmbed} />); } finally { clearTimeout(timer); }
}
void start();
