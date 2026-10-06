import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './App';
import { bootstrapTheme, ThemeProvider } from '@openroom/ui/theme-provider';
import { TooltipProvider } from '@openroom/ui/components/tooltip';
import { queryClient } from './query-client';

// Paint the stored theme before the first React frame.
bootstrapTheme();

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider delayDuration={250}>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
