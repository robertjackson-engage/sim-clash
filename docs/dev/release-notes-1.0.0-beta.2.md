**Sim Clash 1.0.0-beta.2**: arcade golf for real launch monitors. One bay, real swings, two to four players.

The second public build. Same engine, same holes, same rules as the first; every stage has been rebuilt to look like the game it wanted to be, the stages have things on them a real swing can hit, the worlds are alive, and there are four new ways to play. It is still a beta: it has been played on one launch monitor, and reports from yours are the most useful thing you can send (the "Launch monitor report" form under Issues, whether it worked or not).

## Download

`Sim-Clash-Setup-1.0.0-beta.2.exe` (Windows 10 or 11, 64-bit, about INSTALLER_MB MB). The same file is also attached as `Sim-Clash-Setup.exe`, which is what the website's Download button fetches.

SHA-256: `PASTE THE CHECKSUM FROM Get-FileHash HERE`

The installer is **not code-signed**. Windows will show "Windows protected your PC": choose **More info**, then **Run anyway**. On a PC with Smart App Control switched on it will not run; build it from source instead (the README says how).

It installs for your Windows user only (no administrator prompt) over 1.0.0-beta.1 if you have it: players, coins and settings are kept. Windows Firewall asks once about port 921, which is how launch monitors connect; if your connector runs on the same PC you can refuse. The game works offline and downloads nothing. No launch monitor yet? Press **T** for a test swing.

## What is new

**The look.** Every stage has its own sky panorama (eleven of them), and the light, the reflections, the sun's place and the haze all come from that picture. Behind each stage stands a far world of islands, snow peaks, mesas, dunes or a lit skyline. The ground is real material now: nap on the mown grass, ripples in the sand, layered rock on the cliffs, snow that sparkles. Water has caustics, a foam line and rings where a ball goes in; lava has a crust riding the flow. The pin close-up has depth of field and the ball cam blurs at speed. SETTINGS > GRAPHICS has Low for a modest graphics card, and Auto drops to it by itself.

**The stadium and its crowd.** Thunder Dome is a full bowl built from a kit of stand sections, with a roof, floodlights, LED boards and big screens, and about 25,000 spectators, each one a figure. They follow the play: they tense in the slow motion by the pin, cheer a ball that drops, groan at a lip-out, do a wave before a sudden death, and get confetti, flame jets and fireworks when the match is decided. Midnight Mile's last green has an arc of the same stands.

**Trees.** Every world has its own modelled species, 28 in all, with painted leaves and bark and plants at their feet: coconut and fan palms, kapok and strangler fig, wind-bent pines, spruce and larch with snow on the boughs, cherry in blossom, charred snags lit by the lava.

**Course gadgets.** 76 pieces on the stages that a real swing can hit, in sixteen kinds: boost rings, bounce pads, speed strips, a wind tunnel, geysers, bumpers and rails, backboards, funnels, ice and mud, a warp pipe, a cannon, breakable walls (launch the ball at 150 mph and it goes through; at 149 it comes back), coin trails and multiplier rings. Each has real physics, a sound, a callout and a payoff, and each is on the stage's intro card and in the lineup. They are the same for both players, a putt is never touched, and they are live in practice too.

**A living world.** Boats and dolphins, a rain squall on the horizon, a cable car and skaters, koi, crocodiles, a camel caravan, an elevated train, and a dragon on four stages. Windmills, windsocks and flags show the hole's real wind. The world answers the game: every bird goes up for a Rocket off the tee, a great shot gets flares or fireworks, a splash brings fish up, and the lights of the whole stage dip for sudden death. It is scenery only; SETTINGS > WORLD LIFE has Full, Calm and Off.

**New ways to play.**

- **PARTY**, for two to four players: skins, a stroke race over 3, 6 or 9 stages, or elimination, with everything a match has (power-ups and tricks, knockout, sudden death, undo).
- **Handicaps**: HELP 1 to 3 for any player, in Versus and in Party: easy putting, extra power-ups and, from HELP 2, a forward tee. So a beginner can play a good golfer.
- **BULLSEYE**: darts with a golf ball, for one to four players, on any of the three arenas. High score or countdown.
- **TRICK SHOT DUEL**: call a shot; the other player matches it or takes a letter.
- **Instant replays and HIGHLIGHTS**: a notable shot is shown again from another camera, the shot of the match has a button on the winner screen, and the night's best are kept on a reel.

**Sound.** 56 new sound effects and 116 new announcer takes: the gadgets, the world's reactions, the party games, Bullseye, the duel and the replays have their own sounds and lines.

**Connecting.** Nothing has changed in how a launch monitor connects: the catalogue of 30 launch monitors, the first-start wizard and the experimental Foresight bridge are as in 1.0.0-beta.1 ([docs/launch-monitors.md](../blob/main/docs/launch-monitors.md)). The website is new, and its Download buttons now start the download.

## Fixed

- One bad pixel could black out most of the picture (a tee view went almost entirely black on Midnight Mile in testing). Every stage of the picture now guards against it.
- White birds no longer circle on the ball's line, where they could be taken for a ball in flight.
- The second row of gadget chips on a stage's intro card lay under the score; the party lobby's one-tap button lay over the player cards; the FOR THE WIN stamp lay over the winner's row of the hole result.
- The console and the log are clean on every start: no failed requests, no warnings.

## Known issues

- **Nobody has listened to the new sounds.** They were chosen and levelled by measurement with the speakers off. If one is too loud or wrong, say so. One Bullseye line (PERFECT TURN!) is recorded and not yet used.
- **The new modes have been played with test swings only**, by a machine, in a browser with no window. Nobody has yet stood in a bay with four people. The help levels and Bullseye's numbers come from arithmetic, not from watching people play.
- **On Volcano Drop the boost ring hangs above the tee view.** The tee is 34 m above the green and the ring is on the Rocket's line, higher than the frame: only its lower edge shows at address. It is on the aim map, in GADGETS AHEAD, and in the view from above (key V).
- The installed game's own window has still not been seen on a second PC ([docs/dev/install-test.md](../blob/main/docs/dev/install-test.md)), and one launch monitor has been tested (a Foresight GCQuad).
- The rest: "Known issues" in [docs/arcade-v2.md](../blob/main/docs/arcade-v2.md).

## Thanks

Sim Clash is built on [Open-Birdie](https://github.com/rroojrooj/Open-Birdie) by Rooj Rin and on [the fork](https://github.com/jordan-shilts/Open-Birdie) by jordan-shilts. Both are MIT licensed. Full credits are in CREDITS.md.
