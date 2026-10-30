import { defineConfig } from 'vitepress';

import navigation from '../nav.json' with { type: 'json' };

export default defineConfig({
  title: 'Auto Runtime',
  description: 'Contributor-owned documentation for Auto Runtime.',
  base: '/docs/',
  cleanUrls: true,
  srcExclude: ['engineering/**'],
  lastUpdated: true,
  head: [['meta', { name: 'robots', content: 'noindex' }]],
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/get-started/cloud' },
      { text: 'Runtime docs', link: '/' },
      { text: 'Auto', link: 'https://on.auto/' },
    ],
    sidebar: [{ text: 'Introduction', link: '/' }, ...navigation],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/BeOnAuto/runtime/edit/main/docs/:path',
      text: 'Edit this page in BeOnAuto/runtime',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/BeOnAuto/runtime' }],
    footer: { message: 'Runtime documentation preview. Published with Auto at on.auto/docs.' },
  },
});
