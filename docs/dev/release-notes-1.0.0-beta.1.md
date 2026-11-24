**Sim Clash 1.0.0-beta.1**: arcade 1v1 golf for real launch monitors. Two players, one bay, real swings.

This is the first public build. It is a beta: it has been played on very few launch monitors, and reports from yours are the most useful thing you can send (use the "Launch monitor report" form under Issues, whether it worked or not).

## Download

`Sim-Clash-Setup-1.0.0-beta.1.exe` (Windows 10 or 11, 64-bit, about 161 MB)

SHA-256: `PASTE THE CHECKSUM FROM Get-FileHash HERE`

The installer is **not code-signed**. Windows will show "Windows protected your PC": choose **More info**, then **Run anyway**. On a PC with Smart App Control switched on it will not run; build it from source instead (the README says how).

It installs for your Windows user only (no administrator prompt), beside Open-Birdie if you have it, and starts full screen. Windows Firewall asks once about port 921, which is how launch monitors connect; if your connector runs on the same PC you can refuse. The game works offline and downloads nothing.

## What is in it

- Versus matches on one bay: quick match, best of 3, best of 9, with knockout rules and sudden death
- 15 stages: twelve themed match holes (three of them 400 to 700 yard "rocket holes") and three sudden-death arenas
- 15 power-up balls and 3 tricks to play on your opponent
- A verdict, a callout and a crowd for every shot; a ball cam; an announcer
- Solo: a tour of 3, 6 or 12 stages, or any single stage, against your own best score. Practice: free play, closest to the pin, a putting challenge, up and down
- Test swings (key T) when no launch monitor is connected, so anyone can try it
- A connection wizard on first start. Launch monitors: a connector that sends GSPro Open Connect to TCP 921 (a maker's own Open API client, the open-source launch monitors, community connectors), and Foresight GC units, experimental, through the built-in bridge and your own GSPro installation. GSPro's own built-in connections for most launch monitors cannot be pointed at this game: [docs/launch-monitors.md](../blob/main/docs/launch-monitors.md) lists 30 launch monitors in four tiers. One has been tested on a real rig so far (a GCQuad)

## Known issues

See "Known issues" in [docs/arcade-v2.md](../blob/main/docs/arcade-v2.md).

## Thanks

Sim Clash is built on [Open-Birdie](https://github.com/rroojrooj/Open-Birdie) by Rooj Rin and on [the fork](https://github.com/jordan-shilts/Open-Birdie) by jordan-shilts. Both are MIT licensed. Full credits are in CREDITS.md.
