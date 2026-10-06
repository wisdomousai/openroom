interface SearchPage { title: string; description: string; url: string; text: string }
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
export function searchManual(pages: SearchPage[], query: string) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean).slice(0, 20);
  if (!terms.length) return [];
  return pages.flatMap((page) => {
    const title = normalize(page.title); const description = normalize(page.description); const body = normalize(page.text);
    if (!terms.every((term) => `${title} ${description} ${body}`.includes(term))) return [];
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 10 : 0) + (description.includes(term) ? 4 : 0) + (body.includes(term) ? 1 : 0), 0);
    const match = body.indexOf(terms[0]!); const start = Math.max(0, match - 65);
    const excerpt = `${start ? '…' : ''}${page.text.slice(start, start + 220).trim()}${start + 220 < page.text.length ? '…' : ''}`;
    return [{ ...page, score, excerpt }];
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
