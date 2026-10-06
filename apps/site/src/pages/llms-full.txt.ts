import { manual, docUrl } from '../lib/docs';
export async function GET() {
  const pages = await manual();
  const text = '# OpenRoom user manual\n\n' + pages.map((page) =>
    `## ${page.data.title}\n\nSource: https://openroom.app${docUrl(page.id)}\n\n${page.data.description}\n\n${(page.body ?? '').replace(/^#/gm, '##').replace(/\]\(\/(?!\/)/g, '](https://openroom.app/')}`,
  ).join('\n\n---\n\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
