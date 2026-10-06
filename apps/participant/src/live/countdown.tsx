import { useEffect, useState } from 'react';

export function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function useCountdown(closesAt: number | undefined): number | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    if (closesAt === undefined) {
      setSec(null);
      return;
    }
    const tick = () => setSec(Math.max(0, Math.ceil((closesAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [closesAt]);
  return sec;
}

export function CountdownLabel({ closesAt }: { closesAt: number | undefined }) {
  const remaining = useCountdown(closesAt);
  if (remaining === null) return null;
  return (
    <p className="countdown" aria-live="polite">
      {formatCountdown(remaining)} remaining
    </p>
  );
}
