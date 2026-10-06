import { manual, docUrl, plainText } from '../../lib/docs';
export async function GET() {
  const pages = await manual();
  return new Response(JSON.stringify(pages.map((page) => ({
    title: page.data.title, description: page.data.description,
    url: docUrl(page.id), text: plainText(page.body ?? ''),
  }))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
