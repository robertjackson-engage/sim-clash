# Documentation

Start with the [README](../README.md) for installing, connecting a launch monitor and
playing. This folder goes deeper.

## Playing

| Doc | What |
| --- | --- |
| [arcade-v2.md](arcade-v2.md) | The player's guide: formats, rules, every ball and trick, keys, known rough edges |
| [launch-monitors.md](launch-monitors.md) | Which launch monitors connect, and how (generated from the data the in-game wizard uses) |
| [foresight-bridge.md](foresight-bridge.md) | Foresight GC launch monitors through the built-in bridge (experimental) |

## How the game works

| Doc | What |
| --- | --- |
| [match.md](match.md) | Match play: rules in full, the engine (`lib/match.js`), its state, HTTP routes and events |
| [arcade.md](arcade.md) | The arcade layer on the server: balls, tricks, grading, callouts, coins and XP, challenges |
| [arcade-holes.md](arcade-holes.md) | The stages: the catalogue, the course format, how to author a hole |
| [arcade-look.md](arcade-look.md) | The arcade look: themes, skies, prop models, the ball's trail |
| [arcade-feel.md](arcade-feel.md) | Camera, ball cam, slow motion, timing |
| [arcade-voice.md](arcade-voice.md) | The announcer, the sound effects, the mix, and the tools that build them |
| [sim-clash-shell.md](sim-clash-shell.md) | The game shell: title screen, main menu, what is hidden from the simulator |

## For developers and maintainers

| Doc | What |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setting up, where things are, ground rules |
| [dev/packaging.md](dev/packaging.md) | How the Windows app and installer are built, what is in them, how the stages reach a player's PC |
| [dev/install-test.md](dev/install-test.md) | The 15-minute test on a clean PC that only a person can do |
| [dev/signing.md](dev/signing.md) | Code signing: what unsigned means, how to switch signing on, the options and their costs |
| [dev/release-checklist.md](dev/release-checklist.md) | What is checked before a release, and what still needs a person |
| [dev/publishing.md](dev/publishing.md) | The command sequence for publishing the repository, a release and the site |
| [dev/rename.md](dev/rename.md) | The product's name lives in one file; what else a rename touches |
| [dev/upstream.md](dev/upstream.md) | How this fork follows Open-Birdie and offers changes back |
| [dev/arcade-v2-contract.md](dev/arcade-v2-contract.md) | The interface contract the arcade was built against (historical, still the best map of who calls what) |
| [dev/arcade-game-plan.md](dev/arcade-game-plan.md) | The original plan (historical) |
| [dev/outreach/](dev/outreach/) | Launch notes and post drafts |

## Inherited from Open-Birdie

These describe the golf simulator underneath, which the game hides. They are kept because
the engine is the same and because Open-Birdie's updates touch them.

| Doc | What |
| --- | --- |
| [rules-of-play.md](rules-of-play.md) | The simulator's rules of golf |
| [HANDOFF.md](HANDOFF.md), [TODO.md](TODO.md) | Open-Birdie's own working notes on real-course rendering |
| [machines.md](machines.md) | Open-Birdie's notes on its development machines |
| [visual-benchmark.md](visual-benchmark.md), [visual-upgrade-plan.md](visual-upgrade-plan.md), [research/](research/) | Real-course graphics work and course research |

Screenshots for the README are in [media/](media/); concept art and model references in
[art/](art/).
