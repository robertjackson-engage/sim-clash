# Arcade game plan: arcade golf on a real launch monitor

_Written 2026-11-14, before the build. Historical: it records the intent. The game has since grown past phase 1 (see `docs/arcade-v2.md` for what exists)._

## The pitch

A video game, not a simulator. You swing a real club on a real launch monitor
(anything that speaks GSPro Open Connect), and the game answers like a mobile
arcade golf game: PERFECT SHOT banners, a crowd that builds as the ball rolls at the cup,
coins, XP, streaks, over-powered power-up balls, and one-hole head-to-head
matches with a closest-to-the-pin shootout. Nobody ships this today: simulator
vendors treat arcade modes as party-night afterthoughts, and arcade golf games
ignore launch monitors.

## What exists in Open-Birdie that we build on

| Need | Already in the codebase |
|---|---|
| Real shots in | `lib/openconnect.js` listens on TCP 921 (GSPro protocol), so GSPconnect connects directly. |
| Ball physics we can bend | `lib/physics.js` RK4 flight, bounce, roll, cup capture, all parameterised. |
| Full hole play | `lib/game.js`: penalties, gimmes, cup capture, scorecard. |
| Mini-games | `lib/practice.js`: closest-to-pin, long drive, targets, putting, chipping. |
| Players and handicaps | `lib/leagues.js`. |
| Event stream to the UI | SSE `shot`/`state` carry the full trajectory and timed events before the ball animates, so crowd reactions can be scripted ahead of time. |
| Replays | `lib/saved-shots.js` (ghost opponents later). |
| Cloud + DB | `cloud/` service and a Supabase schema (async online later). |

## Workstreams (phase 1, all in flight)

1. **Server core** `lib/arcade.js`: power-up catalogue and physics modifiers,
   shot grading, economy state (coins, XP, level, streak, inventory), routes,
   SSE `arcade` / `arcade-state`.
2. **HUD** `public/arcade/arcade.js|css`: banners, point popups, streak flame,
   coin/XP, power-up dock, scripted crowd timeline from the trajectory.
3. **Audio** `public/arcade/audio.js`: procedural Web Audio crowd, stings,
   strike sounds; mp3 overrides via `public/arcade/sfx/`.
4. **Match** `lib/match.js` + `public/arcade/match.js`: hot-seat 1v1, one hole,
   farther-from-hole hits next, shootout tiebreak, tiers, pot, trophies.
5. **Holes** `tools/arcade-holes/`: original hand-authored holes written in the
   app's own course JSON (surfaces, synthetic elevation, trees), loadable with
   zero loader changes.
6. **Look** `public/render/arcade-look.js` + `props.js`: a switchable saturated
   "arcade" render preset and a GLB props layer, default rendering untouched.

Integration (app.js, index.html, server routes) happens after the agents land.

## Art direction

Style bible: `docs/art/concepts/*.png` (six original themes, generated
2026-11-14). Other games' courses are their owners' copyright: reference the genre,
never copy layouts or names.

Pipeline for a hole:

1. Concept image (generated).
2. Layout authored in `tools/arcade-holes/holes/<name>.js` (polygons, heights).
3. Hero props (lighthouse, volcano, arch, chapel) as GLB via image-to-3D from
   crops of the concept, placed through `course.props`.
4. Arcade look preset on, screenshot, compare against the concept, iterate.

## What a complete game needs beyond phase 1

- **Progression**: tours by handicap, seasons, chests with cosmetic unlocks
  (ball skins, flags, announcer voices). Real skill is the stat, so no club
  upgrades.
- **Commentary**: a live commentary engine subscribed to the
  `shot`/`arcade`/`match` events for hype calls.
- **Async online**: upload a hole's shot sequence, opponent plays theirs, ghost
  replay, leaderboard. Needs accounts and anti-cheat by trust (friends/leagues).
- **Live online**: WebSocket relay, spectating, live stakes. Only after there
  is a population.
- **More holes**: 9 themed holes is a "course"; 3 courses is a launch.
- **Toon rendering**: outline pass, stylised cliffs/rocks, foam shader, cloud
  sprites, to close the gap to the concept art.
- **Packaging**: the Electron build already exists (`npm run dist`); unsigned.
- **Licensing**: Open-Birdie is MIT, so a commercial fork is permitted; keep the
  arcade layer additive so upstream fixes merge.

## Risks

- Pace: a real swing plus flight is 20 to 30 s; one-hole matches stay snappy,
  long formats will not.
- Cheating online: Open Connect is unauthenticated; start with friends.
- Renderer gap: the procedural renderer will not match painted concept art
  without real stylised assets; the look preset gets us most of the feel, props
  get the rest.
