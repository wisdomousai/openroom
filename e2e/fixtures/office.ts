import type { BrowserContext } from '@playwright/test';

/** Only the Office host adapter is simulated. Consent, callback, PKCE and APIs use the real Worker. */
export async function officeHostFixture(context: BrowserContext) {
  await context.route('https://appsforoffice.microsoft.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    (() => {
      const handlers = new Map();
      const emit = (type, event) => { for (const handler of handlers.get(type) ?? []) handler(event); };
      let activeView = 'edit';
      const contentSettings = JSON.parse(sessionStorage.getItem('test-office-settings') || '{}');
      let presentationTags = {}, slides = { '42': {} }, selected = ['42'], order = ['42'];
      const save = () => sessionStorage.setItem('test-office-file', JSON.stringify({ presentationTags, slides, selected, order }));
      const stored = sessionStorage.getItem('test-office-file');
      if (stored) { const value = JSON.parse(stored); presentationTags = value.presentationTags; slides = value.slides; selected = value.selected; order = value.order ?? Object.keys(slides); }
      const tags = (data) => ({ getItemOrNullObject: (key) => ({ value: data[key], isNullObject: !(key in data), load() {} }), add: (key, value) => { data[key] = value; save(); }, delete: (key) => { delete data[key]; save(); } });
      window.__officeFile = {
        view: (value) => { activeView = value; emit('activeView', { activeView: value }); },
        read: () => JSON.parse(JSON.stringify({ presentationTags, slides })),
        copy: (from, to) => { slides[to] = { ...slides[from] }; if (!order.includes(to)) order.push(to); selected = [to]; save(); emit('selection'); },
        select: (id) => { selected = [id]; slides[id] ??= {}; if (!order.includes(id)) order.push(id); save(); emit('selection'); },
        reorder: (ids) => { order = ids; save(); },
        remove: (id) => { delete slides[id]; order = order.filter((item) => item !== id); save(); },
        settings: () => JSON.parse(JSON.stringify(contentSettings)),
        replace: (value) => { presentationTags = value.presentationTags; slides = value.slides; order = Object.keys(slides); save(); },
      };
      window.PowerPoint = { run: (work) => work({ sync: () => Promise.resolve(), presentation: { slides: { items: order.map((id) => ({ id, tags: tags(slides[id]) })), load() {} }, tags: tags(presentationTags), getSelectedSlides: () => ({ items: selected.map((id) => ({ id, tags: tags(slides[id]) })), load() {} }) } }) };
      window.Office = {
        HostType: { PowerPoint: 'PowerPoint' }, AsyncResultStatus: { Succeeded: 'succeeded' },
        EventType: { DialogMessageReceived: 'message', DialogEventReceived: 'closed', DocumentSelectionChanged: 'selection', ActiveViewChanged: 'activeView' },
        onReady: () => Promise.resolve({ host: 'PowerPoint' }),
        context: {
          requirements: { isSetSupported: () => true },
          document: { getActiveViewAsync: (callback) => callback({ status: 'succeeded', value: activeView }), addHandlerAsync: (type, handler) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); }, removeHandlerAsync: (type, options) => options?.handler ? handlers.get(type)?.delete(options.handler) : handlers.delete(type), settings: {
            get: (key) => contentSettings[key], set: (key, value) => { contentSettings[key] = value; }, remove: (key) => { delete contentSettings[key]; },
            saveAsync: (callback) => { sessionStorage.setItem('test-office-settings', JSON.stringify(contentSettings)); callback({ status: 'succeeded' }); },
          } },
          ui: {
            messageParent: (message, options) => window.opener.postMessage({ officeMessage: message }, options.targetOrigin),
            displayDialogAsync: (url, options, callback) => {
              const popup = window.open(url, '_blank');
              const events = new Map();
              const received = (event) => { if (event.source === popup && event.data?.officeMessage) events.get('message')?.({ message: event.data.officeMessage, origin: event.origin }); };
              window.addEventListener('message', received);
              const closed = setInterval(() => { if (popup.closed) { clearInterval(closed); window.removeEventListener('message', received); events.get('closed')?.({ error: 12006 }); } }, 50);
              callback({ status: 'succeeded', value: { addEventHandler: (type, handler) => events.set(type, handler), close: () => { clearInterval(closed); window.removeEventListener('message', received); popup.close(); } } });
            },
          },
        },
      };
    })();
  ` }));
}
