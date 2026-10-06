import { useCallback, useRef, useState } from 'react';
import { cn } from './lib/utils';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'warn' | 'error';
}

export function useToasts(): {
  toasts: Toast[];
  push: (message: string, tone?: Toast['tone']) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);
  return { toasts, push };
}

const TONE: Record<Toast['tone'], string> = {
  info: 'border-border bg-popover text-popover-foreground',
  warn: 'border-chart-3 bg-popover text-popover-foreground',
  error: 'border-destructive bg-popover text-destructive',
};

export function ToastRegion({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-theme-surface=""
          className={cn('rounded-md border px-3 py-2 text-sm', TONE[t.tone])}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
