// The ONE place to set where this site's links point.
//
//   owner        the GitHub account or organisation that hosts the repository.
//                Nothing else in site/ needs to change when it does.
//   repo         the repository name (the site is served from https://<owner>.github.io/<repo>/)
//   branch       the default branch, for links to files in the source tree
//   downloadUrl  a direct link to the Windows installer, for the Download buttons.
//                Leave it empty and they go to the repository's latest release page.
//                When it is set, every Download button is a plain link to it (it works with
//                scripts off) and a click also opens the "Your download has started" panel.
//   downloadSize optional. The installer's size as the panel shows it ("about 160 MB").
//   youtubeUrl   optional. A YouTube address for the trailer (a watch, share or embed link).
//                Empty: "Watch the trailer" plays the site's own file, assets/video/trailer.mp4.
//                Set: the same button plays the YouTube video in the lightbox instead (the
//                player is only requested when a visitor presses the button).
//   release      the version the site describes, as shown on the What's new page.
//
// site.js reads this in the browser and fills every link marked data-gh="..." and every text
// marked data-fill="...". dev/refresh.mjs reads it too, for the things a link preview or a
// search engine needs as plain HTML: the absolute addresses in each page's <head>, sitemap.xml
// and the address of every Download button.
// After changing owner, repo, release or downloadUrl, run:  node site/dev/refresh.mjs
window.SIMCLASH_SITE = {
  owner: 'robertjackson-engage',
  repo: 'sim-clash',
  branch: 'main',
  // The site's own domain name. '' means the GitHub Pages address (<owner>.github.io/<repo>).
  // It is used for the absolute addresses in each page's <head> and in sitemap.xml; the
  // domain itself is set in the repository's Pages settings, not here.
  domain: 'simclashgolf.com',
  downloadUrl: 'https://github.com/robertjackson-engage/sim-clash/releases/latest/download/Sim-Clash-Setup.exe',
  downloadSize: 'about 165 MB',
  youtubeUrl: '',
  release: '1.0.0-beta.2',
  // Visit counting, off while this is ''. Set it to a GoatCounter site code (the "simclash" in
  // simclash.goatcounter.com) to count page views, where visitors came from and clicks on
  // Download and the trailer. No cookies, nothing stored in the browser, no personal data.
  analytics: 'simclash',
};
