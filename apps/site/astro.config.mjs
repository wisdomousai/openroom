import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Canonical production origin — every absolute URL on the site (canonical,
// OG, sitemap, JSON-LD) derives from this one value.
export default defineConfig({
  site: 'https://openroom.app',
  // Legacy /about/ URL kept for bookmarks and external links.
  redirects: {
    '/about/': '/',
  },
  integrations: [
    // Astro owns `/` (marketing). Other surfaces are static apps the sitemap
    // integration cannot see on its own.
    sitemap({
      customPages: [
        'https://openroom.app/',
        'https://openroom.app/docs/',
        'https://openroom.app/host/',
        'https://join.openroom.app/',
      ],
    }),
  ],
  // Static output: no framework JS bundle, no web fonts, no external requests.
  // `/webmcp.js` is a small progressive-enhancement script for browser agents.
  // Umami Cloud is added by the control plane at request time.
  build: { format: 'directory' },
});
