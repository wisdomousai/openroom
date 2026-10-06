import { describe, expect, it } from 'vitest';
import { isYoutubeUrl, youtubeEmbedUrl, youtubeVideoId } from './youtube';

describe('youtubeVideoId', () => {
  it('parses watch, short, embed and youtu.be forms', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe('dQw4w9WgXcQ');
  });

  it('rejects non-YouTube and junk', () => {
    expect(youtubeVideoId('https://example.org/video.mp4')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
    expect(youtubeVideoId('')).toBeNull();
  });
});

describe('youtubeEmbedUrl', () => {
  it('builds a nocookie embed with controls defaults', () => {
    const url = youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(url).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(url).toContain('playsinline=1');
  });

  it('isYoutubeUrl matches the same cases', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYoutubeUrl('https://cdn.example/clip.mp4')).toBe(false);
  });
});
