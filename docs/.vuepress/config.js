module.exports = {
  title: "Jiaji's Blog",
  head: [
    ['link', {
      'rel': "apple-touch-icon",
      'sizes': "180x180",
      'href': "/apple-touch-icon.png"
    }],
    ['link', {
      'rel': "icon",
      'type': 'image/png',
      'sizes': "32x32",
      'href': "/favicon-32x32.png"
    }],
    ['link', {
      'rel': "icon",
      'type': 'image/png',
      'sizes': "16x16",
      'href': "/favicon-16x16.png"
    }],
    ['link', {
      'rel': "manifest",
      'href': '/site.webmanifest'
    }]
  ],
  markdown: {
    lineNumbers: true
  },
  theme: require.resolve('./theme'),
  themeConfig: {
    nav: [{
        text: 'Home',
        link: '/',
      },
      {
        text: 'Tags',
        link: '/tag/',
      },
    ],
    footer: {
      contact: [{
        type: 'github',
        link: 'https://github.com/jiaz',
      }],
    },
    modifyBlogPluginOptions(blogPluginOptions) {
      const sitemap = {
        hostname: 'https://jiajizhou.com'
      }

      const comment = {
        service: 'disqus',
        shortname: 'jiajizhou'
      }

      return {
        ...blogPluginOptions,
        comment,
        sitemap
      }
    }
  }
}
