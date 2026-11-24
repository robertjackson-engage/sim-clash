# The Foresight bridge (experimental)

Foresight GC launch monitors (GCQuad, GC3, GCHawk, Bushnell Launch Pro) do not speak GSPro
Open Connect. They reach GSPro through a connector program that ships inside a GSPro
installation: `GSPconnect.exe`, by default in `C:\GSProV1\Core\GSPC`. This feature lets
that connector feed the game instead, with no third-party bridge program in between.

It is built into the game (`lib/foresight-bridge.js`, pure Node, no dependencies) and is
labelled **experimental** everywhere it shows.

## What the player needs

- A Foresight GC unit and **their own GSPro installation and licence**. The connector is
  part of GSPro and signs in with the owner's GSPro licence. The game does not include the
  connector, does not modify it, and does not write anything into the GSPro folder.
- GSPro itself **closed** while playing this game (both want the same local port).
- Nothing else: no extra program to install or start.

To play: start the game, open the Foresight connector (GSPconnect), connect the launch
monitor in it as you would for GSPro, hit a ball.

## How it works

The connector does two things the game can use:

1. It dials **TCP 127.0.0.1:9050** and stays connected. It expects something to listen
   there (normally GSPro).
2. For every shot it appends three lines to its own log, `ConnectDebug.txt`, in its folder:

   ```
   2026-11-22 21:24:48,360 [1] INFO  VGPconnect.ForesightForm [(null)] - Sending Shot
   2026-11-22 21:24:48,383 [1] INFO  VGPconnect.ForesightForm [(null)] - Logging ball data IMMEDIATELY before sending to GSPro
   2026-11-22 21:24:48,387 [1] INFO  VGPconnect.ForesightForm [(null)] - [53.5074539,5.214206,26.1026459,1337.0,2574.40649,2200.0,31.28819,0.0]
   ```

   The bracket is: ball speed (mph), vertical launch (deg), horizontal launch (deg), side
   spin (rpm), total spin (rpm), back spin (rpm), spin axis (deg), and a trailing 0. A putt
   is the same with a low speed and zero launch and spin. A value the unit could not read
   is written as the string `"NaN"`.

So the bridge has two halves:

- **The listener** accepts the connector on 127.0.0.1:9050 and holds the connection open
  with TCP keep-alive. It reads and discards whatever the connector sends and **never
  writes**: what the connector sends on that socket, and whether it wants an answer, is not
  known, and holding the connection has been enough. It accepts any number of connections
  and never closes one itself (the connector logs a read error when its connection is
  closed from the other side, so the bridge is careful not to).
- **The log reader** follows `ConnectDebug.txt` and turns each shot into an Open Connect
  shaped message:

  ```js
  { DeviceID: 'Foresight (GSPconnect)', Units: 'Yards', ShotNumber: n, APIversion: '1',
    BallData: { Speed, SpinAxis, TotalSpin, BackSpin, SideSpin, HLA, VLA },   // units as logged
    ClubData: null,
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false } }
  ```

  The values go straight through (speed in mph, angles in degrees, spin in rpm, signs as
  logged). That mapping is the one that has been playing correctly in this game; do not
  "fix" a sign. A spin or angle logged as `"NaN"` becomes 0; a bracket with no speed is not
  a shot.

In `server.js` the message is handed to the Open Connect server's own `shot` handler, so a
bridge shot takes **the same path** as a shot that arrived on TCP 921: the same validation,
the same menu / solo / match gates, the same bag recording. The result carries
`source: 'foresight'` (an Open Connect shot: `'open-connect'`; a test shot: none).

### Reading the log safely

- The file is opened read-only, for the length of one read, about seven times a second
  (file-change events are unreliable for a file another program holds open).
- A log that exists when the bridge starts is entered **at its end**: old shots are never
  replayed.
- A shot is the marker line ("Sending Shot" / "Logging ball data ...") followed by the
  bracket. The bracket may arrive in a later read; a line still being written is kept until
  its newline arrives; a bracket with no marker just before it (within 12 lines and 5
  seconds) is ignored. UTF-8 with or without a byte order mark, CRLF or LF.
- The same shot is never played twice: the same log line read again, or the same numbers
  logged again within 3 seconds, is counted as a duplicate.
- The connector's log rolls over every day (the old file becomes
  `ConnectDebug.txt.YYYY-MM-DD` and a new one starts) and may be recreated or truncated when
  the connector restarts. The reader notices when the file got shorter than its position,
  when its first bytes changed, or when it went away and came back, and reads the new file
  from its start. Shots such a file already held that are more than two minutes old are
  history, not swings: they are skipped (`stale` in the status).
- A missing log, or a missing connector folder, is waited for.

### The port

Only one program can serve the connector. If something else is listening on port 9050
(GSPro, or another bridge), the game does **not** fail: the bridge reports `port-in-use`
and tries again every 3 seconds, so closing the other program is all it takes.

Windows lets a second program bind `127.0.0.1:9050` while another one listens on every
address (`0.0.0.0` or `::`), and then hands the loopback connections to the newcomer. That
would quietly take the connector away from a running GSPro. The bridge therefore checks
for such a listener first and stands back if there is one.

While the bridge holds the port, GSPro cannot get the connector: close the game (or switch
the bridge off) before playing GSPro.

Whoever has the port has the shots. While another program holds it, the bridge still reads
the log but **plays nothing** (the status counts those shots as `unowned`): either GSPro is
being played, or another bridge is already sending the same shots to the game's Open
Connect port, and playing them here too would count every swing twice.

### One swing, one stroke

As a second line of defence, `server.js` drops a shot whose numbers match the previous
shot from the *other* road (Open Connect vs. the bridge) within 10 seconds, logging
`[foresight] the same swing came again by ...: already played`. That covers an old bridge
program left running next to this one. `BIRDIE_SPEED_SCALE` (for metric Open Connect
monitors) is not applied to bridge shots: the connector's log is always in mph.

## The setting

`foresight`: `auto` (default) | `on` | `off`, kept with an optional log path in
`<data dir>/foresight.json`. It is changed in the game under **SETTINGS > LAUNCH MONITOR**
(the simulator: the menu drawer, LAUNCH MONITOR).

| Mode | Behaviour |
| --- | --- |
| `auto` | The bridge comes up at boot when the connector's folder is on this PC. On a second copy of the game running on private ports (anything but HTTP 8222 and Open Connect 921) it stays down, so a developer's or a test's instance never takes the connector's port. |
| `on` | Always up. If the folder or the log is not there yet, it waits for them. |
| `off` | Down: the port is not touched, the log is not read. |

The connector's folder is looked for in this order; the first that exists wins:
`BIRDIE_FORESIGHT_LOG` (a file, for tests), the path set in the panel (the folder, or the
log file itself), `BIRDIE_GSPCONNECT_DIR` (a folder), `C:\GSProV1\Core\GSPC`.

Environment:

| Variable | Meaning |
| --- | --- |
| `BIRDIE_FORESIGHT` | `auto` / `on` / `off`: overrides the saved mode for this run (the panel says so) |
| `BIRDIE_FORESIGHT_PORT` | the port to listen on (default 9050; tests use 9051) |
| `BIRDIE_FORESIGHT_LOG` | the log file to follow |
| `BIRDIE_GSPCONNECT_DIR` | the connector's folder, when GSPro is not in `C:\GSProV1` |
| `BIRDIE_FORESIGHT_DEBUG=1` | append what the connector sends on the socket, as hex, to `<data dir>/foresight-socket.log` (capped at 256 KB). Off by default: nobody knows what is in it, so treat the file as private and delete it when done. |

## Status

`GET /api/foresight` answers, and the page's event stream sends as the `foresight` event on
every change:

```js
{ ok: true, experimental: true, source: 'foresight',
  mode: 'auto' | 'on' | 'off', modeFrom: 'saved' | 'env',
  active: true,                    // the bridge is running
  idleReason: null | 'off' | 'no-connector' | 'private-instance',
  state: 'off' | 'starting' | 'listening' | 'connector-connected' | 'port-in-use' | 'no-log' | 'error',
  host: '127.0.0.1', port: 9050, listening: true,
  connections: 1, connectsTotal: 1, bytesReceived: 0,
  portHolder: null | 'loopback' | 'wildcard',     // who has the port when it is in use
  logFile, logDir, dirFound, logFound, logFrom: 'env' | 'setting' | 'env-dir' | 'default', savedLogFile,
  shots: 3, duplicates: 0, ignored: 0, invalid: 0, stale: 0, unowned: 0, rollovers: 0,
  //   shots: played; duplicates: the same shot seen again; ignored: a bracket with no marker;
  //   invalid: no ball speed; stale: old shots in a new file; unowned: logged while another program had the port
  lastShotAt: 1795411488387, lastShot: { Speed, SpinAxis, TotalSpin, BackSpin, SideSpin, HLA, VLA },
  lastError: null, since }
```

| State | Meaning | What the panel says |
| --- | --- | --- |
| `off` | not running (mode off, or auto on a private copy) | Off |
| `listening` | the port is ours, no connector yet | Open the Foresight connector (GSPconnect) and connect your launch monitor |
| `connector-connected` | the connector is connected | Connector found, waiting for a shot; then the last shot's time |
| `port-in-use` | another program has the port; retrying | Close GSPro or any other bridge: something else is using port 9050 |
| `no-log` | the connector's folder is not there | Connector folder not found (auto: no Foresight connector on this PC) |
| `error` | the port could not be opened for another reason | the error |

`POST /api/foresight { mode?, logFile? }` changes the setting and answers the new status
(`logFile`: the connector's folder or its `ConnectDebug.txt`; `''` forgets it; a bad value:
400 `BAD_SETTING`). Sending the same values again changes nothing, and changing only the
log path leaves the listener, and the connector on it, alone.

The launch-monitor status the page already shows (`lm` event) covers the bridge too:
`{ connected, ready, source: 'open-connect' | 'foresight' | null, foresight: <state> }`.
`connected` is true when an Open Connect client is connected or the connector is on the
bridge.

## The panel (`public/arcade/foresight-panel.js`)

A self-contained module for the settings screen: status in plain words, the last shot's
time, the auto / on / off switch, and under Details the port, the log path, a field for
the connector's folder and the terms note. Classes are prefixed `fb-`; sizes are in `em`,
so it takes the font size of its container. No sound.

```js
import { mountForesightPanel } from './arcade/foresight-panel.js';

const panel = mountForesightPanel(container, { fetchJson, events });
panel.update(status);   // push a status yourself (optional)
panel.refresh();        // ask the server now
panel.dispose();        // stop (it also stops by itself once its container has left the page)
```

- `fetchJson(url, opts) -> Promise<json | null>` (default: `fetch`).
- `events`: the page's `EventSource` on `/events`; the panel follows its `foresight` event.
  Without it the panel asks the server every 4 seconds.
- `css: false` if you link `arcade/foresight-panel.css` yourself (otherwise the module adds
  the link once).
- Also exported: `describeForesight(status) -> { tone, title, help, last }` for drawing the
  status in your own markup, and `agoText(ms)`.

Mounted today in the game's **SETTINGS > LAUNCH MONITOR** screen (`shell.js`,
`[data-sc-mount="foresight"]`) and in the simulator's menu drawer (`#foresight-panel`).
`/arcade/foresight-demo.html` shows the live panel and every state on one page, with no 3D
and no sound.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Close GSPro or any other bridge: something else is using port 9050" | Close GSPro, or the other bridge program. The game takes the port by itself within a few seconds. |
| "Waiting for the connector" and it stays | Open GSPconnect (it is inside the GSPro folder) and connect the launch monitor in it. If the connector was already open before another program let go of the port, restart the connector. |
| "Connector found, waiting for a shot" but shots do not arrive | Check the connector shows the launch monitor as connected and ready. Look under Details: the log path must be the `ConnectDebug.txt` in the connector's own folder. If GSPro is installed somewhere other than `C:\GSProV1`, set the connector folder there. |
| "Connector folder not found" | GSPro is not installed in the default place: set the folder that holds `GSPconnect.exe` under Details. |
| The connector shows an error after the game was closed | Expected: closing the game closes the connection. Start the game, then restart the connector if it does not reconnect by itself. |
| Shots arrive twice | They should not (duplicates are counted in the status). Make sure no other bridge is also forwarding the same connector to the game's Open Connect port. |
| Auto does nothing on a second copy of the game | By design (private ports). Choose On. |

The server log says what the bridge is doing: `[foresight] listening for the Foresight
connector on 127.0.0.1:9050; reading ...`, `[foresight] connector connected (1); waiting
for a shot`, `[foresight] shot: 152.4 mph, VLA ...`, `[foresight] port 9050 is in use ...`.

## Interoperability and terms (the note for the README)

> **Foresight GC support is experimental.** To use a Foresight GC launch monitor the game
> works with the connector that comes with GSPro (GSPconnect). You need your own GSPro
> installation and licence for that: the connector is GSPro's, and the game neither
> includes nor modifies it. All the game does is listen on a local port on your own PC and
> read a log file that your own software writes there. This feature is not affiliated with,
> endorsed by or supported by Foresight Sports or GSPro, and it may stop working when the
> connector changes. Please check that your GSPro terms allow this use before you rely on it.

The bridge is original code, written from the connector's observable behaviour (its log
file and the fact that it connects to a local port). It contains no code from GSPro, from
the connector, or from any third-party bridge.

## What is known, and what is not

Known (from the connector's own log files on a real GCQuad set-up, more than 5,000 logged
shots): the three-line shot format, always in that order; the daily rollover; the `"NaN"`
form of an unread spin; that the connector reads from its socket and logs an error when the
connection is closed from the other side; that shots went on after such an error without a
connector restart being logged.

Not known: what the connector sends on the socket and whether it ever needs a reply (the
bridge sends none); whether every connector version reconnects by itself after a dropped
connection; whether the connector writes its log in the same format for every Foresight
model and every GSPro version. Club data is not in the log, so the game gets ball data only.

## Tests and the live test

`node --test test/foresight-bridge.test.js`: the parser against lines copied from a real
log (`test/fixtures/foresight`), the log reader on real files (split lines, rollover,
truncation, a file that appears later, CRLF and LF), the listener on real sockets (holds a
connection, garbage, resets, a taken port and recovery, the every-address check), the
mapping, the setting, the panel's words, and an end-to-end run through a game server in
the same process with a fake connector on TCP 9051. None of it touches port 9050 or a real
GSPro folder.

The real connector has not been driven by this code yet. To test it live:

1. Close the game, GSPro, any other bridge program and GSPconnect, and do not start the old
   bridge program again: the game does its job now. Nothing should be listening on TCP 9050 (`Get-NetTCPConnection -LocalPort 9050 -State Listen` prints
   nothing).
2. Start the game from this build on its normal ports. The server log should say
   `[foresight] listening for the Foresight connector on 127.0.0.1:9050; reading
   C:\GSProV1\Core\GSPC\ConnectDebug.txt`. SETTINGS > LAUNCH MONITOR shows "Waiting for the
   connector".
3. Start GSPconnect and connect the launch monitor. Within a few seconds the log says
   `[foresight] connector connected (1); waiting for a shot`, the panel says "Connector
   found, waiting for a shot", and the monitor light in the corner turns on with FORESIGHT.
4. Hit a full shot and a putt. Each must appear once: `[foresight] shot: ...` in the log,
   the ball in the game, the numbers matching the connector's own display; the panel shows
   "Last shot just now". `GET /api/foresight` must show `shots` going up by one per swing
   and `duplicates`, `ignored`, `stale`, `unowned` at 0.
5. Leave it connected for ten minutes without hitting, then hit again: the connection must
   still be there (no new "connector connected" line, no error in `ConnectDebug.txt`).
6. The hand-over: close the game and GSPconnect, start GSPro (or the old bridge program),
   then start the game. The panel must say "Port 9050 is busy" and the log `[foresight]
   port 9050 is in use ...`, and the game must play on as normal (with the old bridge
   program its shots still arrive through Open Connect, once each). Close the other program:
   within a few seconds the log says `listening` and the panel "Waiting for the
   connector". Start GSPconnect again and hit a ball.
7. Optional, once: start the game with `BIRDIE_FORESIGHT_DEBUG=1`, connect, hit two shots,
   and look at `<data dir>/foresight-socket.log` to learn what the connector sends. Delete
   the file afterwards.
