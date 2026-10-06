/**
 * The desktop's live server: the OpenRoom relay a signed-out desktop starts
 * live sessions on. Address and key go to the desktop shell, which keeps the
 * key in the OS keychain; the page only learns whether a key is set.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { DesktopRelayStatus, OpenRoomDesktopBridge } from '@openroom/editor';
import { Button } from '@openroom/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@openroom/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@openroom/ui/components/dialog';
import { Input } from '@openroom/ui/components/input';
import { Label } from '@openroom/ui/components/label';

/** The bridge with the live server methods; null in a browser or an older desktop build. */
export function liveServerBridge(bridge: OpenRoomDesktopBridge | null): OpenRoomDesktopBridge | null {
  return bridge !== null && typeof bridge.relayStatus === 'function' ? bridge : null;
}

export function LiveServerFields({
  bridge,
  onChange,
  footer,
}: {
  bridge: OpenRoomDesktopBridge;
  onChange?: (status: DesktopRelayStatus) => void;
  footer?: (actions: { busy: boolean }) => ReactNode;
}) {
  const [status, setStatus] = useState<DesktopRelayStatus | null>(null);
  const [origin, setOrigin] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bridge.relayStatus().then((next) => {
      setStatus(next);
      setOrigin(next.origin ?? '');
    }).catch(() => setError('Could not read the live server setting.'));
  }, [bridge]);

  const apply = async (action: () => ReturnType<OpenRoomDesktopBridge['saveRelay']>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStatus(result.status);
      setOrigin(result.status.origin ?? '');
      setKey('');
      onChange?.(result.status);
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return <p className="text-xs text-muted-foreground">{error ?? 'Loading…'}</p>;
  const locked = status.fromEnv;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="live-server-origin">Address</Label>
        <Input
          id="live-server-origin"
          placeholder="https://live.example.org"
          value={origin}
          disabled={locked || busy}
          onChange={(event) => setOrigin(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="live-server-key">Key</Label>
        <Input
          id="live-server-key"
          type="password"
          autoComplete="off"
          placeholder={status.hasKey ? 'Stored in the keychain' : 'RELAY_KEY of the server'}
          value={key}
          disabled={locked || busy || !status.keychain}
          onChange={(event) => setKey(event.target.value)}
        />
        {locked ? <p className="text-xs text-muted-foreground">Set by OPENROOM_RELAY_ORIGIN and OPENROOM_RELAY_KEY.</p> : null}
        {!locked && !status.keychain ? (
          <p className="text-xs text-muted-foreground">No OS keychain on this computer. Set OPENROOM_RELAY_ORIGIN and OPENROOM_RELAY_KEY instead.</p>
        ) : null}
      </div>
      {error === null ? null : <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {footer?.({ busy })}
        {status.origin !== null && !locked ? (
          <Button variant="ghost" disabled={busy} onClick={() => void apply(() => bridge.clearRelay())}>Remove</Button>
        ) : null}
        <Button
          disabled={locked || busy || origin.trim() === ''}
          onClick={() => void apply(() => bridge.saveRelay({ origin, key }))}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function LiveServerDialog({
  bridge,
  onClose,
  onChange,
}: {
  bridge: OpenRoomDesktopBridge;
  onClose: () => void;
  onChange?: (status: DesktopRelayStatus) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Live server</DialogTitle>
          <DialogDescription>
            Signed out, live sessions run on this OpenRoom relay. Anonymous and pseudonymous sessions only.
          </DialogDescription>
        </DialogHeader>
        <LiveServerFields
          bridge={bridge}
          onChange={(status) => { onChange?.(status); onClose(); }}
          footer={({ busy }) => <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>}
        />
      </DialogContent>
    </Dialog>
  );
}

export function LiveServerCard({ bridge }: { bridge: OpenRoomDesktopBridge }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Live server</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          The OpenRoom relay this computer starts live sessions on while signed out. Anonymous and pseudonymous sessions only.
        </p>
        <LiveServerFields bridge={bridge} />
      </CardContent>
    </Card>
  );
}
