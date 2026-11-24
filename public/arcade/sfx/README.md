# Arcade sound effects

Every sound effect the arcade layer plays, as short one-shot mp3 files. Nothing here loops.
The full story (sources, the mix, the sound map, how to swap a sound) is in
`docs/arcade-voice.md`.

- `manifest.json` says which files play for which cue. It is rebuilt from the files in this
  folder: `<cue>.mp3`, `<cue>-2.mp3`, `<cue>-3.mp3` are takes (one is picked at random,
  never the same twice running), `<cue>-hard.mp3` is a take for a hard hit.
- `CREDITS.md` lists every file with its source, URL and licence. Everything is CC0
  (Kenney packs, freesound.org recordings) or generated for this project. Nothing comes from
  another game, a film or a broadcast.
- Both are written by `node tools/arcade-voice/import.mjs`, which builds the files from the
  entries in `tools/arcade-voice/sources.mjs`. To swap a sound, change its entry there and
  run the importer again.

## Your own file for an old cue

The original twenty cues (`strike`, `bounce`, `splash`, `gasp`, `oooh`, `roar`,
`perfect`, `great`, `good`, `ok`, `miss`, `disaster`, `jackpot`, `rocket`, `armed`,
`coins`, `levelup`, `streak`, `slowmo-in`, `slowmo-out`) still take a hand-placed
`<cue>.mp3` dropped in this folder when the manifest has no file of that name for the cue.
Keep it short (under about 3 s) and trimmed to its attack: the game fires a cue on the exact
moment it wants heard.

## Levels

Levels, cooldowns, how many sounds may play at once and which crowd reaction wins are decided
in `public/arcade/audio.js`, not by the files: the announcer on top, then impacts, outcome
stings, game feel, the crowd, and the interface quietest. The files are levelled to targets
between -17 and -27 LUFS (`sources.mjs`).

The toggle in the power-up dock mutes everything in this layer
(`localStorage['open-birdie.arcade.muted']`), the announcer included.
