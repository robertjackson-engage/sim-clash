// The ONE place to set where this site's GitHub links point.
//
//   owner        the GitHub account or organisation that hosts the repository.
//                Replace OWNER below; nothing else in site/ needs to change.
//   repo         the repository name (the site is served from https://<owner>.github.io/<repo>/)
//   branch       the default branch, for links to files in the source tree
//   downloadUrl  a direct link to the Windows installer, for the Download buttons.
//                Leave it empty and they go to the repository's latest release page.
//   bridgeUrl    the project page of Open Connect Bridge, a separate helper program some
//                Foresight GC owners already use (the game no longer needs it: its own
//                bridge is built in; the Connect page only says how the two get along),
//                for example https://github.com/<account>/open-connect-bridge.
//                Empty: the program is named but not linked. Set it once you have checked
//                the address opens for someone who is not signed in.
//
// site.js reads this and fills every link marked data-gh="..." and every text marked data-fill="...".
window.SIMCLASH_SITE = {
  owner: 'robertjackson-engage',
  repo: 'sim-clash',
  branch: 'main',
  downloadUrl: '',
  bridgeUrl: '',
};
