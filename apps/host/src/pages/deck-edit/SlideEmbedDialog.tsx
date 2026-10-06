import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';

export function SlideEmbedDialog({ stepId, prepare, onClose }: { stepId: string | null; prepare: (stepId: string) => Promise<string>; onClose: () => void }) {
  const [code, setCode] = useState(''), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!stepId) return;
    let stopped = false;
    setCode(''); setError(''); setCopied(false);
    void prepare(stepId).then((value) => { if (!stopped) setCode(value); }).catch((cause: unknown) => { if (!stopped) setError(cause instanceof Error ? cause.message : 'Could not prepare this slide.'); });
    return () => { stopped = true; };
    // Capture the requested slide once; saving updates the document adapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);
  return <Dialog open={stepId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Embed this slide in PowerPoint</DialogTitle><DialogDescription>Insert OpenRoom Slide in PowerPoint, then paste this code into the add-in.</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {code ? <>
        <Input aria-label="Slide embed code" readOnly value={code} onFocus={(event) => event.currentTarget.select()} />
        <Button onClick={() => { void (navigator.clipboard?.writeText(code) ?? Promise.reject(new Error('Clipboard unavailable'))).then(() => setCopied(true)).catch(() => setError('Select and copy the code above. Clipboard access is unavailable.')); }}>Copy embed code</Button>
        {copied ? <p role="status" className="text-sm text-muted-foreground">Embed code copied.</p> : null}
        <p className="text-sm text-muted-foreground">The code identifies this slide. Sign in to OpenRoom in the add-in to use it.</p>
      </> : !error ? <p role="status">Saving the slide…</p> : null}
    </DialogContent>
  </Dialog>;
}
