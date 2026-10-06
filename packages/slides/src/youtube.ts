/**
 * YouTube URL helpers for media blocks.
 *
 * A video step stores the author's URL (watch, youtu.be, shorts, or embed).
 * Surfaces turn it into a privacy-friendly embed when it is YouTube; otherwise
 * they fall back to a plain `<video>` for direct MP4 (and similar) files.
 */

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * Extract a YouTube video id from a watch / share / embed / shorts URL.
 * Returns null when the address is not a known YouTube video URL.
 */
export function youtubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) return null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return validId(id);
  }

  const path = url.pathname;
  if (path.startsWith('/embed/') || path.startsWith('/shorts/') || path.startsWith('/live/')) {
    const id = path.split('/').filter(Boolean)[1];
    return validId(id);
  }
  if (path.startsWith('/v/')) {
    const id = path.split('/').filter(Boolean)[1];
    return validId(id);
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery) return validId(fromQuery);

  return null;
}

function validId(id: string | undefined): string | null {
  if (!id) return null;
  // Standard YouTube ids are 11 chars; allow a little slack for future forms.
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return null;
  // Starter placeholder written by the deck editor when a video block is first inserted.
  if (id === 'openroom-pending') return null;
  return id;
}

/** True when this media URL should render as a YouTube embed. */
export function isYoutubeUrl(raw: string | undefined): boolean {
  return typeof raw === 'string' && youtubeVideoId(raw) !== null;
}

/**
 * Canonical embed URL for a YouTube id.
 * Uses youtube-nocookie; controls are the player default.
 */
export function youtubeEmbedUrl(raw: string, options?: { autoplay?: boolean }): string | null {
  const id = youtubeVideoId(raw);
  if (id === null) return null;
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (options?.autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}
