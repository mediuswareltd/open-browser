import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "OpenBrowser",
  description: "Describe a goal in plain language; OpenBrowser plans and executes steps in a real Chromium browser with optional AI planners.",
  base: '/open-browser/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.png' }],
  ],
  themeConfig: {
    logo: { light: '/logo.png', dark: '/logo.png', alt: "OpenBrowser" },
    siteTitle: "OpenBrowser",
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide' },
      { text: 'Getting started', link: '/getting-started' },
      {
        text: 'GitHub',
        link: 'https://github.com/mediuswareltd/open-browser'
      }
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Guide', link: '/guide' },
          { text: 'About', link: '/about' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mediuswareltd/open-browser' }
    ],
    footer: {
      message: 'Built by Mediusware',
      copyright: 'Copyright © Mediusware Ltd'
    },
    editLink: {
      pattern: 'https://github.com/mediuswareltd/open-browser/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    search: {
      provider: 'local'
    },
    outline: [2, 3]
  }
,
  vite: {
    css: {
      postcss: {
        plugins: []
      }
    }
  }
})
