# Launch monitors

<!-- GENERATED from lib/launch-monitors.json by tools/arcade-dev/launch-monitors-doc.mjs. Do not edit by hand:
     change the catalogue (or the generator) and run  node tools/arcade-dev/launch-monitors-doc.mjs --write  -->

Catalogue version 1, checked 2026-11-26.

## In short

The game listens on TCP port 921 and speaks GSPro Open Connect v1: it plays the part GSPro's "Open API" plays. A launch monitor's connector that sends shots to GSPro's Open API can send them to the game instead, when GSPro is closed. Foresight GC units do not speak Open Connect; they come in through the game's built-in Foresight bridge (`docs/foresight-bridge.md`).

One thing decides most of this list. GSPro reaches most launch monitors through connections built into its own connector program (Uneekor, FlightScope, Garmin, Rapsodo, Full Swing, Square, ProTee and others each have their own mode there). Those do **not** use the Open API, and cannot be pointed at another program. Only three kinds of connector can feed this game: a maker's own Open API client, an open-source launch monitor's own, and community connectors.

Nothing here is presented as tested unless a ball has been hit with it on a real rig. Today that is one unit.

| Tier | Meaning |
| --- | --- |
| **Tested** | Works on a real rig. |
| **Expected to work** | Its own connector is documented to send Open Connect, or it is the same connector as a tested unit. Nobody has tried it with this game yet. |
| **Community / unofficial** | Needs an unofficial helper program between the launch monitor and the game. Untested here. |
| **Not supported yet** | No way in that we know of. You can still play with test swings. |

## The list

### Tested (1)

| Launch monitor | Models | Comes in through | Licence of that connector |
| --- | --- | --- | --- |
| Foresight GCQuad | GCQuad | the Foresight bridge and GSPconnect (the connector inside your own GSPro installation) | GSPro's own: not included with the game |

### Expected to work (8)

| Launch monitor | Models | Comes in through | Licence of that connector |
| --- | --- | --- | --- |
| Foresight GC3 / GCHawk / QuadMAX / Falcon | GC3, GCHawk, GCQuad MAX (QuadMAX), Falcon | the Foresight bridge and GSPconnect (the connector inside your own GSPro installation) | GSPro's own: not included with the game |
| Bushnell Launch Pro | Launch Pro | the Foresight bridge and GSPconnect (the connector inside your own GSPro installation) | GSPro's own: not included with the game |
| Square Golf (Home) | Square Golf launch monitor (Home) | [SQG GSPro Connect (Square's own)](https://squaregolf.com/pages/software-3ps-gspro) | Square's own |
| NVisage N1 | NVisage N1 | [N-Connect (NVisage's own)](https://nvisagetech.com/n1-launch-monitor-guide/) | NVisage's own |
| Bullseye LM | Bullseye LM | [Bullseye's own software (its GSPro / Open API connection)](https://bullseyegolfsims.com/us/product/bullseye-lm/) | Bullseye's own |
| GolfIn Idra | GolfIn Idra | [GolfIn's own software (its GSPro / Open API connection)](https://gsprogolf.com/) | GolfIn's own |
| PiTrac | PiTrac (open-source, build it yourself) | [PiTrac's own GSPro interface](https://docs.pitrac.org/software/simulator-integration/) | GPL-2.0 |
| OpenFlight | OpenFlight (open-source, build it yourself) | [OpenFlight's own GSPro (OpenConnectV1) connector](https://github.com/open-flight/openflight/blob/main/docs/using/simulator/gspro.md) | AGPL-3.0-or-later |

### Community / unofficial (13)

| Launch monitor | Models | Comes in through | Licence of that connector |
| --- | --- | --- | --- |
| Foresight GC2 | GC2, GC2 + HMT | [gspro-gc2-connector](https://github.com/matthew-johnston/gspro-gc2-connector) | no licence file |
| Uneekor EYE XO / XO2 / EYE MINI / QED | EYE XO, EYE XO2, EYE MINI, EYE MINI LITE, QED | [Uneekor VIEW watcher (tools/uneekor-watch.js, part of this project)](https://github.com/jordan-shilts/Open-Birdie/blob/main/tools/uneekor-watch.js) | MIT |
| Garmin Approach R10 | Approach R10 | [gsp-r10-adapter](https://github.com/mholow/gsp-r10-adapter) | MIT |
| Garmin Approach R50 | Approach R50 | [MLM2PRO-GSPro-Connector (device: Garmin R50)](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| FlightScope Mevo+ / Mevo Gen2 / Xi | Mevo+, Mevo Gen2, Xi | [flighthook](https://github.com/divotmaker/flighthook) | MIT / Apache-2.0 |
| SkyTrak / SkyTrak+ | SkyTrak+, SkyTrak (original) | [OpenSkyPlus2 (with its GSPro plugin)](https://openskyplus2.github.io/OpenSkyPlus2/README-OpenSkyPlus2.html) | closed source, free to use |
| Rapsodo MLM2PRO | MLM2PRO | [MLM2PRO-GSPro-Connector](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| Square Golf Omni | Square Omni | [flighthook](https://github.com/divotmaker/flighthook) | MIT / Apache-2.0 |
| Full Swing KIT | Full Swing KIT | [MLM2PRO-GSPro-Connector (device: Fullswing Kit)](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| TrackMan | TrackMan 4, TrackMan iO | [MLM2PRO-GSPro-Connector (device: Trackman)](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| Voice Caddie Swing Caddie SC4 / SC4 Pro | Swing Caddie SC4, Swing Caddie SC4 Pro | [MLM2PRO-GSPro-Connector (device: Voice Caddie SC4)](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| TruGolf Apogee | TruGolf Apogee | [MLM2PRO-GSPro-Connector (device: TruGolf Apogee Apex)](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 |
| ProTee VX | ProTee VX | [VX Connector](https://github.com/zonkey-acoustic/vx-connector) | MIT (per its README) |

### Not supported yet (8)

| Launch monitor | Why not |
| --- | --- |
| FlightScope X3 / X2 / Mevo (original) | No connector was found that sends these units' shots as Open Connect. GSPro reaches the X2 and X3 through its own private FlightScope connection; FlightScope says the original Mevo does not support simulator courses, and opens the X3C to approved integrators only. |
| OpenLaunch NOVA | The NOVA reaches GSPro through GSPro's own built-in connection, which cannot be pointed at this game. It is the best candidate for a direct connection, though: OpenLaunch publishes a local API (JSON over TCP and WebSocket, found on the network automatically) with an Apache-2.0 developer guide. See the roadmap. |
| OptiShot Nova / BallFlight / Orbit | OptiShot's units run OptiShot's own Orion software. No connector was found that sends their shots to GSPro or as Open Connect, and they are not on GSPro's supported list. (The Nova on GSPro's list is OpenLaunch's, a different product.) |
| Golfzon WAVE | No connector was found that sends the WAVE's shots to GSPro or as Open Connect, and it is not on GSPro's supported list. |
| GolfJoy GDS / GR / Spica | GolfJoy units reach GSPro through GSPro's own built-in connection over a fixed private network link, which cannot be pointed at this game. GolfJoy had an Open API route before that; whether it still works is not known. |
| VTrack | VTrack reaches GSPro through GSPro's own built-in connection, started from VTrack's toolkit. How its shots travel is not documented, and no connector was found that sends them as Open Connect. |
| Bluetees RAINMAKER | The RAINMAKER reaches GSPro through GSPro's own built-in connection (paired with a PIN), which cannot be pointed at this game. |
| Ernest Sports ES16 / ES Tour Plus | No connector was found that sends these units' shots to GSPro or as Open Connect, and they are not on GSPro's supported list. |

## Connecting each one

The game's connection wizard shows the same steps, with this PC's address filled in and a live status light. It runs the first time the game starts and again from SETTINGS > LAUNCH MONITOR.

### Foresight GCQuad

**Tested.** Models: GCQuad. Catalogue id: `foresight-gcquad`.

Connector: [GSPconnect (the connector inside your own GSPro installation)](https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md) (GSPro's own: not included with the game).

You need:

- Your own GSPro installation and licence (Foresight type)
- FSX 2020 or FSX Play, as GSPro asks of every GC unit

Steps:

1. Close GSPro if it is open.
2. Open GSPconnect from your GSPro folder.
3. Connect the GCQuad in it, as you do for GSPro.
4. Leave GSPconnect open and hit a ball.

Notes:

- Experimental. Tested on one GCQuad rig, the developer's own.
- The game's built-in Foresight bridge holds the connector's local port (9050) and reads its shot log: docs/foresight-bridge.md.
- Ball data only: the connector's log has no club data.
- GSPconnect is normally in C:\GSProV1\Core\GSPC. Elsewhere: set the folder in SETTINGS > LAUNCH MONITOR.

Sources:

- `docs/foresight-bridge.md`: How the bridge works and what is known about the connector
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md>: GSPro's guide: the Foresight option of GSPro Connect, connection types
- <https://gsprogolf.com/foresight-bushnell.html>: All GC users must have FSX 2020 or FSX Play

### Foresight GC3 / GCHawk / QuadMAX / Falcon

**Expected to work.** Models: GC3, GCHawk, GCQuad MAX (QuadMAX), Falcon. Catalogue id: `foresight-gc3-gchawk`.

Connector: [GSPconnect (the connector inside your own GSPro installation)](https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md) (GSPro's own: not included with the game).

You need:

- Your own GSPro installation and licence (Foresight type)
- FSX 2020 or FSX Play, as GSPro asks of every GC unit

Steps:

1. Close GSPro if it is open.
2. Open GSPconnect from your GSPro folder.
3. Connect your launch monitor in it, as for GSPro.
4. Leave GSPconnect open and hit a ball.

Notes:

- Not tested on these units. They use the same GSPro connector as the GCQuad, which is the tested one.
- The bridge reads the connector's shot log. Whether every model writes it in the same format is not known.
- Ball data only.

Sources:

- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md>: One connection app for GC3, GCQuad, GCHawk, Falcon and the Launch Pro
- `docs/foresight-bridge.md`: Known and not known about the connector's log
- <https://gsprogolf.com/>: GSPro's list of supported Foresight units

### Bushnell Launch Pro

**Expected to work.** Models: Launch Pro. Catalogue id: `bushnell-launch-pro`.

Connector: [GSPconnect (the connector inside your own GSPro installation)](https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md) (GSPro's own: not included with the game).

You need:

- Your own GSPro installation and licence (Foresight type)
- A paid Bushnell Gold subscription (a Gold trial is not accepted by GSPro)

Steps:

1. Close GSPro if it is open.
2. Open GSPconnect from your GSPro folder.
3. Connect the Launch Pro in it, as you do for GSPro.
4. Leave GSPconnect open and hit a ball.

Notes:

- Not tested on a Launch Pro. It uses the same GSPro connector as the GCQuad, which is the tested one.
- Ball data only.

Sources:

- <https://gsprogolf.com/foresight-bushnell.html>: Launch Pro needs paid Gold; trials are not valid
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide.md>: Same connection app as the GC units

### Square Golf (Home)

**Expected to work.** Models: Square Golf launch monitor (Home). Catalogue id: `square-home`.

Connector: [SQG GSPro Connect (Square's own)](https://squaregolf.com/pages/software-3ps-gspro) (Square's own).

Steps:

1. Close GSPro if it is open.
2. Turn the launch monitor on.
3. Start SQG GSPro Connect.
4. Press Connect for the device, then Connect for GSPro.
5. Hit a ball.

Notes:

- Untested here. Square documents SQG GSPro Connect as an Open API client, which is what this game listens for on this PC.
- Not known: whether it lets you change the address or port, and whether it looks for GSPro itself before connecting.
- GSPro has since added Square as a built-in connection; the Open API connector may no longer be the one Square recommends.

Sources:

- <https://squaregolf.com/pages/software-3ps-gspro>: Square's steps: select Open API in GSPro, then SQG GSPro Connect
- <https://gsprogolf.com/GSProConnectV1.html>: The Open API address: 127.0.0.1, port 921
- <https://www.playbetter.com/blogs/golf-simulator-software/what-golf-simulators-work-with-gspro>: Retailer: Square now connects natively *(a report, not confirmed)*

### NVisage N1

**Expected to work.** Models: NVisage N1. Catalogue id: `nvisage-n1`.

Connector: [N-Connect (NVisage's own)](https://nvisagetech.com/n1-launch-monitor-guide/) (NVisage's own).

Steps:

1. Close GSPro if it is open.
2. Open N-Connect.
3. Press SELECT GAME, then START.
4. Select the N1 and press CONNECT.
5. Hit a ball.

Notes:

- Untested here. GSPro lists NVisage as an Open API integration, which is what this game listens for on this PC.
- Not known: whether N-Connect lets you change the address or port, and whether it looks for GSPro itself before connecting.
- N-Connect is normally at C:\Program Files\NVISAGE\Pio\Tools\N-CONNECT.exe (from NVisage's guide, as reported).

Sources:

- <https://gsprogolf.com/>: GSPro lists NVisage (OpenAPI)
- <https://gsprogolf.com/GSProConnectV1.html>: The Open API address: 127.0.0.1, port 921
- <https://nvisagetech.com/n1-launch-monitor-guide/>: NVisage's guide: the N-Connect steps (read through a search extract) *(a report, not confirmed)*

### Bullseye LM

**Expected to work.** Models: Bullseye LM. Catalogue id: `bullseye-lm`.

Connector: [Bullseye's own software (its GSPro / Open API connection)](https://bullseyegolfsims.com/us/product/bullseye-lm/) (Bullseye's own).

Steps:

1. Close GSPro if it is open.
2. Start the Bullseye software.
3. Choose its GSPro (Open API) connection.
4. Hit a ball.

Notes:

- Untested here. GSPro lists Bullseye as an Open API integration, which is what this game listens for on this PC.
- Not known: the exact steps in Bullseye's software, whether the address or port can be changed, and whether it looks for GSPro itself.

Sources:

- <https://gsprogolf.com/>: GSPro lists Bullseye (OpenAPI)
- <https://gsprogolf.com/GSProConnectV1.html>: The Open API address: 127.0.0.1, port 921
- <https://bullseyegolfsims.com/us/product/bullseye-lm/>: Bullseye: official integrator with PurePlay and GSPro

### GolfIn Idra

**Expected to work.** Models: GolfIn Idra. Catalogue id: `golfin-idra`.

Connector: [GolfIn's own software (its GSPro / Open API connection)](https://gsprogolf.com/) (GolfIn's own).

Steps:

1. Close GSPro if it is open.
2. Start the GolfIn software.
3. Choose its GSPro (Open API) connection.
4. Hit a ball.

Notes:

- Untested here. GSPro lists the GolfIn Idra as an Open API integration, which is what this game listens for on this PC.
- Not known: the exact steps in GolfIn's software, whether the address or port can be changed, and whether it looks for GSPro itself.

Sources:

- <https://gsprogolf.com/>: GSPro lists GolfIn Idra (OpenAPI)
- <https://gsprogolf.com/GSProConnectV1.html>: The Open API address: 127.0.0.1, port 921

### PiTrac

**Expected to work.** Models: PiTrac (open-source, build it yourself). Catalogue id: `pitrac`.

Connector: [PiTrac's own GSPro interface](https://docs.pitrac.org/software/simulator-integration/) (GPL-2.0).

You need:

- PiTrac and this PC on the same network

Steps:

1. Open PiTrac's web page: http://(the Pi's address):8080
2. Go to Configuration, Simulators, GSPro.
3. Type the host address and port shown here.
4. Start this game first, then the PiTrac launch monitor.
5. Hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| kGSProHostAddress | `ADDRESS` |
| kGSProPort | `921` |

Notes:

- Untested here. PiTrac sends Open Connect to whatever address you type, so nothing about it is tied to GSPro.
- It connects from the Raspberry Pi, across your network: Windows Firewall must let this game accept connections on the port.

Sources:

- <https://docs.pitrac.org/software/simulator-integration/>: PiTrac documentation: kGSProHostAddress, kGSProPort 921, allow inbound 921, start the simulator first
- <https://github.com/PiTracLM/PiTrac>: Source (Software/web-server/sims/gspro_sim.py) and GPL-2.0 licence

### OpenFlight

**Expected to work.** Models: OpenFlight (open-source, build it yourself). Catalogue id: `openflight`.

Connector: [OpenFlight's own GSPro (OpenConnectV1) connector](https://github.com/open-flight/openflight/blob/main/docs/using/simulator/gspro.md) (AGPL-3.0-or-later).

You need:

- OpenFlight and this PC on the same network

Steps:

1. On OpenFlight copy config/sim.example.json to sim.json.
2. Add a gspro connector with the host and port shown here.
3. Start OpenFlight with: scripts/start-kiosk.sh --sim
4. Hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| host | `ADDRESS` |
| port | `921` |

Notes:

- Not tested by this project. Open-Birdie, which this game is built on, was written with OpenFlight in mind: replies name the simulator, and a shot OpenFlight sends twice is played once.
- OpenFlight sends no putts.
- It connects across your network: Windows Firewall must let this game accept connections on the port.

Sources:

- <https://github.com/open-flight/openflight/blob/main/docs/using/simulator/gspro.md>: OpenFlight documentation: the gspro connector's host, port, device_id, heartbeat
- <https://raw.githubusercontent.com/open-flight/openflight/main/src/openflight/sim/config.py>: Source: defaults host 127.0.0.1, port 921
- <https://raw.githubusercontent.com/open-flight/openflight/main/LICENSE>: AGPL-3.0-or-later

### Foresight GC2

**Community / unofficial.** Models: GC2, GC2 + HMT. Catalogue id: `foresight-gc2`.

Connector: [gspro-gc2-connector](https://github.com/matthew-johnston/gspro-gc2-connector) (no licence file).

You need:

- A GC2 paired to this PC over Bluetooth (a COM port)

Steps:

1. Pair the GC2 with this PC over Bluetooth.
2. Download gspro-gc2-connector and open a terminal there.
3. Start it with the address and port shown here.
4. Hit a ball.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| --gs-pro-ip | `ADDRESS` |
| --gs-pro-port | `921` |

Other connectors:

- [GSPro-gc2-API-Interface](https://github.com/ParnoldAlmer/GSPro-gc2-API-Interface) (no licence file). Python, GC2 over USB or Bluetooth. The address comes from its Config.txt (default localhost); the port is fixed at 921.

Notes:

- Untested here. GSPro's own Foresight integration does not support the GC2, so this is the only way in.
- A command-line tool: its options are --gs-pro-ip and --gs-pro-port.

Sources:

- <https://github.com/matthew-johnston/gspro-gc2-connector>: Source (main.rs, gs_pro.rs): Open Connect client with --gs-pro-ip and --gs-pro-port
- <https://github.com/ParnoldAlmer/GSPro-gc2-API-Interface>: Source (OpenAPI.py, gc2USB.py): IP from Config.txt, port 921
- <https://support.foresightsports.com/support/software/gspro-integration>: The official integration does not support the GC2

### Uneekor EYE XO / XO2 / EYE MINI / QED

**Community / unofficial.** Models: EYE XO, EYE XO2, EYE MINI, EYE MINI LITE, QED. Catalogue id: `uneekor-view`.

Connector: [Uneekor VIEW watcher (tools/uneekor-watch.js, part of this project)](https://github.com/jordan-shilts/Open-Birdie/blob/main/tools/uneekor-watch.js) (MIT).

You need:

- Uneekor VIEW running on this PC

Steps:

1. Open Uneekor VIEW and get your unit ready in it.
2. Start the game: it starts its VIEW watcher by itself.
3. Hit a ball in VIEW: the watcher sends it to the game.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| BIRDIE_OC_HOST | `ADDRESS` |
| BIRDIE_OC_PORT | `921` |

Other connectors:

- [MLM2PRO-GSPro-Connector (reads the VIEW window off the screen)](https://github.com/springbok/MLM2PRO-GSPro-Connector/wiki/Uneekor) (GPL-3.0). EYE MINI and EYE MINI LITE. Enter this PC's network address, not 127.0.0.1 (see the Rapsodo entry for why).

Notes:

- Not tested by this project. The watcher comes from Open-Birdie, which this game is built on; it reads the shot files VIEW writes.
- The desktop game (installed, or npm start) starts the watcher by itself when it finds VIEW's ShotData folder on this PC; BIRDIE_NO_WATCH=1 switches that off. Only the game server without its window (npm run start:server) needs the watcher started by hand: npm run watch, with Node.js.
- VIEW reports ball speed in metres per second: the watcher converts it (--speed-scale 2.23694).
- GSPro's own Uneekor connection is private to GSPro and cannot be pointed at this game.
- There is no status line for the watcher in the game yet: the launch monitor light turns on when it has connected.

Sources:

- <https://github.com/jordan-shilts/Open-Birdie/blob/main/tools/uneekor-watch.js>: The watcher's source: reads VIEW's ShotData folder, sends Open Connect to BIRDIE_OC_HOST:BIRDIE_OC_PORT
- <https://github.com/springbok/MLM2PRO-GSPro-Connector/wiki/Uneekor>: The screen-reading route for the EYE MINI family
- <https://gspro.gitbook.io/gspro-knowledge-base/troubleshooting-and-support/how-to-clear-gspro-connect-settings.md>: Uneekor is its own interface inside GSPro Connect, not Open API
- <https://uneekor.com/golf-simulator-software/third-party>: Uneekor's third-party software terms and memberships

### Garmin Approach R10

**Community / unofficial.** Models: Approach R10. Catalogue id: `garmin-r10`.

Connector: [gsp-r10-adapter](https://github.com/mholow/gsp-r10-adapter) (MIT).

You need:

- Bluetooth on this PC (or the Garmin Golf app for the E6 Connect route)

Steps:

1. Download gsp-r10-adapter and unzip it.
2. Open its settings.json: check the address and port.
3. Turn the R10 on and start the adapter.
4. Wait for it to say it is connected, then hit a ball.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| openConnect ip | `ADDRESS` |
| openConnect port | `921` |

Other connectors:

- [flighthook](https://github.com/divotmaker/flighthook) (MIT / Apache-2.0). R10 over Bluetooth. Set address = "127.0.0.1:921" under [openconnect_client.0] in %APPDATA%\flighthook\config.toml.
- [gspro-garmin-connect-v2](https://github.com/travislang/gspro-garmin-connect-v2) (MIT (per its package.json)). Uses the Garmin Golf app's E6 Connect setting. Its target is fixed at 127.0.0.1:921: this PC only, default port only.

Notes:

- Untested here. The adapter's defaults are already 127.0.0.1 and 921, so on this PC it should need no change.
- The R10 does not read putts. The adapter can take putts from a webcam (cam-putting-py).

Sources:

- <https://github.com/mholow/gsp-r10-adapter>: Source and settings.json: openConnect ip 127.0.0.1, port 921; MIT licence file
- <https://github.com/divotmaker/flighthook>: README: R10 over BLE, Open Connect client address in config.toml
- <https://github.com/travislang/gspro-garmin-connect-v2>: Source (src/env.js): fixed 127.0.0.1:921
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/garmin-approach-r10-connection-guide.md>: GSPro's own R10 connection is Bluetooth inside GSPro Connect, not Open API

### Garmin Approach R50

**Community / unofficial.** Models: Approach R50. Catalogue id: `garmin-r50`.

Connector: [MLM2PRO-GSPro-Connector (device: Garmin R50)](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

Steps:

1. Download MLM2PRO-GSPro-Connector and start it.
2. In Settings choose the device: Garmin R50.
3. Type the IP address and port shown here.
4. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Notes:

- Untested, and the weakest entry in this tier: the connector lists a Garmin R50 device, but how it reads the R50 was not checked.
- Use this PC's network address, not 127.0.0.1: with a local address the connector first looks for GSPro's own window and stops without it.
- The R50's own GSPro connection is encrypted and private to GSPro Connect.

Sources:

- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/settings.py>: Source: the device list includes Garmin R50; ip_address and port settings
- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/gspro_connection.py>: Source: the GSPro window check applies to 127.0.0.1 / localhost only
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/garmin-approach-r50-connection-guide.md>: GSPro's own R50 connection: found automatically by GSPro Connect
- <https://forums.garmin.com/outdoor-recreation/golf/f/approach-r50/401156/approach-r50-and-gspro-on-mac-crossover/2020877>: Forum report: the R50 link is encrypted, with partner credentials *(a report, not confirmed)*

### FlightScope Mevo+ / Mevo Gen2 / Xi

**Community / unofficial.** Models: Mevo+, Mevo Gen2, Xi. Catalogue id: `flightscope-mevo-plus`.

Connector: [flighthook](https://github.com/divotmaker/flighthook) (MIT / Apache-2.0).

You need:

- This PC joined to the Mevo's own Wi-Fi network

Steps:

1. Join this PC to the Mevo's Wi-Fi (the network named FS ...).
2. Download flighthook and start it once.
3. In its config.toml set the Open Connect address.
4. Start flighthook again and hit a ball.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| [openconnect_client.0] address | `ADDRESS:921` |

Other connectors:

- [MLM2PRO-GSPro-Connector (reads the FS Golf PC window off the screen)](https://github.com/springbok/MLM2PRO-GSPro-Connector/wiki/Mevo+) (GPL-3.0). Needs FS Golf PC 2.0 (FlightScope's Pro Package). Enter this PC's network address, not 127.0.0.1.

Notes:

- Untested here. flighthook is a beta; it talks to the Mevo directly and forwards shots as an Open Connect client.
- Its config file is %APPDATA%\flighthook\config.toml; the default address is already 127.0.0.1:921.
- GSPro's own FlightScope connection is private to GSPro Connect.

Sources:

- <https://github.com/divotmaker/flighthook>: README: Mevo+, Mevo Gen2 and Xi over TCP 5100; Open Connect client address in config.toml
- <https://github.com/springbok/MLM2PRO-GSPro-Connector/wiki/Mevo+>: The screen-reading route
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/flightscope-guide>: GSPro's own FlightScope connection (device 192.168.2.1, port 5100)

### SkyTrak / SkyTrak+

**Community / unofficial.** Models: SkyTrak+, SkyTrak (original). Catalogue id: `skytrak`.

Connector: [OpenSkyPlus2 (with its GSPro plugin)](https://openskyplus2.github.io/OpenSkyPlus2/README-OpenSkyPlus2.html) (closed source, free to use).

You need:

- The SkyTrak PC app (versions 5.4 to 5.8 are the ones OpenSkyPlus2 names)
- A SkyTrak plan that allows the PC app

Steps:

1. Install OpenSkyPlus2 into the SkyTrak PC app (its guide).
2. Leave its GSPro address at 127.0.0.1 and port at 921.
3. Start the SkyTrak app and connect your SkyTrak.
4. Hit a ball.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| Hostname | `ADDRESS` |
| Port | `921` |

Other connectors:

- [OpenSkyPlus + GSPro4OSP (the older version)](https://github.com/OpenSkyPlus/GSPro4OSP) (custom licence: personal use only, not open source). Host and port in pluginsettings.json (default 127.0.0.1 and 921).

Notes:

- Untested here. SkyTrak does not support GSPro officially, so this is a community plug-in that loads inside the SkyTrak app; a SkyTrak update can break it.
- The port is set in BepInEx\config\GsPro4Osp.cfg.
- SkyTrak+ is the unit it targets; the original SkyTrak is reported to work.

Sources:

- <https://openskyplus2.github.io/OpenSkyPlus2/README-OpenSkyPlus2.html>: Project documentation: Open API at 127.0.0.1:921, port configurable
- <https://openskyplus2.github.io/OpenSkyPlus2/FAQs-OpenSkyPlus2.html>: Not open source yet
- <https://github.com/OpenSkyPlus/GSPro4OSP>: pluginsettings.json: Hostname 127.0.0.1, Port 921; its licence
- <https://golfsimulatorforum.com/forum/skytrak/417077-skytrak-plus-gspro-connector>: Forum: GSPro is not officially supported by SkyTrak *(a report, not confirmed)*

### Rapsodo MLM2PRO

**Community / unofficial.** Models: MLM2PRO. Catalogue id: `rapsodo-mlm2pro`.

Connector: [MLM2PRO-GSPro-Connector](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

You need:

- A Rapsodo membership that allows third-party apps
- Third-party access authorised in the Rapsodo app (it expires, so repeat it when asked)

Steps:

1. Download MLM2PRO-GSPro-Connector and start it.
2. In Settings type the IP address and port shown here.
3. In the Rapsodo app authorise third-party apps.
4. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Other connectors:

- [MLM2PRO-BT-APP](https://github.com/Duwaynef/MLM2PRO-BT-APP) (MIT). A beta. Direct Bluetooth; GSPro address and port in its settings (default 127.0.0.1 and 921).

Notes:

- Untested here.
- Use this PC's network address, not 127.0.0.1: with a local address the connector first looks for GSPro's own window ("APIv1 Connect") and stops without it.
- Its Bluetooth mode needs Rapsodo's online authorisation; its other mode reads the Rapsodo app off a mirrored phone screen.
- Rapsodo's official GSPro connection is private to GSPro Connect.

Sources:

- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/settings.py>: Source: ip_address 127.0.0.1, port 921, gspro_api_window_name
- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/gspro_connection.py>: Source: the GSPro window check for a local address
- <https://github.com/springbok/MLM2PRO-GSPro-Connector/wiki/Settings>: The IP Address and Port fields
- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/bluetooth/mlm2pro_device.py>: Source: the Rapsodo web API token in Bluetooth mode
- <https://github.com/Duwaynef/MLM2PRO-BT-APP>: The alternative connector
- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/rapsodo-mlm2pro-connection-guide.md>: The official path: Bluetooth inside GSPro Connect

### Square Golf Omni

**Community / unofficial.** Models: Square Omni. Catalogue id: `square-omni`.

Connector: [flighthook](https://github.com/divotmaker/flighthook) (MIT / Apache-2.0).

You need:

- Bluetooth on this PC

Steps:

1. Download flighthook and start it once.
2. In its config.toml set the Open Connect address.
3. Turn the Omni on and start flighthook again.
4. Hit a ball.

Settings to enter (ADDRESS is `127.0.0.1` (the connector runs on this PC)):

| Setting | Value |
| --- | --- |
| [openconnect_client.0] address | `ADDRESS:921` |

Notes:

- Untested here. flighthook is a beta; it talks to the Omni over Bluetooth and forwards shots as an Open Connect client.
- Its config file is %APPDATA%\flighthook\config.toml; the default address is already 127.0.0.1:921.

Sources:

- <https://github.com/divotmaker/flighthook>: README: Square Omni over BLE; Open Connect client address
- <https://github.com/divotmaker/allsquare>: The Omni protocol library flighthook uses

### Full Swing KIT

**Community / unofficial.** Models: Full Swing KIT. Catalogue id: `fullswing-kit`.

Connector: [MLM2PRO-GSPro-Connector (device: Fullswing Kit)](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

You need:

- The Full Swing app showing its numbers on this PC's screen (a mirrored phone or tablet)

Steps:

1. Mirror the Full Swing app onto this PC's screen.
2. Start MLM2PRO-GSPro-Connector: device Fullswing Kit.
3. In Settings type the IP address and port shown here.
4. Mark the numbers on screen as its guide shows.
5. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Notes:

- Untested here. The connector reads the numbers off the screen, so it is only as good as that picture.
- Use this PC's network address, not 127.0.0.1 (see the Rapsodo entry for why).
- The KIT's own GSPro connection is private to GSPro Connect.

Sources:

- <https://github.com/springbok/MLM2PRO-GSPro-Connector/releases>: Release notes: the Fullswing Kit device
- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/settings.py>: Source: device list, ip_address and port
- <https://gspro.gitbook.io/gspro-knowledge-base/troubleshooting-and-support/how-to-clear-gspro-connect-settings.md>: Full Swing KIT is its own interface inside GSPro Connect

### TrackMan

**Community / unofficial.** Models: TrackMan 4, TrackMan iO. Catalogue id: `trackman`.

Connector: [MLM2PRO-GSPro-Connector (device: Trackman)](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

You need:

- TrackMan's own software showing its numbers on this PC's screen

Steps:

1. Open TrackMan's software with its numbers on screen.
2. Start MLM2PRO-GSPro-Connector: device Trackman.
3. In Settings type the IP address and port shown here.
4. Mark the numbers on screen as its guide shows.
5. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Notes:

- Untested here. The connector reads the numbers off the screen; which TrackMan screen it reads, and whether it works with the iO, was not checked.
- Use this PC's network address, not 127.0.0.1 (see the Rapsodo entry for why).
- TrackMan has no connection to GSPro of its own.

Sources:

- <https://github.com/springbok/MLM2PRO-GSPro-Connector/releases>: Release notes: the Trackman device
- <https://gsprogolf.com/>: TrackMan is not on GSPro's supported list

### Voice Caddie Swing Caddie SC4 / SC4 Pro

**Community / unofficial.** Models: Swing Caddie SC4, Swing Caddie SC4 Pro. Catalogue id: `voicecaddie-sc4`.

Connector: [MLM2PRO-GSPro-Connector (device: Voice Caddie SC4)](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

You need:

- The Voice Caddie app showing its numbers on this PC's screen (a mirrored phone or tablet)

Steps:

1. Mirror the Voice Caddie app onto this PC's screen.
2. Start MLM2PRO-GSPro-Connector: device Voice Caddie SC4.
3. In Settings type the IP address and port shown here.
4. Mark the numbers on screen as its guide shows.
5. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Notes:

- Untested here. The connector names the SC4; whether it reads the SC4 Pro's app as well is not known.
- Use this PC's network address, not 127.0.0.1 (see the Rapsodo entry for why).
- Voice Caddie has no connection to GSPro of its own.

Sources:

- <https://github.com/springbok/MLM2PRO-GSPro-Connector/releases>: Release notes: the Voice Caddie SC4 device
- <https://gsprogolf.com/>: Voice Caddie is not on GSPro's supported list

### TruGolf Apogee

**Community / unofficial.** Models: TruGolf Apogee. Catalogue id: `trugolf-apogee`.

Connector: [MLM2PRO-GSPro-Connector (device: TruGolf Apogee Apex)](https://github.com/springbok/MLM2PRO-GSPro-Connector) (GPL-3.0).

You need:

- TruGolf's own software showing its numbers on this PC's screen

Steps:

1. Open TruGolf's software with its numbers on screen.
2. Start MLM2PRO-GSPro-Connector: device TruGolf Apogee.
3. In Settings type the IP address and port shown here.
4. Mark the numbers on screen as its guide shows.
5. Press Connect, then hit a ball.

Settings to enter (ADDRESS is this PC's network address (the wizard shows it)):

| Setting | Value |
| --- | --- |
| IP Address | `ADDRESS` |
| Port | `921` |

Notes:

- Untested here. The connector reads the numbers off the screen.
- Use this PC's network address, not 127.0.0.1 (see the Rapsodo entry for why).

Sources:

- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/settings.py>: Source: the TruGolf Apogee device entries
- <https://gsprogolf.com/>: TruGolf Apogee is not on GSPro's supported list

### ProTee VX

**Community / unofficial.** Models: ProTee VX. Catalogue id: `protee-vx`.

Connector: [VX Connector](https://github.com/zonkey-acoustic/vx-connector) (MIT (per its README)).

You need:

- ProTee Labs with an activated ProTee VX on this PC

Steps:

1. Close GSPro if it is open.
2. Install VX Connector, then start it.
3. Right-click its icon by the clock: Switch to OpenAPI Compatible.
4. Start ProTee Labs.
5. In ProTee Labs: Game Options, Game: GSPro, then Connect.
6. Dismiss the "no longer supported" warning. Shots still arrive.

Other connectors:

- [VX Bridge](https://github.com/devigned/vx-bridge) (MIT). Forwards ProTee Labs shots to Infinite Tees or to GSPro's OpenAPI Connect application, for a licensed copy of either on the same PC. Whether it will send to this game was not checked.

Notes:

- Untested here. VX Connector says it sends to any sim that takes GSPro Open API shots on port 921 of this PC, which is what this game listens for. It lists other sims as tested, not this one.
- On its download page take VxConnectorSetup.exe. Windows will say it protected your PC: More info, then Run anyway.
- It always sends to port 921 on this PC: leave the game's port at 921.
- Unofficial, and not supported by ProTee. It runs a copy of itself named GSPconnect.exe, because ProTee Labs only connects when a program of that name is running; some antivirus products flag that.
- ProTee Labs itself stopped sending Open API shots in 2026 and its own interface for other games is closed, so there is no official way in.
- The game ticks a step when it sees the program running. The name ProTee Labs runs under was not checked: if its step does not tick, press NEXT.

Sources:

- <https://github.com/zonkey-acoustic/vx-connector>: README: OpenAPI Compatible mode sends to port 921; the steps in ProTee Labs; the GSPconnect.exe copy
- <https://github.com/devigned/vx-bridge>: README: forwards to Infinite Tees or GSPro OpenAPI on the same PC
- <https://csc.protee-united.com/hc/en-us/articles/10194104166684-ProTee-Labs-Changelog>: ProTee Labs changelog: GSPro OpenAPI no longer supported (1.11.11); a closed "ProTee Link" connector for other games *(a report, not confirmed)*
- <https://golfsimulatorforum.com/forum/protee-golf-simulator/protee-launch-monitors/399370-protee-vx-and-gspro?p=419004>: Forum: a user's report of the "no longer supported" message

### FlightScope X3 / X2 / Mevo (original)

**Not supported yet.** Models: X3, X3C, X2, Mevo (original). Catalogue id: `flightscope-x3`.

No connector was found that sends these units' shots as Open Connect. GSPro reaches the X2 and X3 through its own private FlightScope connection; FlightScope says the original Mevo does not support simulator courses, and opens the X3C to approved integrators only.

Sources:

- <https://flightscope.com/faqs/main>: FlightScope FAQ: original Mevo and simulation; X3C and third-party software
- <https://gsprogolf.com/>: GSPro's supported list (X2, X3 through its own integration)

### OpenLaunch NOVA

**Not supported yet.** Models: OpenLaunch NOVA. Catalogue id: `openlaunch-nova`.

The NOVA reaches GSPro through GSPro's own built-in connection, which cannot be pointed at this game. It is the best candidate for a direct connection, though: OpenLaunch publishes a local API (JSON over TCP and WebSocket, found on the network automatically) with an Apache-2.0 developer guide. See the roadmap.

Sources:

- <https://github.com/OpenLaunchLabs/nova-developer-guide>: OpenLaunch's developer guide: the local API
- <https://gspro.gitbook.io/gspro-knowledge-base/troubleshooting-and-support/how-to-clear-gspro-connect-settings.md>: Nova Open Launch is its own interface inside GSPro Connect

### OptiShot Nova / BallFlight / Orbit

**Not supported yet.** Models: OptiShot Nova, OptiShot BallFlight, OptiShot Orbit. Catalogue id: `optishot`.

OptiShot's units run OptiShot's own Orion software. No connector was found that sends their shots to GSPro or as Open Connect, and they are not on GSPro's supported list. (The Nova on GSPro's list is OpenLaunch's, a different product.)

Sources:

- <https://prnewswire.com/news-releases/optishot-golf-unveils-nova-the-ultimate-made-in-america-golf-simulator-302124765.html>: OptiShot's announcement: Nova runs Orion; no third-party software named
- <https://gsprogolf.com/>: No OptiShot product on GSPro's supported list

### Golfzon WAVE

**Not supported yet.** Models: Golfzon WAVE. Catalogue id: `golfzon-wave`.

No connector was found that sends the WAVE's shots to GSPro or as Open Connect, and it is not on GSPro's supported list.

Sources:

- <https://gsprogolf.com/>: Golfzon is not on GSPro's supported list
- <https://thegolfwire.com/trugolf-golfzon>: The WAVE works with E6 Connect (not Open Connect) *(a report, not confirmed)*

### GolfJoy GDS / GR / Spica

**Not supported yet.** Models: GolfJoy GDS Pro (GDS Plus), GolfJoy GR2, GolfJoy GR3, GolfJoy GR3 Pro, GolfJoy Spica 3. Catalogue id: `golfjoy`.

GolfJoy units reach GSPro through GSPro's own built-in connection over a fixed private network link, which cannot be pointed at this game. GolfJoy had an Open API route before that; whether it still works is not known.

Sources:

- <https://www.golfjoy.com/pages/gspro-native-support-for-golfjoy-launch-monitors>: GolfJoy's guide to the native GSPro connection
- <https://gspro.gitbook.io/gspro-knowledge-base/troubleshooting-and-support/how-to-clear-gspro-connect-settings.md>: GolfJoy is its own interface inside GSPro Connect

### VTrack

**Not supported yet.** Models: VTrack. Catalogue id: `vtrack`.

VTrack reaches GSPro through GSPro's own built-in connection, started from VTrack's toolkit. How its shots travel is not documented, and no connector was found that sends them as Open Connect.

Sources:

- <https://swingcraft.golf/vtrack-setup/>: The VTrack setup guide: launches GSPro from VTrackToolkit
- <https://gspro.gitbook.io/gspro-knowledge-base/troubleshooting-and-support/how-to-clear-gspro-connect-settings.md>: VTrack is its own interface inside GSPro Connect

### Bluetees RAINMAKER

**Not supported yet.** Models: Bluetees RAINMAKER. Catalogue id: `bluetees-rainmaker`.

The RAINMAKER reaches GSPro through GSPro's own built-in connection (paired with a PIN), which cannot be pointed at this game.

Sources:

- <https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/bluetees-rainmaker-connection-guide.md>: GSPro's Rainmaker connection guide

### Ernest Sports ES16 / ES Tour Plus

**Not supported yet.** Models: Ernest Sports ES16, Ernest Sports ES Tour Plus. Catalogue id: `ernest-sports`.

No connector was found that sends these units' shots to GSPro or as Open Connect, and they are not on GSPro's supported list.

Sources:

- <https://gsprogolf.com/>: Ernest Sports is not on GSPro's supported list

## Mine is not listed

1. Close GSPro if it is open: both use the same port.
2. Start your launch monitor's GSPro connector.
3. Look for its GSPro or Open API address setting.
4. Type the address and port shown here.
5. Connect, then hit a ball.

| Setting | Value |
| --- | --- |
| IP address | `127.0.0.1` when the connector runs on this PC, else this PC's network address |
| Port | `921` |

- This game answers on the port GSPro's Open API uses. A connector that sends shots to GSPro's Open API, and has no other tie to GSPro, can send them here.
- Connector on this PC: the address is 127.0.0.1. Connector on another device: use this PC's network address, and let the game through Windows Firewall.
- Connections that live inside GSPro itself (its built-in Uneekor, FlightScope, Garmin, Rapsodo, Full Swing and similar modes) do not use the Open API and cannot be pointed here.

Sources:

- <https://gsprogolf.com/GSProConnectV1.html>: GSPro Open Connect v1: TCP, port 921, 127.0.0.1, no authentication

## When it does not connect

`GET /api/connect/status` (and the wizard's status light) names the likely cause:

| What you see | Why | What to do |
| --- | --- | --- |
| CLOSE GSPRO / ANOTHER PROGRAM IS USING PORT 921 | GSPro, or another simulator, is open: it answers on the same port. The game says which program when Windows tells it. | Close it. The game takes the port by itself within a few seconds: no restart. |
| WAITING FOR YOUR CONNECTOR | The port is open and nothing has connected. | Start the connector and press its Connect button. Check its address and port against the wizard's. |
| NOTHING HAS CONNECTED YET (a connector on another device) | Windows Firewall is the usual reason: the game cannot see that directly, so this is a likely cause, not a detected one. | Windows Security > Firewall > Allow an app through firewall: tick Private for the game. Check the connector has this PC's network address, not 127.0.0.1. |
| THE CONNECTOR DISCONNECTED | The connector closed, crashed or lost its network. | Start it again, or press Connect in it. |
| CONNECTED, BUT NO SHOT YET | The connector is talking to the game but the launch monitor is not sending shots. | In the connector, check the launch monitor shows as connected and ready; check the unit itself is ready. |
| THAT LOOKS WRONG (after the test ball) | The numbers are not a golf shot: usually units. A speed about half of what you expect means metres per second. | Start the game with `BIRDIE_SPEED_SCALE=2.23694`, or fix the unit in the connector. |
| The MLM2PRO connector says "GSPRO API Window Not Found" | With a local address it looks for GSPro's own window first. | Give it this PC's network address instead of 127.0.0.1. |

## Open Connect conformance

The specification is <https://gsprogolf.com/GSProConnectV1.html>. It gives one example message and three reply codes; it says nothing about framing, heartbeats, units or when the player information is sent. What real connectors send and expect was read from their source. Only protocol facts were taken, never code.

| Connector | Licence | What matters to a server |
| --- | --- | --- |
| [MLM2PRO-GSPro-Connector](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 | No heartbeat. Waits 2 s for any reply to a shot, sends the same payload once more, then disconnects. Reads Player.Club of every 201. Spells BackSpin "Backspin". Looks for GSPro's window when the address is local. |
| [gsp-r10-adapter](https://github.com/mholow/gsp-r10-adapter) | MIT | One heartbeat on connect with "APIVersion", ShotNumber 0 and null BallData. Strict reply parsing: Code a number, Club from a fixed list, Handed RH or LH. Two replies in one read must be back to back with nothing between. |
| [gspro-garmin-connect-v2](https://github.com/travislang/gspro-garmin-connect-v2) | MIT (package.json) | No Units key. One reply object per read. Target fixed at 127.0.0.1:921. |
| [PiTrac](https://github.com/PiTracLM/PiTrac) | GPL-2.0 | Pretty-printed objects with a newline after each. A heartbeat (ShotNumber 0, ready, ball detected) on connect and on change. Putter mode on Club PT. |
| [OpenFlight](https://github.com/open-flight/openflight) | AGPL-3.0-or-later | A heartbeat every 5 s when idle, with zeroed ball data present. Applies the Club of every 201. Resends a shot after a dropped link. |
| [squaregolf-connector (read through a fork)](https://github.com/patrickhult/squaregolf-connector) | MIT | Newline after each object. A ready status after connecting, with false flags left out. Ball data and club data of one shot as two messages. Acts on the exact Message text "GSPro Player Information". |
| [MLM2PRO-BT-APP](https://github.com/Duwaynef/MLM2PRO-BT-APP) | MIT | Keys spelled DeviceId, ApiVersion, Hla, Vla. Reads replies split on newlines only: two objects in one read are both lost. Arms the launch monitor on a 201 unless its DistanceToTarget is 0. Sends misreads with a speed of 0. |
| [GSPro4OSP](https://github.com/OpenSkyPlus/GSPro4OSP) | custom, not open source (facts only) | Arms the launch monitor only on a 201 whose DistanceToTarget is not 0. |
| [golfsim-connect](https://github.com/chgl42/golfsim-connect) | MIT or Apache-2.0 | Waits up to 1.5 s for a reply to everything it sends. A reply whose Message contains "heartbeat" is not counted as a shot's. |

Gaps found in `lib/openconnect.js` and fixed (`test/openconnect-conformance.test.js` holds a case for each connector above):

| Gap | Fix |
| --- | --- |
| Keys were matched exactly, so "Hla" / "Vla" / "Backspin" / "DeviceId" / "APIVersion" were not read: a shot from such a connector arrived with no launch angles. | Every key of the specification is matched without regard to case; numbers sent as strings are read as numbers. |
| A real shot that also carried IsHeartBeat: true was thrown away as a heartbeat. | Ball data with a speed is a shot, whatever else is flagged. |
| A "shot" with a speed of 0 (a misread) was passed on to the game. | Acknowledged with a 200, never played (event: ignored). |
| Club data sent on its own after the ball data was treated as a status message, which switched the ready light off. | Acknowledged, reported as its own event (club), and the ready state is left alone. |
| The ready and ball-detected flags were read from status messages only; most connectors send them on heartbeats. | Read from heartbeats as well. |
| After the greeting, a 201 carried only what had changed, so most had no Club. One connector reads Player.Club of every 201; others treat a missing club as a change of club. | Every 201 is the whole player (Handed, Club, DistanceToTarget). OpenFlight, which applies every Club it is sent, still gets only what changed. |
| A 201 could carry DistanceToTarget 0 (the greeting always did). Two connectors read that as "GSPro is in its menus" and do not arm the launch monitor. | DistanceToTarget is always a whole number of at least 1. |
| A club the game could not express as a GSPro code went out as typed; connectors with a fixed list of codes drop the whole message. | Anything off GSPro's list goes to its nearest code (AW to GW, a loft to its wedge, a 1-wood to DR). |
| Two replies could leave in the same instant (the greeting and the first distance update, an acknowledgement and a player update). Connectors that read one object per packet lose both. | One object per write, at least 75 ms apart; player updates waiting in line are merged. |
| A stray closing brace or other noise between objects wedged the stream until 64 KB had gone by. | Anything between objects is skipped. |
| After "port in use" the server could not be started again without restarting the game. | start() can be called again; the game retries by itself every 3 seconds and reports the state. |

Open questions, not changed:

- The exact Message text of GSPro's 200 reply is not in the specification. The game sends "Shot received successfully" (the specification's description of code 200); two connectors' sources suggest GSPro says "Ball Data received". No connector that was read depends on it.
- Whether GSPro answers heartbeats is disputed. The game does ("Heartbeat OK"); no connector that was read is harmed by it.
- Codes 202 ("GSPro ready") and 203 ("GSPro round ended") are not in the specification and are not sent.
- The game sends Club PT only when the player picks the putter. Connectors that switch a launch monitor into a putting mode on PT (Square, PiTrac, the MLM2PRO connector's webcam putting) are therefore never told that the ball is on the green.
- Units "Meters" is not handled: ball speed is taken as mph whatever Units says. BIRDIE_SPEED_SCALE corrects a connector that sends metres per second.
- The game accepts more than one connector at a time; GSPro reportedly accepts one.

## Direct connections: roadmap

*Could we build a tool similar to GSPro Connect?*

Yes, in part. GSPro Connect is a set of device drivers: for each launch monitor it knows how to find the unit and read its shots. An open-source project can do the same for units whose protocol is published or already has an open-source implementation, and for the open-source launch monitors. It cannot for units that sit behind a maker's SDK licence, an NDA or encryption. Two things are worth knowing first. One: an open-source tool of this kind already exists. flighthook (MIT / Apache-2.0) talks to the Mevo+ family, the Garmin R10 and the Square Omni directly and forwards their shots as an Open Connect client to any address, so working with it is cheaper than rebuilding it. Two: the game's Foresight bridge already is a direct connection of the modest kind, built from what the maker's own connector does in the open.

Recommended order. No device driver has been written yet.

| # | Family | Realistic for an open-source project | Approach |
| --- | --- | --- | --- |
| 1 | Uneekor (EYE XO, XO2, EYE MINI, EYE MINI LITE, QED) | yes | The VIEW watcher that already ships with the game: test it, then show its status in the game |
| 2 | PiTrac and OpenFlight (open-source launch monitors) | yes | Nothing to build: test and document |
| 3 | OpenLaunch NOVA | yes | A built-in reader of its published local API |
| 4 | Garmin Approach R10 | yes | A local listener for the Garmin Golf app's E6 Connect setting (TCP 2483), later Bluetooth |
| 5 | Webcam putting | yes | A local HTTP listener for cam-putting-py (port 8888) |
| 6 | Foresight GC2 | maybe | Read the GC2's text protocol over USB or a Bluetooth serial port |
| 7 | FlightScope Mevo+ / Mevo Gen2 / Xi | maybe | Use flighthook; a built-in driver only if it proves necessary |
| 8 | Square Omni | maybe | Use flighthook; a built-in Bluetooth driver later |
| 9 | Rapsodo MLM2PRO | no | Stay with the community connectors |
| 10 | SkyTrak / SkyTrak+ | no | Stay with OpenSkyPlus |
| 11 | Foresight GC3 / GCQuad / GCHawk / Bushnell Launch Pro (direct) | no | Stay with the Foresight bridge |
| 12 | Garmin R50, Full Swing KIT, TrackMan, ProTee VX, GolfJoy, VTrack, TruGolf, Uneekor (direct to the unit) | no | None |

**1. Uneekor (EYE XO, XO2, EYE MINI, EYE MINI LITE, QED).** The code exists in this project (tools/uneekor-watch.js, MIT): it follows VIEW's ShotData folder, and the desktop game starts it when that folder is on the PC. No protocol work, no SDK. Missing: one Uneekor owner to confirm units and left/right, and a status panel in SETTINGS > LAUNCH MONITOR like the Foresight bridge has.

- <https://github.com/jordan-shilts/Open-Birdie/blob/main/tools/uneekor-watch.js>

**2. PiTrac and OpenFlight (open-source launch monitors).** Both already send Open Connect to a typed address. The work is a test on real hardware with their communities, which moves them to Tested.

- <https://docs.pitrac.org/software/simulator-integration/>
- <https://github.com/open-flight/openflight/blob/main/docs/using/simulator/gspro.md>

**3. OpenLaunch NOVA.** OpenLaunch documents a receive-only local API: JSON over TCP and WebSocket, found by mDNS. The developer guide and examples are Apache-2.0. Port numbers and the message schema still have to be read from the guide.

- <https://github.com/OpenLaunchLabs/nova-developer-guide>

**4. Garmin Approach R10.** Two open-source connectors (gsp-r10-adapter, MIT; gspro-garmin-connect-v2, MIT per its package.json) accept the Garmin Golf app's E6 Connect stream on TCP 2483: a network listener, no Bluetooth code. Direct Bluetooth is also implemented in the open (gsp-r10-adapter, flighthook) but needs a Bluetooth stack in the game.

- <https://github.com/mholow/gsp-r10-adapter>
- <https://github.com/travislang/gspro-garmin-connect-v2>
- <https://github.com/divotmaker/flighthook>

**5. Webcam putting.** cam-putting-py (GPL-3.0; protocol facts only) posts each putt as JSON to http://127.0.0.1:8888/putting. Accepting that gives every launch monitor that cannot read putts a putter.

- <https://github.com/alleexx/cam-putting-py>

**6. Foresight GC2.** The GC2 sends plain KEY=value text (SHOT_ID, SPEED_MPH, ELEVATION_DEG, AZIMUTH_DEG, SPIN_RPM, BACK_RPM, SIDE_RPM). Two open projects show it, neither with a licence file, so a reader has to be written from the protocol facts. Needs serial or USB access from the game and a GC2 owner to test.

- <https://github.com/ParnoldAlmer/GSPro-gc2-API-Interface>
- <https://github.com/matthew-johnston/gspro-gc2-connector>

**7. FlightScope Mevo+ / Mevo Gen2 / Xi.** The protocol (binary, TCP 5100 on the Mevo's own Wi-Fi) is reverse-engineered in ironsight (Rust, MIT or Apache-2.0, pre-1.0) and used by flighthook. A port to this game is possible but fragile against firmware updates; neither project may be used to unlock paid features.

- <https://github.com/Apollo66666/ironsight>
- <https://github.com/divotmaker/flighthook>

**8. Square Omni.** The Omni's Bluetooth protocol is implemented in allsquare (Rust, MIT or Apache-2.0). Needs a Bluetooth stack in the game. The older Square Home connector's repository was taken down after a copyright claim: do not build on it.

- <https://github.com/divotmaker/allsquare>
- <https://github.com/github/dmca/blob/master/2026/09/2026-09-03-source-code.md>

**9. Rapsodo MLM2PRO.** Open implementations exist (GPL-3.0 and MIT), but each needs a token from Rapsodo's online service and third-party access switched on in Rapsodo's app. A built-in driver would depend on that service and its terms.

- <https://raw.githubusercontent.com/springbok/MLM2PRO-GSPro-Connector/main/src/bluetooth/mlm2pro_device.py>
- <https://github.com/Duwaynef/MLM2PRO-BT-APP>

**10. SkyTrak / SkyTrak+.** No SDK and no open implementation of the wire protocol. The only route is a closed-source plug-in that loads inside SkyTrak's own app.

- <https://openskyplus2.github.io/OpenSkyPlus2/FAQs-OpenSkyPlus2.html>

**11. Foresight GC3 / GCQuad / GCHawk / Bushnell Launch Pro (direct).** No public SDK and no open protocol. Foresight's SDK is licensed to partners. The bridge, which uses the owner's own GSPro connector, is the way in.

- <https://gsprogolf.com/terms-of-service.html>
- `docs/foresight-bridge.md`

**12. Garmin R50, Full Swing KIT, TrackMan, ProTee VX, GolfJoy, VTrack, TruGolf, Uneekor (direct to the unit).** Private links to GSPro Connect, partner credentials or encryption (R50, as reported), SDKs under NDA (TruGolf, as reported), or nothing published at all. Garmin's Golf API is for selected partners and carries a licence fee.

- <https://developer.garmin.com/golf-api/overview/>
- <https://forums.garmin.com/outdoor-recreation/golf/f/approach-r50/401156/approach-r50-and-gspro-on-mac-crossover/2020877>
- <https://hackaday.io/project/195042/log/229245>

- Not on the roadmap, on purpose: taking GSPro's connector apart, speaking its private protocol, or using keys taken from it. GSPro's terms forbid reverse engineering and unauthorised methods of interacting with its services.
- A connector launcher is cheaper than any driver: the wizard could start the chosen community connector with the right address already filled in.

## For developers

### The catalogue

`lib/launch-monitors.json` is the data, self-contained (the README and the website read the same file); `lib/launch-monitors.js` is its loader and shape check. Per device: `id`, `brand`, `name`, `models`, `tier` (`tested` / `expected` / `community` / `unsupported`), `route` (`open-connect` / `foresight-bridge` / `none`), `address` (`local`: the connector runs on this PC; `lan`: it is given this PC's network address), `connector` (`name`, `url`, `license`), `alternatives`, `needs`, `steps` (each at most 64 characters: they are read from the hitting mat), `settings` (`label`, `value` with `{address}` and `{port}`), `notes`, `sources` (`url`, `note`, `confirmed`), and `why` when it is not supported. Also `generic` (the instructions for a connector that is not listed), `conformance` and `roadmap`, which this document prints.

After changing it: `node tools/arcade-dev/launch-monitors-doc.mjs --write`. `test/launch-monitors.test.js` fails while this file is stale.

### Endpoints (`lib/connect.js`)

| Route | Answer |
| --- | --- |
| `GET /api/launch-monitors` | The catalogue (`tiers`, `brands`, `devices`, `generic`) plus `port` (this server's Open Connect port), `addresses` (this PC's IPv4 addresses, `[{ address, name, private }]`, likeliest first), `lanAddress`, `localAddress`, `chosen` (the saved choice or null). |
| `GET /api/connect/status` | Everything about the connection in one call, below. Also sent as the `connect` event on `/events` whenever it changes. |
| `POST /api/connect/device { id }` | Remember the chosen launch monitor: a catalogue id, `other` (not listed) or `none` (no launch monitor). `null` forgets it. Kept in `<data dir>/launch-monitor.json`. Answers the status. |
| `POST /api/connect/probe { on }` | Hold swings for the wizard's test ball: while on, every swing (launch monitor or `/api/test-shot`) is shown in the status (`probe.shot`) and played in no game, not recorded in the bag. Lets go by itself after 2 minutes unless renewed. Answers the status. |

```js
// GET /api/connect/status
{ ok: true, now, port: 921,
  state: 'blocked' | 'waiting' | 'connected' | 'ready',     // the status light
  connected, source: 'open-connect' | 'foresight' | null, ready,
  listener: { state: 'starting' | 'listening' | 'port-in-use' | 'error', listening, holder: 'loopback' | 'wildcard' | null,
              holderName: 'GSPconnect' | null, error, since },   // holderName: the program on the port (Windows)
  clients: [{ address, local, deviceId, connectedAt, lastMessageAt, messages, shots, heartbeats }],
  everConnected, connectedAt, lastDisconnectAt, lastMessageAt,
  shots, lastShot: { seq, at, source, device, speedMph, vla, hla, totalSpin, spinAxis, check: { ok, issues: [{ id, text }] } },
  foresight: { state, mode, active, idleReason, port, connections, shots, lastShotAt, lastError } | null,   // the bridge (docs/foresight-bridge.md)
  chosen: true, device: { id, name, brand, tier, route, address } | null, chosenAt,
  probe: { on, shot: <like lastShot> | null },
  addresses, lanAddress,
  cause: { id, title, help } | null }   // the likely reason nothing is connected, or nothing is arriving
```

`cause.id`: `port-in-use`, `port-error`, `starting`, `no-connector`, `firewall`, `dropped`, `no-shots`, and for the Foresight route `foresight-off`, `foresight-port`, `foresight-no-connector`, `foresight-error`, `foresight-waiting`.

At boot the hub first checks whether another program already answers on `127.0.0.1` at the port (GSPro's Open API does): Windows would otherwise let the game listen on every address and still hand the local connections to the other program, with no error at all. A taken port is reported, retried every 3 seconds and taken over without a restart.

### The wizard (`public/arcade/connect.js`, `connect.css`)

```js
import { ConnectWizard } from './arcade/connect.js';

const wizard = new ConnectWizard({ root, fetchJson, audio, events, onDone });
wizard.dispose();

ConnectWizard.overlay({ fetchJson, audio, events, onDone });   // full screen over any page
```

- `root`: the element it fills. `fetchJson(url, opts) -> Promise<json | null>` (default: `fetch`).
- `audio`: the `ArcadeAudio` or null. Only `audio?.cue?.('ui-tick' | 'ui-confirm' | 'ui-back')`, one sound per action, never a loop.
- `events`: the page's `EventSource` on `/events` (optional): it follows the `connect` event, and asks for the status every 1.5 s as well.
- `onDone({ device, connected, tested })`: called once, when the player leaves the last screen. `css: false` if the page links `arcade/connect.css` itself.
- Keys (taken while it is mounted): arrows choose, Enter selects, Esc or Backspace goes back. Mouse works too.
- The flow is a pure state machine (`reduce(state, action, catalogue)`, exported with `initialState`, `buttonsOf`, `lightOf`, `shotText`), tested under Node in `test/connect-wizard.test.mjs`.

Screens: **SELECT YOUR LAUNCH MONITOR** (brands, then models, each with its tier; I DON'T HAVE ONE; MINE ISN'T LISTED), **GET CONNECTED** (that device's steps one at a time, the values to type, the status light, the Foresight bridge's panel for a Foresight unit), **HIT A BALL** (waits for one real shot and shows its speed, launch, direction and spin: "WE SEE YOU: 142 MPH", with a "that looks wrong" hint when the numbers are not a golf shot), **YOU'RE OFF TO THE RACES** (on to the main menu). A unit that is not supported gets a screen that says why and offers test swings.

### The first-run rule

The wizard is due when `GET /api/connect/status` answers `chosen: false` and `connected: false`. Choosing anything in it (a device, MINE ISN'T LISTED, I DON'T HAVE ONE) posts `/api/connect/device`, so `chosen` is true from then on and the wizard does not come back by itself; SETTINGS > LAUNCH MONITOR runs it again. The shell (`public/arcade/shell.js`) mounts it on its `connect` screen, which is a menu screen, so swings are already dropped there; the wizard holds its own test ball as well (`/api/connect/probe`), so it also works with no shell around it (`?connect=1` on the simulator opens it as an overlay).

### Trying it with no hardware

```
node tools/arcade-dev/fake-connector.mjs --port <the server's Open Connect port> --shot-after 10
```

connects like a real connector, says the monitor is ready, sends heartbeats and one specification-shaped shot. `--port` is required: it must never be pointed at a game somebody is playing.
