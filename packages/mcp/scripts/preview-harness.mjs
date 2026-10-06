import { createServer } from 'node:http';

import { deckPreviewResource } from '../dist/ui-resource.js';

const port = Number(process.env['OPENROOM_PREVIEW_PORT'] ?? 4179);
const result = {
  ok: true,
  previewVersion: 1,
  source: { kind: 'deck', deckId: 'visual-check', version: 3, currentVersion: 3 },
  links: {
    assetOrigin: `http://127.0.0.1:${String(port)}`,
    browserEditorUrl: `http://127.0.0.1:${String(port)}/host/#/decks/visual-check/edit`,
    desktopHandoffUrl: `http://127.0.0.1:${String(port)}/desktop/open?deckId=visual-check`,
  },
  outline: {
    version: 1,
    meta: { title: 'French B1 revision' },
    defaults: { theme: 'paper' },
    steps: [
      {
        id: 'welcome',
        kind: 'title',
        title: 'Parler du week-end',
        body: 'Build a clear answer, one part at a time.',
        media: { type: 'image', url: 'https://unknown.example/photo.jpg', alt: 'Two friends talking at a café' },
        reveal: [['header'], ['body'], ['image']],
      },
      {
        id: 'weekend-example',
        kind: 'term',
        term: 'D’abord… ensuite… enfin…',
        meaning: 'Use these markers to put events in order.',
        breakoutOf: { stepId: 'welcome', afterKey: 'body' },
      },
      { id: 'check', kind: 'interaction', interactionId: 'q1' },
    ],
    interactions: [{
      id: 'q1', type: 'choice', prompt: 'Which answer is in the past tense?',
      options: [{ id: 'a', label: 'Je vais au cinéma.' }, { id: 'b', label: 'Je suis allé au cinéma.' }],
    }],
  },
};

const resource = deckPreviewResource(`http://127.0.0.1:${String(port)}`).content;
const widget = String(resource.text).replace(
  '<script>',
  `<script>window.openai={toolOutput:${JSON.stringify(result)},theme:'light',requestDisplayMode:async()=>({mode:'fullscreen'}),openExternal:async()=>({ok:true}),setOpenInAppUrl:()=>{}};</script><script>`,
);

createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(widget);
    return;
  }
  response.writeHead(404).end('Not found');
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Deck preview harness: http://127.0.0.1:${String(port)}/\n`);
});
