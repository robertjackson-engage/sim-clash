# Following Open-Birdie

Sim Clash is a fork, two steps down:

```
rroojrooj/Open-Birdie        the original, by Rooj Rin (MIT)
  -> jordan-shilts/Open-Birdie   the actively developed fork (MIT)      <- "upstream" for this repo
       -> this repository         the game
```

This repository was forked from `jordan-shilts/Open-Birdie` at commit `5da3056` (Open-Birdie
0.9.2, November 2026). Everything the game adds sits on top of that commit.

## How the fork is kept mergeable

- **New files, not rewrites.** The game lives in `lib/arcade*.js`, `lib/match.js`,
  `lib/putt-assist.js`, `lib/voice.js`, `public/arcade/`, a few new files in
  `public/render/`, `tools/arcade-*`, `tools/release/` and `test/`.
- **Small marked edits in shared files.** Where an upstream file had to change
  (`server.js`, `main.js`, `public/app.js`, `public/index.html`, `lib/game.js`,
  `lib/physics.js`, `lib/practice.js`, some of `public/render/`), the edit is additive and
  carries a `// v2:<area>` comment. Search for `v2:` to see every one.
- **Upstream's names stay where a player never sees them**: the npm package name
  (`open-birdie`), the `BIRDIE_*` environment variables, the `open-birdie.*` storage keys,
  the `build` block of `package.json`. The product's own name comes from
  `public/product.json` and `build/electron-builder.cjs`.
- **Files that will conflict, on purpose**: `README.md` (rewritten for the game) and the top
  of `CHANGELOG.md`. Keep ours.

## Pulling upstream changes

One-time setup in a clone of this repository:

```
git remote add upstream https://github.com/jordan-shilts/Open-Birdie.git
```

Then, whenever you want their newer work:

```
git fetch upstream
git checkout -b merge-upstream
git merge upstream/main
```

Expect conflicts in `README.md` and `CHANGELOG.md`: keep this repository's version of the
README (`git checkout --ours README.md`), and in the changelog keep our section at the top
and take theirs below the line. Anything else that conflicts is a `v2:` edit meeting an
upstream change in the same place: read both, keep both.

Then:

```
npm install
npm test
npm run arcade:holes
npm start
```

Play a hole before merging to `main`. Upstream moves fast in the renderer; the arcade look
hooks into it (`docs/arcade-look.md` lists where).

## Offering changes back

Things in this fork that are useful to a golf simulator, not only to the game, should go
upstream as small, self-contained pull requests against `jordan-shilts/Open-Birdie`: one
change each, with its test, with no arcade code attached. Candidates are listed in
`docs/dev/outreach/`. Do not open a pull request that carries the whole game: it is a
different product, and that is a decision for the upstream authors, not for us.

Be a good guest: the upstream authors did not ask for this fork. Bugs in Sim Clash are
reported here, never to them.
