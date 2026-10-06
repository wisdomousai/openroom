import type { SessionError } from '../types';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

/** Server-side outline validation errors, with their stable codes and pointers. */
export function SessionErrorList({
  message,
  errors,
}: {
  message: string | null;
  errors: SessionError[];
}) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{message}</AlertTitle>
      {errors.length > 0 ? (
        <AlertDescription>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {errors.map((e, i) => (
              <li key={`${e.code}-${e.path}-${i}`}>
                <code className="rounded border border-destructive px-1">{e.code}</code>{' '}
                <code className="rounded border border-destructive px-1">{e.path || '/'}</code>: {e.message}
              </li>
            ))}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
