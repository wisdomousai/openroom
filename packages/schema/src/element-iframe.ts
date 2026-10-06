function httpsEmbedUrlIssue(value: string, label: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} url must be a valid absolute URL`;
  }
  if (url.protocol !== 'https:') return `${label} url must use https`;
  if (url.username !== '' || url.password !== '') return `${label} url must not contain credentials`;
  return null;
}

/** Validation shared by every Outline authoring path for external iframe elements. */
export function iframeUrlIssue(value: string): string | null {
  return httpsEmbedUrlIssue(value, 'iframe');
}

/** Hosted PDFs use the same bounded asset paths as other document resources. */
export function pdfUrlIssue(value: string): string | null {
  if (/^\/api\/(?:assets\/[A-Za-z0-9_-]+|sessions\/[A-Za-z0-9_-]+\/assets\/[A-Za-z0-9_-]+)$/.test(value)) return null;
  return httpsEmbedUrlIssue(value, 'pdf');
}
