import { AccountPanel } from '../AccountPanel';
import type { AuthSession } from '../useAuth';

/** Signed-out entry: brand + account form only — no workspace chrome. */
export function SignInPage({ session }: { session: AuthSession }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">OpenRoom</h1>
        </div>
        <AccountPanel session={session} />
      </div>
    </div>
  );
}
