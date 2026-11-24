# Arcade voice and sound: the announcer, the effects, the mix

The arcade layer has an announcer ("NICE SHOT!", "SLIIICE HOUSE!", "PLAYER ONE WINS!"), real
one-shot sound effects for everything a player touches or a ball does, and a crowd that rises
as a ball tracks at the hole and pays off on the frame it drops. All of it ships as mp3 files
in `public/arcade/`; the game itself calls no outside service (except, with a working
ElevenLabs key, to speak a player's name once).

Nothing here loops and nothing is continuous: every sound is a short one-shot with a faded
tail. Nothing is taken from a commercial game, a film, a broadcast or a
video: every file is CC0-licensed, or generated for this project.

**State on 2026-11-23**

| | Shipped | Source |
| --- | --- | --- |
| Announcer pack `announcer` | 104 of 104 lines, 214 takes, 4.1 MB | generated in a Higgsfield account (ElevenLabs v4, preset voice "Grady") |
| Sound effects | 66 cues, 94 files, 2.2 MB | Kenney CC0 packs, freesound.org CC0 recordings, 7 generated stings and jingles |
| Player names | none | needs a working ElevenLabs key (see "Player names") |

Nobody has listened to any of it: it was all chosen and checked by measurement
(`check.mjs`). "Listen first" at the end of this file says where a human ear matters most.

## Files

| Path | What |
| --- | --- |
| `public/arcade/audio.js` | `ArcadeAudio`: `cue()`, `say()`, `moment()`, `anticipate()` / `resolve()`, the mix |
| `public/arcade/voice/queue.js` | the say() queue (no Web Audio in it: tested under Node) |
| `public/arcade/voice/anticipation.js` | the arithmetic of the crowd swell and its payoff (tested under Node) |
| `public/arcade/voice/<pack>/<id>-<n>.mp3` + `manifest.json` | an announcer pack |
| `public/arcade/sfx/*.mp3` + `manifest.json` + `CREDITS.md` | the effects, what plays for which cue, where each file came from |
| `tools/arcade-voice/lines.mjs` | the announcer catalogue: every line id, its text, its takes |
| `tools/arcade-voice/sources.mjs` | every effect file: which free or generated source, how it is cut and layered |
| `tools/arcade-voice/import.mjs` | builds the effects from those sources, writes the manifest and `CREDITS.md` |
| `tools/arcade-voice/import-voice.mjs` | builds an announcer pack from renders made in a Higgsfield account |
| `tools/arcade-voice/generate.mjs` | the ElevenLabs API generator (announcer and effects): idle until there is a key |
| `tools/arcade-voice/check.mjs` | machine check of everything shipped |
| `tools/arcade-voice/dsp.mjs`, `manifest.mjs`, `eleven.mjs` | audio processing in Node, the manifest scanner, the ElevenLabs client |
| `lib/voice.js` | player-name clips: `POST /api/voice/name`, `GET /api/voice/names`, `/voice/names/<slug>.mp3` |
| `test/arcade-voice.test.js` | 37 tests: catalogue, files on disk, sources and credits, name API, queue, mix, swell |

One-time setup for the tools (no ffmpeg is needed: the tools decode and encode in Node with
three dev-only packages that live in the tool folder and are not shipped with the app):

```
cd tools/arcade-voice
npm install --ignore-scripts
cd ../..
```

## Sources

Three kinds, all free to ship inside a game. `public/arcade/sfx/CREDITS.md` lists every
shipped file with its source, URL, licence and original file name.

| Source | Licence | Used for |
| --- | --- | --- |
| **Kenney** audio packs (kenney.nl): Interface Sounds, UI Audio, Impact Sounds, Casino Audio, Digital Audio, RPG Audio | CC0 1.0 | every interface sound, the ground and wood and metal impacts, coins, chest, power-up arming |
| **freesound.org**, only sounds whose own page says "Creative Commons 0" | CC0 1.0 | the crowd (a recorded crowd session), the golf strikes, the cup, the coin, water, whooshes, impacts, timpani, rocket, heartbeat |
| **Generated in a Higgsfield account** | generated, no third-party audio | the announcer (ElevenLabs v4), and seven musical stings (ElevenLabs Music v2.5): stage sting, tee-off, knockout, both fanfares, level-up, turn chime |

Rules that were applied and must keep being applied: audio and archives of audio only;
CC0 unless a licence clearly allows redistribution inside a game; a sound whose description
says it was lifted from a broadcast or a video is not used whatever its tag says (two golf
recordings were dropped for that reason); nothing from any commercial game.

The source audio is not in the repo. It sits in `.scratch/voice/downloads/`:

```
kenney/<pack>/Audio/<file>.ogg      unzipped from the pack's page on kenney.nl (Download button)
freesound/<id>/<id>.ogg             the sound's high-quality preview: https://cdn.freesound.org/previews/<id / 1000>/<id>_<user id>-hq.ogg
higgsfield/music/<name>.mp3         the generated stings (they are also in the Higgsfield library)
higgsfield/announcer/<job>.mp3      the announcer renders
```

If that folder is lost, the shipped mp3s still work; only re-cutting needs the sources, and
`sources.mjs` and `CREDITS.md` name each one exactly.

## Swap or re-cut a sound effect

1. Find the file's entry in `tools/arcade-voice/sources.mjs`. An entry is the output file, its
   loudness target and length, and one or more layers (a source, the seconds to take from it,
   when it starts, its level, a playback rate).
2. Change the source or the cut. To add a take, add `<cue>-2.mp3`. To add a take that plays
   only on a hard hit (cue intensity 0.78 and up), name it `<cue>-hard.mp3`.
3. `node tools/arcade-voice/import.mjs --only <cue>` rebuilds it, the manifest and
   `CREDITS.md`. Without `--only` it rebuilds everything.
4. `node tools/arcade-voice/check.mjs --sfx`, then listen.

To use a file of your own for one of the original twenty synthesized cues, drop
`<cue>.mp3` into `public/arcade/sfx/` as before; it wins for that cue. To add a stage's own
reveal sting, add `stage-sting-<theme>.mp3` (the game asks for it and falls back to
`stage-sting.mp3`).

What each effect goes through: decode, cut, layers levelled alike and mixed, leading silence
removed, tail faded, loudness brought to its target (ITU-R BS.1770) under a look-ahead peak
limiter, encoded to mp3 (mono 96 or stereo 128 kbit/s).

## The announcer

`tools/arcade-voice/lines.mjs` holds 104 lines: 30 shot callouts, 41 match lines, 15 stage
names, 18 ball names. Each has two or three takes: a delivery tag in brackets and the words,
`'[shouting, grinning, mocking] SLIIICE HOUSE!'`. Capitals are emphasis, a stretched vowel is
a stretched shout, more `!` is more volume.

The shipped pack was rendered in the user's Higgsfield account (model "Eleven v4", preset
voice "Grady", chosen by measurement from eight auditioned male presets: the fullest and
loudest shout). Higgsfield is reached through its connector, not an API key, so a re-render
there is done by an assistant session, not by a script:

1. Submit each take as an `elevenlabs_v4` job (`dialogue: [{ text, voice_type: 'preset', voice_id }]`).
   Plain shouted takes can share a job, each ending with ` [long pause]`; takes with a laugh
   or a staccato delivery get a job each.
2. Save each result as `.scratch/voice/downloads/higgsfield/announcer/<job index>.mp3` and
   write a plan `{ voice, voiceName, jobs: [{ index, turns: [{ id, n, text }] }] }`.
3. `node tools/arcade-voice/import-voice.mjs --plan <plan.json> --from .scratch/voice/downloads/higgsfield/announcer`
   splits each job at its long pauses (a job that does not divide into exactly its takes, or
   whose pieces do not look like their lines, is refused and must be rendered again one take
   to a job), then trims, fades, levels to -15 LUFS and encodes each take and writes the
   pack's manifest.

Announcer clips: mono 44.1 kHz, 96 kbit/s, -15 LUFS, peaks at -2 dBFS. The effects are
levelled 4 to 12 LU below that and dip another 4 dB while the announcer speaks.

### With an ElevenLabs key again

`generate.mjs` renders the same catalogue straight from the ElevenLabs API, and is the easier
way to re-voice or add lines once a key exists. The key is read at run time: environment
`ELEVENLABS_API_KEY`, else that line of the env file named by `BIRDIE_VOICE_ENV`, else the
same line in a git-ignored `.env` in the repo root (`.env.example` shows it). With a key in
place:

```
node tools/arcade-voice/generate.mjs --probe
node tools/arcade-voice/generate.mjs voice --force
node tools/arcade-voice/check.mjs
```

- `--probe` shows the plan, the credits left and whether the pack's voice is on the account.
  The packs in `lines.mjs` (`announcer`: Olumide, `arena`: Atlas) are ElevenLabs voices of
  that account; `--force` re-renders the whole pack in that one voice (a pack is never
  rendered in two voices: the tool refuses without `--force`).
- It is idempotent (a file that exists is skipped), takes `--only id,id`, `--pack <name>`,
  `--dry-run`, `--reprocess`, `--reject id-n`, and re-renders takes whose length is not sane.
- `generate.mjs sfx` can also generate the effects in `lines.mjs` with the ElevenLabs
  sound-effects API. It skips files that exist, so it only fills gaps unless `--force`.
- One pack is about 9,500 characters before retries; the effects about 100 s of audio.
- The key is sent only in the `xi-api-key` header to `api.elevenlabs.io`, never printed or
  written. Requests carry the line text and voice settings only.

Add a line: add it to `LINES` in `lines.mjs` with two or three takes, render it (either way
above), run the check and the tests. If the id is new to the game's contract, add it to the
explicit id lists in `test/arcade-voice.test.js`.

Switch pack by ear: `http://localhost:8222/?voice=<pack>`. A pack that does not exist falls
back to `announcer`.

## In the game: `ArcadeAudio`

```js
audio.cue('strike', { intensity: 0.9 });                     // any one-shot
audio.say('slice-house');                                    // the announcer
audio.say([{ name: 'Alex', fallback: 'm-player-1' }, 'm-for-the-win'], { priority: 2 });
audio.moment({ impact: 'sand-thud', crowd: 'crowd-aww', say: 'beach' });   // one outcome, one stack
const h = audio.anticipate({ seconds: 2.4 });                // the gallery rising ...
audio.resolve('in');                                         // ... and the payoff, on the frame
audio.stopVoice();
```

Everything is a silent no-op, and never throws, when audio is locked (no click yet), muted
(`setEnabled(false)` also stops the voice, the swell and whatever is sounding), or a file is
missing. On the first click the two manifests are fetched; the effects are decoded in the
background and about twenty likely announcer lines with them; any other line is fetched the
first time it is needed (a few milliseconds from the local server).

### `say(line, { priority = 1, gapMs = 120, maxWaitMs = 6000 })`

- Sentences queue and play one after another, never overlapping. A higher `priority` than
  everything playing and waiting clears the queue and cuts in (a 40 ms fade). Equal or lower
  waits its turn. Convention: 1 shot callouts, 2 match flow, 3 knockouts and winners.
- A random take each time, never the same one twice running.
- A sentence that has not started within `maxWaitMs` is dropped: late is worse than silent.
- `{ name, fallback }` speaks the player's name if a clip of it exists, else the fallback line.

### The mix (enforced by `cue()`; the tables are `MIX`, `COOLDOWN`, `EXCLUSIVE` in `audio.js`)

Callers say what happened. The mix is decided in one place.

| Level | Category | Cues | Bus gain | At once | Varied per take |
| --- | --- | --- | --- | --- | --- |
| 1 | announcer | every `say()` line | own bus, past the compressor | 1 (queued) | random take |
| 2 | `impact` | `strike` `bounce` `splash` `cup-drop` `flag-clank` `green-thump` `fairway-bounce` `sand-thud` `tree-knock` `water-plunk` `lava-sizzle` `ice-skid` `rough-rustle` | 1.0 | 5 | pitch ±5 %, level ±12 % |
| 3 | `sting` | `perfect` `great` `good` `ok` `miss` `disaster` `jackpot` `fanfare-win` `fanfare-hole` `sting-fail` `sting-knockout` `start-match` `vs-slam` `coin-land` `stage-sting` | 0.85 | one at a time | none (they are music) |
| 4 | `feel` | `rocket` `armed` `arm-common` `arm-rare` `arm-epic` `coins` `coin-burst` `chest-open` `levelup` `streak` `streak-up` `streak-break` `confetti-pop` `riser` `heartbeat-hit` `whoosh` `lobby-open` `coin-flip` `tee-off` `drumroll` `trick-cast` `slowmo-in` `slowmo-out` | 0.8 | 4 | pitch ±1.5 %, level ±5 % |
| 5 | `crowd` | `crowd-roar` `crowd-cheer` `crowd-ohh` `crowd-aww` `crowd-gasp` `crowd-laugh` `applause` `roar` `oooh` `gasp` `crowd-rise-1s` .. `-4s` | 0.75 | one reaction at a time | pitch ±2 %, level ±6 % |
| 6 | `ui` | `ui-tick` `ui-confirm` `ui-back` `ui-error` `select-player` `select-format` `select-stage` `toggle-on` `toggle-off` `drawer-open` `drawer-close` `turn-chime` `trophy-tick` `countdown-beep` | 0.6 | 3 | none, except `ui-tick` (pitch ±6 %: a run of them rolls) |

- **Ducking.** Every effect category dips about 4 dB while the announcer speaks.
- **Cooldowns.** A cue fired again inside its cooldown is dropped, so nothing machine-guns:
  30 to 80 ms by default (a fast selector run still ticks), longer where a repeat would be
  silly (`cup-drop` 0.8 s, `riser` 2.4 s, `start-match` 1 s, `strike` 0.12 s).
- **Voice limit.** The "At once" column per category, 12 in all; past that only an impact plays.
- **One crowd reaction, one outcome sting.** Inside 1.2 s (crowd) or 0.6 s (sting) a higher
  rank replaces what is sounding (it fades in 120 ms); the same rank or lower is dropped. A
  roar takes over from a gasp; an aww never talks over a roar; the VS slam takes over from the
  tail of START; `roar` and `crowd-roar` fired together are one roar.
- **Hard takes.** A cue fired at intensity 0.78 or more plays its `-hard` takes when it has
  them: `strike` (drivers), `countdown-beep` (the last beep, a fifth up).
- A cue with no file falls back to its synthesizer (every physical, interface and game-feel
  cue has one, some borrowed). Nothing is silent today; `check.mjs` fails if a cue with no
  synthesizer ever loses its file.

### One moment: `moment({ impact, sting, crowd, say, intensity, grade, priority })`

One shot outcome as one stack: at most one of each, started in the order that lets each be
heard. The slot decides WHEN a cue starts; the cue's own category decides how it is mixed.

| Part | Starts |
| --- | --- |
| `impact` | now |
| `sting` | +80 ms |
| `crowd` | +180 ms (an array is cut to its first entry) |
| `say` | +560 ms with a crowd, +320 ms with only a sting, +120 ms with only an impact, at once alone |

With `grade: 'OK'` only the impact plays: an ordinary shot gets the physical sounds and
nothing else. Silence is what makes the roar land. Two moments close together do not pile up:
the crowd and sting rules keep one of each and the lines queue.

## Anticipation and payoff

The most important sound moment in the game. As a putt or a great shot tracks at the hole and
time slows, the gallery rises: a held, climbing "aaaaAAAHHH" that peaks on the exact frame
the outcome is known. Then the payoff replaces it.

```js
const h = audio.anticipate({ seconds, intensity });   // peak lands `seconds` from now
audio.resolve('in' | 'out' | 'close', { intensity }); // on the frame of the outcome
```

- **The swell** is the build-up half of recorded crowd reactions ("excitement builds, then
  lets down"), in four lengths with two takes each: `crowd-rise-1s` (1.2 s), `-2s` (2 s),
  `-3s` (3 s), `-4s` (4.5 s), a soft timpani crescendo under each. Each file climbs to its
  peak (the manifest's `peakS`) and keeps 0.4 s more that is only heard, fading, if nobody
  resolves.
- **Fitting the window** (`planSwell` in `anticipation.js`): the longest swell that fits is
  started late so its peak lands at the end of the window; when even the shortest is too long
  it enters part-way up its rise. It is never stretched. Checked for windows of 0.8, 1.5, 2.5
  and 4 s (and 9 s): the peak lands on the moment to the microsecond in the test.
- **While it rises it is the only crowd sound**: a crowd cue that is sounding fades out and no
  other may start. One swell at a time; a new one cuts the old.
- **`resolve`** cuts the swell with a 60 ms fade on that frame and fires the payoff, which
  outranks everything in the crowd:

| Outcome | Payoff | Then |
| --- | --- | --- |
| `'in'` (it drops) | `cup-drop` and `crowd-roar`, the biggest sound in the game | no other crowd cue for 3.5 s |
| `'out'` (lip-out, burned edge) | `crowd-ohh`, the collective groan, at once | no other crowd cue for 3 s |
| `'close'` (finishes close, was never going in) | `applause` | no other crowd cue for 2.5 s |

  That hold is what stops the double: the HUD's own crowd reaction with its callout banner
  (`crowd-roar` on an epic callout, `crowd-ohh` on `robbed` / `so-close`) arrives a moment
  later and is dropped. If the HUD's roar arrived a hair early instead, the payoff takes over
  from it. `resolve` works without a swell having played.
- **Scheduling** (`planAnticipation`, run by `scheduleSlowmoAudio` in `public/app.js`): from
  the re-timed shot of `feel.js`, in playback seconds.

| The shot | Swell | Payoff |
| --- | --- | --- |
| a `holing` slow-motion window and `sim.cupDropT` | from the start of the window, peaking at `cupDropT` | `resolve('in')` at `cupDropT` |
| it flies or pitches straight in (under 0.3 s of window) | none | `resolve('in')` at `cupDropT` |
| a `lip` window (it passes the cup) | from the start of the window, peaking as the ball reaches the cup (61 % through) | `resolve('out')` 0.1 s after |
| no window, but it stops within 2.5 ft after travelling 3 m or more | a short one over the last 1.3 s | `resolve('close')` as it stops |
| anything else | none | none |

This is one shaped one-shot per shot, not a loop.

## Sound map: what plays when, and who triggers it

### The match setup flow (match-ui: `public/arcade/match.js`, edits marked `// v2:voice`)

Every touch is one sound: a pick never stacks a tick and a confirm.

| Beat | Cue | File(s) | Made from |
| --- | --- | --- | --- |
| The match screen arrives | `lobby-open` | `lobby-open.mp3` | a real swish (plastic rod) landing in a recorded cinematic impact |
| Pointer or focus moves onto a control | `ui-tick` | `ui-tick.mp3` | Kenney Interface "select", pitched a little differently each time |
| Pick a player | `select-player` | `select-player.mp3` | Kenney UI Audio, a recorded switch |
| Pick a format | `select-format` | `select-format.mp3` | a second recorded switch, lower |
| Pick a stage | `select-stage` | `select-stage.mp3` | the lowest switch, with a low thud under it |
| An option on / off | `toggle-on` / `toggle-off` | `toggle-on.mp3` / `toggle-off.mp3` | one Kenney toggle, pitched up for on and down for off |
| Options drawer opens / closes | `drawer-open` / `drawer-close` | `drawer-open.mp3` / `drawer-close.mp3` | Kenney rising / falling sweep with a little air |
| Back, close | `ui-back` | `ui-back.mp3` | Kenney Interface "back" |
| START that cannot start | `ui-error` | `ui-error.mp3` | Kenney Interface "error": a soft low buzz |
| START | `start-match` | `start-match.mp3` | a bright confirm and a recorded punch, then a rise cut at its peak |
| The VS panels meet (0.52 s in) | `vs-slam` with `m-versus` | `vs-slam.mp3`, `vs-slam-2.mp3` | a recorded cinematic impact with a heavy metal hit on top |
| The coin leaves the thumb (1.75 s) | `coin-flip` | `coin-flip.mp3` | a real coin: the flick, then the ring of it spinning |
| The coin lands (3.2 s) | `coin-land` | `coin-land.mp3` | a chip slapped down, a real coin settling on a table, a short bright sting |
| The stage name slams in (0.7 s into the stage intro) | `stage-sting-<theme>`, else `stage-sting` | `stage-sting.mp3` | a generated orchestral hit |
| The intro doors open, play begins | `tee-off` | `tee-off.mp3` | a generated brass stab |
| Screen wipes | `whoosh` | `whoosh.mp3`, `-2`, `-3` | three different recorded swishes |
| Countdown | `countdown-beep` | `countdown-beep.mp3`, `-hard` | a Kenney tone; a fifth up at intensity 1 for the last one |

### Shots (arcade-hud: `public/arcade/arcade.js`; slow motion and the swell: `public/app.js`)

| Game event | Cue(s) | Announcer |
| --- | --- | --- |
| Club meets ball | `strike` (intensity from ball speed: 0.78 and up plays the driver takes) | |
| A rocket-type ball leaves the face | `rocket` | `blast-off` |
| First landing on fairway / green / rough / bunker | `fairway-bounce` / `green-thump` / `rough-rustle` / `sand-thud` | |
| Later bounces | `bounce` (throttled, quieter each time) | |
| Ball hits a tree | `tree-knock` | `timber` when it is the callout |
| Ball into water / lava / onto ice | `water-plunk` (or `splash`) / `lava-sizzle` / `ice-skid` | `splash`, `lava` |
| Ball hits the pin | `flag-clank` | |
| Ball tracking at the hole | `anticipate()` then `resolve()` (see above); nothing else from the crowd | |
| Ball drops | `resolve('in')`: `cup-drop` + `crowd-roar`; the HUD adds sting `jackpot` or `perfect` | the callout (`hole-in-one`, `holed-out`, `chip-in`, `drained`, `in-the-hole`) |
| Epic / good / bad / funny callout (not at the hole) | moment: sting `perfect` / `great` or `good` / `miss` or `disaster` / `sting-fail`; crowd `crowd-roar` / `crowd-cheer` or `applause` / `crowd-aww` / `crowd-laugh` | the callout line |
| Ordinary shot (grade OK, no callout) | nothing more | |
| Streak grows / breaks | `streak-up` / `streak-break` | `on-fire` at 3, `unstoppable` at 5 |
| Coins, counters, level, chest | `coin-burst`, `trophy-tick` per step, `levelup`, `chest-open` then `confetti-pop` | |
| A ball is armed / a trick is cast | `arm-common` / `arm-rare` / `arm-epic` by rarity; `trick-cast` | `pu-<id>`; `m-sabotage` |
| Slow motion in / out | `slowmo-in` / `slowmo-out` | |

### Match play (match-ui)

| Game event | Cue(s) | Announcer |
| --- | --- | --- |
| Stage intro | `whoosh`, then the stage sting | `['m-hole-<n>', 'stage-<id>']` |
| Turn changes | `turn-chime` | `[{ name, fallback: 'm-player-<slot>' }, 'm-youre-up']` |
| Playing for the hole | `heartbeat-hit` (once; never faster than once a second) | `[{ name, fallback }, 'm-for-the-win']`, `'m-to-tie'`, `m-putt-in-to-win`, `m-chip-in-to-win`, `m-putt-in-to-tie`, `m-chip-in-to-tie`, `m-must-hole` |
| Knockout | moment: sting `sting-knockout`, crowd `crowd-roar` | `m-knockout` (priority 3) |
| Hole won | moment: impact `confetti-pop`, sting `fanfare-hole` | `[{ name, fallback }, 'm-wins-the-hole']`, `m-takes-the-lead` |
| Hole tied / sudden death | `drumroll` (once) | `m-all-square`, `m-sudden-death`, `m-closest-to-the-pin` |
| Match point, final hole | | `m-match-point`, `m-final-hole` |
| Match won | moment: impact `confetti-pop`, sting `fanfare-win`, crowd `crowd-roar` | `[{ name, fallback }, 'm-wins-the-match']` or `m-player-<slot>-wins`, then `m-flawless` / `m-comeback` / `m-champion` |
| Awards, trophies, loot | `trophy-tick` per step, `coin-burst`, `chest-open` | `m-new-record` |

## Player names

`POST /api/voice/name { name, pack? }` renders a name once with the pack's voice and the
delivery of "PLAYER ONE" into `<dataDir>/voice/names/<slug>.mp3` (served at
`/voice/names/<slug>.mp3`; `GET /api/voice/names` lists them). It needs a working ElevenLabs
key, and a pack rendered with a voice that key can use.

- Today it always answers `{ ok: false }`: the key is dead, and the shipped pack's voice is a
  Higgsfield preset, so a name in any other voice would not match (`error: 'no-name-voice'`).
  The game then says the fallback line ("PLAYER ONE"), in the pack's own voice. To get names:
  make a key and re-render the pack with `generate.mjs voice --force`.
- The name is trimmed, capped at 24 characters and limited to letters, digits, spaces,
  apostrophes, hyphens and full stops. Concurrent requests for one name share one render; a
  name that comes back longer than 3.5 s is rendered once more. 40 renders an hour, 400 names
  a pack. No key, no network, an API error or a limit: `{ ok: false, error }` with status 200.
- The clip is stored as the API returned it; `audio.js` skips its silence and matches its
  level when it plays it.

## Check

`node tools/arcade-voice/check.mjs` decodes every shipped file and reports length, loudness,
peak, leading and trailing silence, and whether manifests, catalogue and files agree. It
FAILS a file that does not decode, clips, is silent, or is far too long or short; it WARNS on
anything a human should listen to (a length just outside the sane range, a hole inside a
shout, a cut-off tail, a loudness off its target). `--all` prints every file, `--json` writes
the numbers, `--pack <name>` and `--sfx` narrow it. With an ElevenLabs key, `--transcribe`
also sends each announcer clip through speech-to-text and compares the words.

Numbers on 2026-11-23:

| | Files | Length | Loudness | Loudest peak | Lead silence | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Announcer | 214 | 0.90 to 2.95 s spoken (median 1.56) | -16.5 to -15.0 LUFS (target -15) | -1.8 dBFS | up to 40 ms | 0 fail, 2 warn |
| Effects | 94 | 0.08 to 5.75 s | each within 2.7 LU of its own target (-17 to -27 LUFS) unless peak-limited | -1.2 dBFS | up to 40 ms (the swells rise out of silence by design) | 0 fail, 0 warn |

About 25 ms of every file's lead is the mp3 codec's own delay.

## Listen first

Measured, never heard. In order of how much a human ear matters:

1. **The announcer's voice itself** ("Grady"): is it the big grinning arcade announcer? Play
   `nice-shot-1`, `slice-house-1`, `hole-in-one-1`, `m-knockout-1`, `m-for-the-win-1`.
2. **The swell and its payoff**: `crowd-rise-2s.mp3` then `crowd-roar.mp3`. The crowd is a
   recorded room of people, not a stadium: is it big enough?
3. **The strike**: `strike.mp3`, `-2`, `-3`, `-4` and the three `strike-hard` takes come from
   five different recordings. Any that sounds thin or roomy: delete its entry and re-import.
4. **The generated music**: `fanfare-win`, `fanfare-hole`, `stage-sting`, `tee-off`,
   `sting-knockout`, `levelup`, `turn-chime` (each cut from a longer generation).
5. **Layered builds**: `start-match`, `lobby-open`, `coin-flip`, `coin-land`, `vs-slam`,
   `chest-open`, `lava-sizzle`.
6. **Announcer takes the checker flagged**: `beach-2` and `m-sabotage-2` (a laugh before the
   word makes them long). Takes with a laugh in the delivery were rendered one to a job, but
   any take could still carry a stray sound: `generate.mjs --reject` style, delete the file
   and re-run `import-voice.mjs` to drop it from the manifest.

## Costs

| What | Spent |
| --- | --- |
| ElevenLabs API | nothing (the key is dead) |
| Higgsfield credits, announcer (Eleven v4): auditions, 31 shared jobs, 73 single or paired jobs | about 66 |
| Higgsfield credits, music stings (ElevenLabs Music v2.5): 9 jobs | about 8 |
| Higgsfield credits, sound-effect generator (Mirelo): 20 clips, none shipped (boomy, some near silent) | about 9 |
| Downloads | about 6 MB of Kenney packs, 7 MB of freesound previews |

A full announcer re-render there costs about 60 credits (0.23 a take).

## Tests

`node --test test/arcade-voice.test.js` (no network, no sound): the catalogue against the
contract and the game, every take saying its line, the shipped pack and effects against their
manifests, every effect file against `sources.mjs` and `CREDITS.md` (CC0 or generated, no
video or broadcast source, no account address), the render pipeline on placeholder audio,
the name API with a fake fetch, the say() queue, and under a fake Web Audio: the mix rules,
`moment()`, the setup-flow cues, hard takes, `anticipate()` / `resolve()`.
