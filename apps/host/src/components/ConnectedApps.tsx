import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../api/client';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';

interface Connection { id: string; name: string; origin: string }
export function ConnectedApps({ signedIn }: { signedIn: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['settings', 'connections'], enabled: signedIn, queryFn: () => request<{ connections: Connection[] }>('/api/my/connections') });
  const revoke = useMutation({ mutationFn: (id: string) => request(`/api/my/connections/${encodeURIComponent(id)}`, { method: 'DELETE', mutating: true }), onSuccess: () => client.invalidateQueries({ queryKey: ['settings', 'connections'] }) });
  if (!signedIn) return null;
  return <Card><CardHeader><CardTitle className="text-base">Connected applications</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Manage access for PowerPoint and applications connected through sign-in. Revoking a connection also disables live host controls obtained through it.</p>
    {query.isPending ? <p role="status" className="text-sm">Loading connections…</p> : null}
    {query.error || revoke.error ? <p role="alert" className="text-sm text-destructive">Could not update connections. Try again.</p> : null}
    {query.data?.connections.length === 0 ? <p className="text-sm text-muted-foreground">No connected applications.</p> : null}
    {query.data?.connections.map((connection) => <div key={connection.id} className="flex items-center justify-between gap-4 rounded-lg border p-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{connection.name}</p><p className="break-all text-xs text-muted-foreground">{connection.origin}</p></div><Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(connection.id)} aria-label={`Revoke ${connection.name}`}>Revoke</Button></div>)}
  </CardContent></Card>;
}
