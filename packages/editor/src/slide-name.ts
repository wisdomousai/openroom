/** The fields of a freeform object that can name its slide. */
interface NamedElement {
  type: string;
  text?: string;
  role?: string;
  alt?: string;
  title?: string;
  html?: string;
  markdown?: string;
  url?: string;
  assetId?: string;
  resourceId?: string;
}

/**
 * The name of a freeform (blank) slide with no title, in the deck editor's
 * rail and the live console alike: its heading box, else its first text box,
 * else what its first object shows. A slide with nothing on it but empty
 * boxes is an empty slide.
 */
export function freeformSlideName(elements: readonly NamedElement[] | undefined): string {
  const list = elements ?? [];
  const texts = list.filter((element) => element.type === 'text');
  const headings = texts.filter((element) => element.role === 'heading');
  const line = [...headings, ...texts].map((element) => element.text?.trim() ?? '').find((text) => text !== '');
  if (line !== undefined) return line;
  // An image box with no picture yet is a placeholder, not content.
  const object = list.find((element) => element.type !== 'text' &&
    (element.type !== 'image' || Boolean(element.url || element.assetId || element.resourceId)));
  if (object === undefined) return 'Empty slide';
  if (object.type === 'image') return object.alt?.trim() || 'Picture';
  if (object.type === 'iframe') return object.title?.trim() || 'Web page';
  if (object.type === 'pdf') return object.title?.trim() || 'PDF';
  if (object.markdown !== undefined) {
    const first = object.markdown.split('\n').map((row) => row.replace(/^[\s#>*-]+/, '').trim()).find((row) => row !== '');
    return first ?? 'Reading';
  }
  const words = (object.html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (words !== '') return words;
  return /<svg[\s>]/i.test(object.html ?? '') ? 'Drawing' : 'HTML';
}
