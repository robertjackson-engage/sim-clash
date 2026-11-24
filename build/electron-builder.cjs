'use strict';
// electron-builder configuration for the game product (npm run pack / npm run dist).
//
// It starts from the `build` block of package.json, which stays as upstream Open-Birdie
// wrote it (so upstream changes merge cleanly), and changes what makes this a different
// product: its name and ids (public/product.json, the one place the name lives), its icon,
// and its contents: the arcade stages are bundled, and nothing that only the real-course
// simulator needs is shipped (course-art packs, their smoke tool, demo pages, docs).
// See docs/dev/packaging.md.
const path = require('path');
const pkg = require('../package.json');
const product = require('../lib/product.js');

const base = pkg.build || {};
const drop = new Set(['tools/course-art/packaged-smoke.cjs']);

// ---- Code signing (docs/dev/signing.md). Nothing here holds a secret: signing happens
// when the credentials are in the environment and is skipped cleanly when they are not.
//
//   1. Azure Artifact Signing (formerly Trusted Signing): AZURE_SIGN_ENDPOINT,
//      AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE and AZURE_SIGN_PUBLISHER name the account;
//      electron-builder authenticates with AZURE_TENANT_ID, AZURE_CLIENT_ID and
//      AZURE_CLIENT_SECRET.
//   2. A certificate in the Windows certificate store (a hardware token, a cloud key
//      provider's KSP): WIN_SIGN_SHA1 (thumbprint) or WIN_SIGN_SUBJECT (subject name).
//   3. A .pfx / .p12 file: CSC_LINK (or WIN_CSC_LINK) and CSC_KEY_PASSWORD, which
//      electron-builder reads by itself.
//   SIGN_REQUIRED=1 fails the build when nothing signs (use it for release builds).
const env = process.env;
const icon = path.join('build', 'product.ico');
let signing = {};
let signedBy = env.CSC_LINK || env.WIN_CSC_LINK ? 'a certificate file (CSC_LINK)' : null;
if (env.AZURE_SIGN_ENDPOINT && env.AZURE_SIGN_ACCOUNT && env.AZURE_SIGN_PROFILE && env.AZURE_SIGN_PUBLISHER) {
  signing = { azureSignOptions: { publisherName: env.AZURE_SIGN_PUBLISHER, endpoint: env.AZURE_SIGN_ENDPOINT, codeSigningAccountName: env.AZURE_SIGN_ACCOUNT, certificateProfileName: env.AZURE_SIGN_PROFILE } };
  signedBy = `Azure Artifact Signing (${env.AZURE_SIGN_ACCOUNT} / ${env.AZURE_SIGN_PROFILE})`;
} else if (env.WIN_SIGN_SHA1 || env.WIN_SIGN_SUBJECT) {
  signing = { signtoolOptions: { ...(env.WIN_SIGN_SHA1 ? { certificateSha1: env.WIN_SIGN_SHA1 } : { certificateSubjectName: env.WIN_SIGN_SUBJECT }), signingHashAlgorithms: ['sha256'] } };
  signedBy = 'a certificate in the Windows certificate store';
}
console.log(signedBy ? `  • code signing    ${signedBy}` : '  • code signing    none: no credentials in the environment, the build will be UNSIGNED (docs/dev/signing.md)');

module.exports = {
  ...base,
  appId: product.appId,
  productName: product.name,
  copyright: `Copyright (c) 2026 Rooj Rin (Open-Birdie) and the ${product.name} contributors. MIT licence.`,
  // no native modules in the runtime dependencies (three, pngjs, 3d-tiles-renderer are plain
  // JavaScript): skip the rebuild step, which would otherwise run npm inside node_modules
  npmRebuild: false,
  // no auto-update: without this electron-builder writes an app-update.yml that names the
  // repository of the git remote it finds (upstream's, in a fresh fork)
  publish: null,
  ...(env.SIGN_REQUIRED === '1' ? { forceCodeSigning: true } : {}),
  // The packaged package.json. `name` matters: a one-click per-user NSIS install goes to
  // %LOCALAPPDATA%\Programs\<name>, and the repo keeps upstream's package name (open-birdie)
  // so upstream merges cleanly. Without this the game would install INTO the folder of an
  // Open-Birdie install. `productName` is what Electron names the user-data folder after.
  extraMetadata: { name: product.slug, productName: product.name, description: `${product.name}: ${product.tagline}` },
  files: [
    ...(base.files || []).filter((f) => !drop.has(f)),
    '!public/arcade/demo.html',
    '!public/arcade/*-demo.html',
    '!public/_hudmock.html',
    '!public/_bg.jpg',
    '!**/*.map',
    '!.scratch',
    '!site',
  ],
  extraResources: [
    // the arcade stage courses and the tour (npm run prepare:arcade-data); lib/arcade-bundle.js
    // installs them into the player's data dir on boot. The real-course art packs of the
    // simulator (build/course-art) are not shipped: the game has no real courses.
    { from: 'build/arcade-data', to: 'arcade-data', filter: ['**/*'] },
  ],
  // beside the .exe: the licence (with both copyright lines) and where everything came from
  extraFiles: [
    { from: 'LICENSE', to: 'LICENSE.txt' },
    { from: 'NOTICE.md', to: 'NOTICE.md' },
    { from: 'CREDITS.md', to: 'CREDITS.md' },
    { from: 'public/arcade/sfx/CREDITS.md', to: 'SOUND-CREDITS.md' },
  ],
  win: { ...(base.win || {}), target: 'nsis', icon, ...signing },
  // The installer: one .exe, one click, for the current Windows user (no administrator
  // prompt), desktop and Start-menu shortcuts named for the game, the game started when it
  // finishes. Inherited from upstream's block; said again here because the game depends on it.
  nsis: {
    ...(base.nsis || {}),
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    installerIcon: icon,
    uninstallerIcon: icon,
    installerHeaderIcon: icon,   // above the progress bar of the one-click window
    // uninstalling leaves the player's data (%APPDATA%\<product>: players, coins, settings,
    // the log); README says where it is for anyone who wants it gone
    deleteAppDataOnUninstall: false,
    // removes the 150 MB copy of the installer that electron-builder keeps for an auto-updater
    // this app does not have
    include: path.join('build', 'installer.nsh'),
    shortcutName: product.name,
    uninstallDisplayName: product.name,
    artifactName: `${product.installerName}-\${version}.\${ext}`,
  },
};
