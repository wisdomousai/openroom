/**
 * Desktop's core renderer: the file window (`#/file`) and the presentation
 * window (`#/present`), served at `openroom://app/core/index.html`.
 *
 * It is built with the core (`build:core`), so a build without the workspace
 * still opens, edits, presents and runs `.openroom` files live on the relay.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { bootstrapTheme, ThemeProvider } from '@openroom/ui/theme-provider';
import { TooltipProvider } from '@openroom/ui/components/tooltip';
import { DesktopFileEditor } from './DesktopFileEditor';
import { DesktopPresentationPage } from './DesktopPresentationPage';
import { probeWorkspace } from './destinations';
import { DesktopFileEditorServices } from './editor-services';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return hash;
}

function DesktopWindow() {
  const hash = useHash();
  return (
    <DesktopFileEditorServices>
      {hash.startsWith('#/present') ? <DesktopPresentationPage /> : <DesktopFileEditor />}
    </DesktopFileEditorServices>
  );
}

// Paint the stored theme before the first React frame.
bootstrapTheme();

const root = document.getElementById('app');
if (root) {
  // Whether this build ships the workspace decides which links the editor offers.
  void probeWorkspace().then(() => {
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <TooltipProvider delayDuration={250}>
              <DesktopWindow />
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
}
