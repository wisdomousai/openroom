/** Hosted Pixabay picture — credit lives on the photo, not as an authored caption. */
export function isPixabayUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'pixabay.com' || host.endsWith('.pixabay.com');
  } catch {
    return false;
  }
}

/** Required credit line, or null when this picture is not from Pixabay. */
export function pixabayCredit(media: { url?: string; caption?: string }): string | null {
  if (!isPixabayUrl(media.url)) return null;
  const caption = media.caption?.trim() ?? '';
  return caption === '' ? 'Pixabay' : caption;
}
