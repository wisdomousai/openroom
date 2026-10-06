import { useLayoutEffect, useRef } from 'react';
import { sanitizeElementCss, sanitizeElementHtml } from '@openroom/schema';

/**
 * Typography for reading material.
 *
 * A hand-written `html` element brings its own look and gets none of this. A
 * markdown-backed one is prose the teacher never styled, so the host supplies a
 * readable default at slide scale. `rem` would track the page root rather than
 * the slide's own scaling, so everything here is in `em`.
 */
const READING_STYLE = [
  '.or-html{padding:2.5em 3em;font-size:1.05em;line-height:1.55;text-align:left}',
  '.or-html > :first-child{margin-top:0}',
  '.or-html > :last-child{margin-bottom:0}',
  '.or-html h1,.or-html h2,.or-html h3,.or-html h4,.or-html h5,.or-html h6{margin:1.2em 0 .5em;line-height:1.2;font-weight:600}',
  '.or-html h1{font-size:1.9em}',
  '.or-html h2{font-size:1.5em}',
  '.or-html h3{font-size:1.25em}',
  '.or-html p,.or-html ul,.or-html ol,.or-html blockquote,.or-html pre{margin:0 0 .85em}',
  '.or-html ul,.or-html ol{padding-left:1.4em}',
  '.or-html li{margin:.25em 0}',
  '.or-html blockquote{padding-left:.9em;border-left:3px solid currentColor;opacity:.75}',
  '.or-html pre{padding:.8em 1em;border-radius:.4em;background:rgba(127,127,127,.14);overflow-x:auto}',
  '.or-html code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}',
  '.or-html pre code{font-size:.88em}',
  '.or-html a{color:inherit;text-underline-offset:.15em}',
  '.or-html img{max-width:100%;height:auto}',
  '.or-html hr{margin:1.4em 0;border:0;border-top:1px solid currentColor;opacity:.25}',
].join('\n');

/**
 * Mount a sanitised HTML/SVG fragment in a closed shadow root so its CSS
 * cannot restyle the slide chrome or a neighbouring poll.
 *
 * `scroll` is for reading material, which is longer than its box on purpose.
 * Everything else stays clipped: a drawing that overflows its box is a layout
 * mistake, not a document.
 */
export function HtmlHost({ html, css, scroll = false }: { html: string; css?: string; scroll?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    if (shadowRef.current === null) {
      shadowRef.current = host.attachShadow({ mode: 'closed' });
    }
    const root = shadowRef.current;
    root.replaceChildren();
    const overflow = scroll ? 'auto' : 'hidden';
    const style = document.createElement('style');
    style.textContent = [
      `:host{display:block;width:100%;height:100%;overflow:hidden}`,
      `.or-html{box-sizing:border-box;width:100%;height:100%;overflow-y:${overflow};overflow-x:hidden;overscroll-behavior:contain}`,
      '.or-html svg{max-width:100%;max-height:100%}',
      scroll ? READING_STYLE : '',
      css !== undefined && css !== '' ? sanitizeElementCss(css) : '',
    ].join('\n');
    const wrap = document.createElement('div');
    wrap.className = 'or-html';
    wrap.innerHTML = sanitizeElementHtml(html);
    root.append(style, wrap);
    delete host.dataset.contentOverflow;
    if (scroll || !host.closest('.slide-canvas__frame')) return;
    // Keep the shadow boundary closed. Report only geometry to the authoring
    // surface, which cannot inspect the fragment itself from outside.
    let disposed = false;
    let scheduled = 0;
    const measure = () => {
      scheduled = 0;
      if (disposed) return;
      const clipped = [wrap, ...wrap.querySelectorAll<HTMLElement>('*')].some((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const computed = getComputedStyle(element);
        return (computed.overflowY !== 'auto' && computed.overflowY !== 'scroll' && element.scrollHeight > element.clientHeight + 2) ||
          (computed.overflowX !== 'auto' && computed.overflowX !== 'scroll' && element.scrollWidth > element.clientWidth + 2);
      });
      const value = String(clipped);
      if (host.dataset.contentOverflow !== value) host.dataset.contentOverflow = value;
    };
    const schedule = () => { if (!disposed && !scheduled) scheduled = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(wrap);
    for (const child of wrap.querySelectorAll('*')) resize.observe(child);
    wrap.addEventListener('load', schedule, true);
    document.fonts.addEventListener('loadingdone', schedule);
    void document.fonts.ready.then(schedule);
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(scheduled);
      resize.disconnect();
      wrap.removeEventListener('load', schedule, true);
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [css, html, scroll]);

  return <div className="outline-step__html-host" ref={hostRef} />;
}
