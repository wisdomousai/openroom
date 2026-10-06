import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { SlideMedia } from './slide-types';

/** Only an individual learner gets a player inside the shared slide renderer. */
export const ListeningAudience = createContext<'audience' | 'participant'>('audience');

export function AudioPlayer({ src, label }: { src: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = audio.current;
    const pause = () => element?.pause();
    window.addEventListener('pagehide', pause);
    return () => {
      window.removeEventListener('pagehide', pause);
      element?.pause();
    };
  }, [src]);
  const replay = async () => {
    const element = audio.current;
    if (!element) return;
    try { element.currentTime = 0; await element.play(); setError(null); }
    catch (cause) {
      // Leaving the slide or pausing during load deliberately interrupts play().
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError('Playback could not start. Try Play again.');
    }
  };
  return <div className="listening-player">
    <audio ref={audio} src={src} controls preload="metadata" aria-label={label}
      onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
      onPlay={() => setError(null)}
      onError={() => setError('This audio could not be loaded. Check the connection or choose another recording.')} />
    <div className="listening-player__controls">
      <button type="button" onClick={() => void replay()}>Replay</button>
      <div role="group" aria-label="Playback speed">
        {[0.75, 1, 1.25, 1.5].map((rate) => <button type="button" key={rate} aria-pressed={speed === rate}
          onClick={() => { if (audio.current) audio.current.playbackRate = rate; setSpeed(rate); }}>{rate}×</button>)}
      </div>
    </div>
    {error ? <div role="alert" className="listening-player__error">{error} <button type="button" onClick={() => { setError(null); audio.current?.load(); }}>Retry loading</button></div> : null}
  </div>;
}

export function ListeningBlock({ media }: { media: SlideMedia }) {
  const role = useContext(ListeningAudience);
  const individual = media.listening?.mode === 'individual';
  return <section className="listening-block" aria-label="Listening">
    <p className="listening-block__title">{media.alt}</p>
    <p className="listening-block__instruction">{individual ? 'Listen on your own device.' : 'Listen together. Your tutor plays the recording.'}</p>
    {role === 'participant' && individual && media.url ? <AudioPlayer key={media.url} src={media.url} label={media.alt} /> : null}
    {media.listening?.transcript ? <div className="listening-block__transcript"><h3>Transcript</h3><p>{media.listening.transcript}</p></div> : null}
  </section>;
}
