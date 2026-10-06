/** A deliberately small, identity-free document for a facilitator to review and share. */
export interface RecapResult {
  prompt: string;
  responses: number;
  unit: 'responses' | 'group responses';
  measure: 'Responses' | 'Points' | 'Summary';
  rows: { label: string; value: number }[];
}
export interface RecapQuote { prompt: string; text: string }
export interface RecapCandidates {
  revision: number;
  title: string;
  results: (RecapResult & { id: string })[];
  discussion: (RecapQuote & { id: string })[];
  questions: (RecapQuote & { id: string })[];
}
export interface RecapSelection {
  revision: number;
  title: string;
  resultIds: string[];
  discussionIds: string[];
  questionIds: string[];
  discussion: string;
  followUp: string;
}
export interface SessionRecap {
  title: string;
  results: RecapResult[];
  discussionPoints: RecapQuote[];
  questions: RecapQuote[];
  discussion: string;
  followUp: string;
}

export function parseRecapSelection(value: unknown): RecapSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = ['revision', 'title', 'resultIds', 'discussionIds', 'questionIds', 'discussion', 'followUp'];
  if (Object.keys(v).some((key) => !keys.includes(key))) return null;
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 0) return null;
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 160) return null;
  for (const key of ['discussion', 'followUp']) if (typeof v[key] !== 'string' || v[key].length > 10000) return null;
  for (const key of ['resultIds', 'discussionIds', 'questionIds']) {
    const ids = v[key];
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string' || !/^[rdq][0-9]+(?:-[0-9]+)?$/.test(id)) || new Set(ids).size !== ids.length) return null;
  }
  return { revision: v.revision as number, title: v.title.trim(), resultIds: v.resultIds as string[], discussionIds: v.discussionIds as string[], questionIds: v.questionIds as string[], discussion: (v.discussion as string).trim(), followUp: (v.followUp as string).trim() };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (value: number) => String(Math.round(value * 100) / 100);
const responseUnit = (result: RecapResult) => result.responses === 1 ? (result.unit === 'group responses' ? 'group response' : 'response') : result.unit;

/** No scripts, URLs, remote assets, or interpreted markup from authored/audience text. */
export function recapHtml(recap: SessionRecap): string {
  const text = (value: string) => `<p class="prose">${escapeHtml(value)}</p>`;
  const quotes = (title: string, values: RecapQuote[]) => values.length ? `<section><h2>${title}</h2>${values.map((quote) => `<article><h3>${escapeHtml(quote.prompt)}</h3><blockquote>${escapeHtml(quote.text)}</blockquote></article>`).join('')}</section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(recap.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17212d;font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:40px auto;background:white;padding:56px;border-top:6px solid #264b70}header{padding-bottom:24px;border-bottom:1px solid #d9dfe5}h1{font:600 36px/1.2 Georgia,serif;overflow-wrap:anywhere;margin:8px 0}h2{font-size:22px;line-height:1.3;margin:32px 0 16px}h3{font-size:17px;margin:20px 0 6px;overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#526578}.muted{color:#526578;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #d9dfe5;overflow-wrap:anywhere}th:last-child,td:last-child{text-align:right;width:25%}th{background:#eef2f6;font-size:13px}blockquote{margin:8px 0;padding:12px 18px;border-left:3px solid #587b9c;background:#f5f7fa;white-space:pre-wrap;overflow-wrap:anywhere}.prose{white-space:pre-wrap;overflow-wrap:anywhere}article{break-inside:avoid}footer{border-top:1px solid #d9dfe5;margin-top:40px;padding-top:16px;font-size:12px;color:#526578}@media(max-width:600px){main{margin:0;padding:28px 20px}h1{font-size:28px}}@media print{body{background:white}main{max-width:none;margin:0;padding:12mm 4mm}h2,h3{break-after:avoid}thead{display:table-header-group}footer{margin-top:24px}}@page{margin:14mm}
</style></head><body><main><header><div class="eyebrow">Workshop recap</div><h1>${escapeHtml(recap.title)}</h1></header>${recap.results.length ? `<section><h2>Selected results</h2>${recap.results.map((result) => `<article><h3>${escapeHtml(result.prompt)}</h3><div class="muted">${result.responses} ${escapeHtml(responseUnit(result))}</div><table><thead><tr><th scope="col">${result.measure === 'Summary' ? 'Measure' : 'Option'}</th><th scope="col">${escapeHtml(result.measure)}</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${number(row.value)}</td></tr>`).join('')}</tbody></table></article>`).join('')}</section>` : ''}${quotes('Discussion points', recap.discussionPoints)}${recap.discussion ? `<section><h2>Discussion summary</h2>${text(recap.discussion)}</section>` : ''}${quotes('Questions to take forward', recap.questions)}${recap.followUp ? `<section><h2>Follow-up</h2>${text(recap.followUp)}</section>` : ''}<footer>Selected and reviewed by the facilitator · OpenRoom</footer></main></body></html>`;
}
