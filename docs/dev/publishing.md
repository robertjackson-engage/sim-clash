# Publishing: the repository, a release, the site

The sequence for putting the game on GitHub as a public fork of Open-Birdie, with a release
and a website. Written for **Windows PowerShell 5.1**: one command per line, no `&&`.

`OWNER` stands for your GitHub account name throughout. Every step that needs the GitHub
command line (`gh`) has the browser steps beside it, because `gh` may not be installed
(`gh --version` tells you; `winget install GitHub.cli` installs it, then `gh auth login`).

Nothing here is automatic. Each numbered step is something a person does on purpose.

## Where things stand (23 November 2026)

The game is built and checked by machine; nothing has been committed, pushed or published.
A finished installer, its SHA-256 and the release notes are in `release/` (git-ignored) for
trying on another PC. **Do not upload that file as the release**: the public release is
built again from a fresh clone of the published repository (step 5), so that what people
download is exactly what the repository builds.

### Only the owner can do these

In the order they block each other (`docs/dev/release-checklist.md` has the detail on each):

| | What | Blocks |
| --- | --- | --- |
| 1 | **Choose the name** and the app id (`docs/dev/rename.md`). "Sim Clash" is a working name | everything public: the repository name, the installer, every link |
| 2 | **Look at the installed game on this PC**, muted, when nobody is playing (`docs/dev/packaging.md`, "A first look at the real window"). Nobody has seen its window yet | step 5's install test being worth doing |
| 3 | **The live launch-monitor test of the Foresight bridge** (`docs/foresight-bridge.md`, "Tests and the live test") | saying "tested on a GCQuad" in public |
| 4 | **Confirm the redistribution terms** of the generated voice, the seven music stings and the image-to-3D models with the accounts they were made on (ElevenLabs, Meshy and the reseller) | the first push: once it is public it is public |
| 5 | **Decide on signing** (`docs/dev/signing.md`): unsigned is acceptable for a beta | the build in step 5 |
| 6 | **Your GitHub account**: steps 1 to 9 below | |
| 7 | **The second-PC test** (`docs/dev/install-test.md`) with the installer built in step 5 | publishing the release (step 7) |
| 8 | **Send the courtesy notes** (step 10) | the first public post |
| 9 | **Read, edit and approve every forum post** in `docs/dev/outreach/posts/` against `docs/launch-monitors.md`; decide whether `docs/dev/outreach/` is published at all | each post |

## 0. Before you start

- [ ] Rows 1 to 5 of "Only the owner can do these" above are done, and every item in
      `docs/dev/release-checklist.md` under "By hand".
- [ ] Nobody else is editing the tree.
- [ ] The name is decided. If it is no longer "Sim Clash", run the rename first
      (`docs/dev/rename.md`) and read `sim-clash` below as the new slug.

Work in the development clone:

```
cd C:\path\to\the\development\clone
git status
git branch --show-current
```

The branch should be `arcade`, with a long list of changes and nothing staged.

**Do not run `npm install` or `npm ci` in a clone whose `node_modules` is a link to another
checkout.** Check first:

```
(Get-Item .\node_modules).LinkType
```

If that prints `Junction` or `SymbolicLink`, installing here would rewrite the other
checkout's modules. Build the release from a fresh clone instead (step 5).

## 1. Fill in the account name

```
node tools/release/set-owner.cjs OWNER
git diff --stat
```

It changes `public/product.json`, `site/config.js` and the clone address in `README.md` and
`CONTRIBUTING.md`.

## 2. Commit

Run the tests first (in a clone whose `node_modules` is real or linked, either works):

```
node --test --test-timeout=180000 "test/*.test.js" "test/*.test.mjs"
```

It should end with `fail 0` (two upstream symlink tests are skipped on Windows).

Then commit as a small series, so the history says what arrived when. Look at
`git status` before each commit; if something is listed that you do not recognise, stop and
look at it.

The game:

```
git add lib public server.js main.js package.json package-lock.json tools test "Sim Clash.bat" Open-Birdie.bat .gitattributes
git commit -m "Add the arcade game: stages, match play, power-up balls, callouts, sound"
```

The documentation:

```
git add docs
git commit -m "Add the game's documentation, screenshots and concept art"
```

The website:

```
git add site .github/workflows/pages.yml
git commit -m "Add the website"
```

The product, packaging and project files:

```
git add README.md CHANGELOG.md CONTRIBUTING.md CREDITS.md NOTICE.md ASSETS.md LICENSE .gitignore .env.example build .github
git commit -m "Make it its own product: name, icon, installer, licence and credits"
```

Anything left:

```
git status
```

`git status` should now be clean. If files remain, read them, then `git add` and commit
them with a message that says what they are. One commit for everything is also fine:
`git add -A` and a single `git commit` gives the same result with less history.

Check what is about to become public:

```
git log --oneline -8
git diff --stat 5da3056 HEAD
git ls-files | Select-String -Pattern "\.scratch|^data/|\.env$"
```

The last command must print nothing. (`release/`, `dist/`, `build/arcade-data/` with the sky
photos, `data/` and `.scratch/` are git-ignored and never part of a commit.)

## 3. Create the fork

The game is based on `jordan-shilts/Open-Birdie` (which is itself a fork of
`rroojrooj/Open-Birdie`), so fork that one: the new repository then shows "forked from
jordan-shilts/Open-Birdie" and stays in the same fork network as the original.

With `gh`:

```
gh repo fork jordan-shilts/Open-Birdie --fork-name sim-clash --clone=false --default-branch-only
```

In the browser: open https://github.com/jordan-shilts/Open-Birdie, press **Fork**, set the
repository name to `sim-clash`, leave "Copy the `main` branch only" ticked, press **Create
fork**.

If GitHub says you already have a fork of Open-Birdie, an account can hold only one fork per
network: rename that existing fork to `sim-clash` (its Settings, General, Repository name)
and use it.

Good to know about forks: they are always public; **Issues are off until you turn them on**
(step 8); GitHub's code search does not index a fork until it has more stars than its
parent.

## 4. Point the clone at it and push

```
git remote rename origin upstream
git remote add origin https://github.com/OWNER/sim-clash.git
git remote -v
git push -u origin arcade:main
```

`arcade` sits directly on top of upstream's `main`, so this is an ordinary push with no
force. Git opens a browser window to sign in the first time.

Then make the local names match:

```
git branch -m main upstream-main
git branch -m arcade main
git branch -u origin/main main
git status
```

Open https://github.com/OWNER/sim-clash and read the README as a stranger would. Check
that the images load.

## 5. Build the release from a fresh clone

A fresh clone proves the repository is complete, and keeps the build away from any tree
that is still being edited.

```
cd C:\
git clone https://github.com/OWNER/sim-clash.git sim-clash-release
cd sim-clash-release
npm ci
npm test
npm run dist
```

`npm run dist` ends with `Package is sound.` If it says `NOT SOUND`, read why, fix it in the
development clone, push, pull here and build again. To sign, set the variables from
`docs/dev/signing.md` before `npm run dist`.

The build needs the internet once: besides Electron and the NSIS tools, it fetches the two
sky photos the stages are lit by from Poly Haven (33 MB, CC0) and stops if what arrives does
not match the checksums pinned in `tools/arcade-holes/sky-files.mjs`. To build without that
download, copy `build\arcade-data\sky` from the development clone into the same place in
the fresh clone first (the same checksums are checked).

The installer and its checksum:

```
Get-ChildItem .\dist\*.exe | Select-Object Name, Length
Get-FileHash .\dist\Sim-Clash-Setup-1.0.0-beta.1.exe -Algorithm SHA256
Get-AuthenticodeSignature .\dist\Sim-Clash-Setup-1.0.0-beta.1.exe | Select-Object Status
```

Now do the install test on a second PC: `docs/dev/install-test.md`. Do not publish a
release that nobody has installed.

## 6. Tag

In the fresh clone (it is exactly what was built):

```
git tag -a v1.0.0-beta.1 -m "Sim Clash 1.0.0-beta.1"
git push origin v1.0.0-beta.1
```

## 7. Publish the release

Paste the SHA-256 from step 5 into `docs/dev/release-notes-1.0.0-beta.1.md` where it says
so (edit a copy outside the repository if you do not want to commit it).

With `gh`:

```
gh release create v1.0.0-beta.1 ".\dist\Sim-Clash-Setup-1.0.0-beta.1.exe" --repo OWNER/sim-clash --title "Sim Clash 1.0.0-beta.1" --notes-file docs\dev\release-notes-1.0.0-beta.1.md --prerelease
```

In the browser: https://github.com/OWNER/sim-clash/releases/new. Choose the tag
`v1.0.0-beta.1`, title `Sim Clash 1.0.0-beta.1`, paste the release notes, drag the `.exe`
into the box at the bottom and wait for the upload to finish (about 160 MB), tick **Set as a
pre-release**, press **Publish release**.

Then download the installer from the release page in a browser and compare:

```
Get-FileHash "$env:USERPROFILE\Downloads\Sim-Clash-Setup-1.0.0-beta.1.exe" -Algorithm SHA256
```

GitHub's `/releases/latest` address skips pre-releases. The README links to the Releases
page, which shows them; the site's Download buttons use `downloadUrl` in `site/config.js`
when it is set and the latest-release address when it is not, so while the only release is
a pre-release, set `downloadUrl` to the installer's direct address (copy it from the
release page) or untick pre-release.

## 8. Repository settings

In the browser, at https://github.com/OWNER/sim-clash:

1. **Settings, General, Features**: tick **Issues**. (The launch-monitor report form needs
   it. Outreach posts tell people the form exists.)
2. The gear beside **About** on the front page: description "Arcade 1v1 golf for real launch
   monitors. Two players, one bay, real swings."; website: the Pages address from step 9;
   topics such as `golf`, `golf-simulator`, `launch-monitor`, `game`, `electron`, `threejs`.
3. **Settings, General, Social preview**: upload `site/assets/og.jpg`.
4. **Actions** tab: a fork has workflows switched off. Press **I understand my workflows, go
   ahead and enable them**.

With `gh`, the first two:

```
gh repo edit OWNER/sim-clash --enable-issues --description "Arcade 1v1 golf for real launch monitors. Two players, one bay, real swings." --add-topic golf --add-topic golf-simulator --add-topic launch-monitor --add-topic game
```

## 9. The website (GitHub Pages)

The site is the `site/` folder, published by `.github/workflows/pages.yml`.

1. **Settings, Pages, Build and deployment, Source**: choose **GitHub Actions**.
2. **Actions** tab, **Pages** workflow, **Run workflow** (or push any change under `site/`).
3. When it is green the site is at https://OWNER.github.io/sim-clash/. Open it, click every
   Download button (they should reach the release), and look at it on a phone.

With `gh`, step 2:

```
gh workflow run pages.yml --repo OWNER/sim-clash
```

## 10. Courtesy notes to the Open-Birdie authors

Two notes, one to each author, ideally a day or two before the first public post (and a
third, a thank-you, to the author of the bridge program the rig used before the game had
its own). The wording is drafted in `docs/dev/outreach/launch-plan.md` under "Courtesy
notes", with where to send each one (the original repository has issues enabled; the fork this is based on has
issues and discussions switched off, so that draft says how to reach its author). Read them
again, put the real repository address in, and send them yourself: they go out under your
name.

With `gh`, for the one that is an issue (save the note's text to a file first):

```
gh issue create --repo rroojrooj/Open-Birdie --title "Sim Clash: an arcade game built on Open-Birdie (a thank-you, and a heads-up)" --body-file C:\path\to\note.txt
```

Small, generic improvements can go upstream later as separate pull requests
(`docs/dev/upstream.md`). Do not open one that carries the game.

## 11. Afterwards

- As launch-monitor reports arrive, move the launch monitor's tier in
  `lib/launch-monitors.json` (with the report as its source) and regenerate what reads it:
  `node tools/arcade-dev/launch-monitors-doc.mjs --write`, `node tools/release/readme-monitors.cjs`,
  `node site/dev/refresh.mjs --data build/arcade-data`. Never edit the lists by hand.
- The forum posts (`docs/dev/outreach/`): one venue at a time, in the plan's order, each
  one read and sent by you.
- For the next release: bump `version` in `package.json` and `package-lock.json`, add a
  section to `CHANGELOG.md`, write release notes, then steps 2 (one commit), 4 (`git push`),
  5, 6, 7 again. Players' data survives an update: the installer replaces the app, and the
  game brings its stages up to date on the next start.
