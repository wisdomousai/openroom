/** A readable projection of captured responses, without account or participant identifiers. */
export interface SavedQuestionResult {
  prompt: string;
  measure: 'Responses' | 'Points' | 'Summary';
  rows: { label: string; value: number }[];
  entries: string[];
}
export interface SavedResults { title: string; questions: SavedQuestionResult[] }
export interface SavedResultsFile {
  id: string;
  title: string;
  deckId: string | null;
  spaceId: string | null;
  folderId: string | null;
  hasIndividualResponses: boolean;
}
export interface SavedResultsDocument { file: SavedResultsFile; results: SavedResults }

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const number = (value: number) => String(Math.round(value * 100) / 100);

/** Standalone printable report. Audience text never becomes markup or an external URL. */
export function savedResultsHtml(results: SavedResults): string {
  const questions = results.questions.map((question) => `<section><h2>${escapeHtml(question.prompt)}</h2>${question.rows.length ? `<table><thead><tr><th scope="col">${question.measure === 'Summary' ? 'Measure' : 'Answer'}</th><th scope="col">${escapeHtml(question.measure)}</th></tr></thead><tbody>${question.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${number(row.value)}</td></tr>`).join('')}</tbody></table>` : ''}${question.entries.map((entry) => `<blockquote>${escapeHtml(entry)}</blockquote>`).join('')}${!question.rows.length && !question.entries.length ? '<p class="muted">No visible responses were saved for this question.</p>' : ''}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(results.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17212d;font:16px/1.6 system-ui,sans-serif}main{max-width:900px;margin:40px auto;background:white;padding:48px;border-top:5px solid #264b70}h1{font:600 36px/1.2 Georgia,serif;margin:12px 0 32px}h2{font-size:21px;line-height:1.4;margin:0 0 20px}h1,h2,th,blockquote{overflow-wrap:anywhere}section{border-top:1px solid #d9dfe5;padding:28px 0;break-inside:avoid}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#526578}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e1e5ea}tbody th{font-weight:400}thead{color:#526578;background:#f5f7fa}th:last-child,td:last-child{text-align:right;width:100px}blockquote{margin:14px 0;border-left:3px solid #708ca8;padding:8px 18px;white-space:pre-wrap}.muted,footer{font-size:13px;color:#526578}footer{border-top:1px solid #d9dfe5;padding-top:24px}@media(max-width:600px){main{margin:0;padding:28px 20px}h1{font-size:28px}}@media print{body{background:white}main{margin:0;padding:0;max-width:none}thead{display:table-header-group}}@page{margin:18mm}
</style></head><body><main><div class="eyebrow">Saved results</div><h1>${escapeHtml(results.title)}</h1>${questions || '<p>No questions in this deck.</p>'}<footer>OpenRoom · Written answers may contain names. Review this document before sharing.</footer></main></body></html>`;
}
