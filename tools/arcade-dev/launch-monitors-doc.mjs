#!/usr/bin/env node
// v2:connect docs/launch-monitors.md is generated from lib/launch-monitors.json, so the game,
// the README, the website and the documentation never disagree about a launch monitor.
//
//   node tools/arcade-dev/launch-monitors-doc.mjs --write    write docs/launch-monitors.md
//   node tools/arcade-dev/launch-monitors-doc.mjs --check    exit 1 when the file is stale
//   node tools/arcade-dev/launch-monitors-doc.mjs            print it
//
// test/launch-monitors.test.js runs the same check, so a change to the catalogue without
// --write fails the tests.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOC_FILE = path.join(ROOT, 'docs', 'launch-monitors.md');

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const link = (text, url) => (/^https:/.test(url) ? `[${text}](${url})` : `\`${url}\``);
const source = (s) => `${/^https:/.test(s.url) ? `<${s.url}>` : `\`${s.url}\``}: ${s.note}${s.confirmed ? '' : ' *(a report, not confirmed)*'}`;
const fullName = (brand, name) => (String(name).toLowerCase().startsWith(String(brand).toLowerCase()) ? name : `${brand} ${name}`);
const fill = (text, port) => String(text).replace(/\{address\}/g, 'ADDRESS').replace(/\{port\}/g, String(port));

function deviceSection(d, cat) {
  const brand = cat.brands.find((b) => b.id === d.brand);
  const tier = cat.tiers.find((t) => t.id === d.tier);
  const out = [];
  out.push(`### ${fullName(brand ? brand.name : d.brand, d.name)}`, '');
  out.push(`**${tier.name}.** Models: ${d.models.join(', ')}. Catalogue id: \`${d.id}\`.`, '');
  if (d.tier === 'unsupported') {
    out.push(d.why, '');
  } else {
    out.push(`Connector: ${link(d.connector.name, d.connector.url)} (${d.connector.license}).`, '');
    if ((d.needs || []).length) out.push('You need:', '', ...d.needs.map((n) => `- ${n}`), '');
    out.push('Steps:', '', ...d.steps.map((s, i) => `${i + 1}. ${s}`), '');
    if ((d.settings || []).length) {
      const which = d.address === 'lan' ? 'ADDRESS is this PC\'s network address (the wizard shows it)' : 'ADDRESS is `127.0.0.1` (the connector runs on this PC)';
      out.push(`Settings to enter (${which}):`, '', '| Setting | Value |', '| --- | --- |', ...d.settings.map((s) => `| ${cell(s.label)} | \`${cell(fill(s.value, cat.port))}\` |`), '');
    }
    if ((d.alternatives || []).length) out.push('Other connectors:', '', ...d.alternatives.map((a) => `- ${link(a.name, a.url)} (${a.license}). ${a.note || ''}`.trim()), '');
  }
  if ((d.notes || []).length) out.push('Notes:', '', ...d.notes.map((n) => `- ${n}`), '');
  out.push('Sources:', '', ...d.sources.map((s) => `- ${source(s)}`), '');
  return out;
}

/** The whole document, from the catalogue (lib/launch-monitors.json as loaded). */
export function render(cat) {
  const L = [];
  const brandName = (id) => (cat.brands.find((b) => b.id === id) || { name: id }).name;
  L.push('# Launch monitors', '');
  L.push('<!-- GENERATED from lib/launch-monitors.json by tools/arcade-dev/launch-monitors-doc.mjs. Do not edit by hand:',
    '     change the catalogue (or the generator) and run  node tools/arcade-dev/launch-monitors-doc.mjs --write  -->', '');
  L.push(`Catalogue version ${cat.version}, checked ${cat.updated}.`, '');
  L.push('## In short', '');
  L.push(`The game listens on TCP port ${cat.port} and speaks GSPro Open Connect v1: it plays the part GSPro's "Open API" plays. A launch monitor's connector that sends shots to GSPro's Open API can send them to the game instead, when GSPro is closed. Foresight GC units do not speak Open Connect; they come in through the game's built-in Foresight bridge (\`docs/foresight-bridge.md\`).`, '');
  L.push('One thing decides most of this list. GSPro reaches most launch monitors through connections built into its own connector program (Uneekor, FlightScope, Garmin, Rapsodo, Full Swing, Square, ProTee and others each have their own mode there). Those do **not** use the Open API, and cannot be pointed at another program. Only three kinds of connector can feed this game: a maker\'s own Open API client, an open-source launch monitor\'s own, and community connectors.', '');
  L.push('Nothing here is presented as tested unless a ball has been hit with it on a real rig. Today that is one unit.', '');
  L.push('| Tier | Meaning |', '| --- | --- |', ...cat.tiers.map((t) => `| **${t.name}** | ${cell(t.blurb)} |`), '');

  L.push('## The list', '');
  for (const t of cat.tiers) {
    const list = cat.devices.filter((d) => d.tier === t.id);
    L.push(`### ${t.name} (${list.length})`, '');
    if (t.id === 'unsupported') {
      L.push('| Launch monitor | Why not |', '| --- | --- |', ...list.map((d) => `| ${cell(fullName(brandName(d.brand), d.name))} | ${cell(d.why)} |`), '');
    } else {
      L.push('| Launch monitor | Models | Comes in through | Licence of that connector |', '| --- | --- | --- | --- |',
        ...list.map((d) => `| ${cell(fullName(brandName(d.brand), d.name))} | ${cell(d.models.join(', '))} | ${cell(d.route === 'foresight-bridge' ? `the Foresight bridge and ${d.connector.name}` : link(d.connector.name, d.connector.url))} | ${cell(d.connector.license)} |`), '');
    }
  }

  L.push('## Connecting each one', '');
  L.push('The game\'s connection wizard shows the same steps, with this PC\'s address filled in and a live status light. It runs the first time the game starts and again from SETTINGS > LAUNCH MONITOR.', '');
  for (const t of cat.tiers) for (const d of cat.devices.filter((x) => x.tier === t.id)) L.push(...deviceSection(d, cat));

  const g = cat.generic;
  L.push('## Mine is not listed', '');
  L.push(...g.steps.map((s, i) => `${i + 1}. ${s}`), '');
  L.push('| Setting | Value |', '| --- | --- |', `| IP address | \`127.0.0.1\` when the connector runs on this PC, else this PC's network address |`, `| Port | \`${cat.port}\` |`, '');
  L.push(...g.notes.map((n) => `- ${n}`), '');
  L.push('Sources:', '', ...g.sources.map((s) => `- ${source(s)}`), '');

  L.push('## When it does not connect', '');
  L.push('`GET /api/connect/status` (and the wizard\'s status light) names the likely cause:', '');
  L.push('| What you see | Why | What to do |', '| --- | --- | --- |');
  L.push(`| CLOSE GSPRO / ANOTHER PROGRAM IS USING PORT ${cat.port} | GSPro, or another simulator, is open: it answers on the same port. The game says which program when Windows tells it. | Close it. The game takes the port by itself within a few seconds: no restart. |`);
  L.push('| WAITING FOR YOUR CONNECTOR | The port is open and nothing has connected. | Start the connector and press its Connect button. Check its address and port against the wizard\'s. |');
  L.push('| NOTHING HAS CONNECTED YET (a connector on another device) | Windows Firewall is the usual reason: the game cannot see that directly, so this is a likely cause, not a detected one. | Windows Security > Firewall > Allow an app through firewall: tick Private for the game. Check the connector has this PC\'s network address, not 127.0.0.1. |');
  L.push('| THE CONNECTOR DISCONNECTED | The connector closed, crashed or lost its network. | Start it again, or press Connect in it. |');
  L.push('| CONNECTED, BUT NO SHOT YET | The connector is talking to the game but the launch monitor is not sending shots. | In the connector, check the launch monitor shows as connected and ready; check the unit itself is ready. |');
  L.push('| THAT LOOKS WRONG (after the test ball) | The numbers are not a golf shot: usually units. A speed about half of what you expect means metres per second. | Start the game with `BIRDIE_SPEED_SCALE=2.23694`, or fix the unit in the connector. |');
  L.push('| The MLM2PRO connector says "GSPRO API Window Not Found" | With a local address it looks for GSPro\'s own window first. | Give it this PC\'s network address instead of 127.0.0.1. |');
  L.push('');

  const c = cat.conformance;
  L.push('## Open Connect conformance', '');
  L.push(`The specification is <${c.spec}>. It gives one example message and three reply codes; it says nothing about framing, heartbeats, units or when the player information is sent. What real connectors send and expect was read from their source. Only protocol facts were taken, never code.`, '');
  L.push('| Connector | Licence | What matters to a server |', '| --- | --- | --- |', ...c.connectors.map((x) => `| ${link(x.name, x.url)} | ${cell(x.license)} | ${cell(x.facts)} |`), '');
  L.push('Gaps found in `lib/openconnect.js` and fixed (`test/openconnect-conformance.test.js` holds a case for each connector above):', '');
  L.push('| Gap | Fix |', '| --- | --- |', ...c.fixed.map((x) => `| ${cell(x.gap)} | ${cell(x.fix)} |`), '');
  L.push('Open questions, not changed:', '', ...c.open.map((x) => `- ${x}`), '');

  const r = cat.roadmap;
  L.push('## Direct connections: roadmap', '');
  L.push('*Could we build a tool similar to GSPro Connect?*', '');
  L.push(r.answer, '');
  L.push('Recommended order. No device driver has been written yet.', '');
  L.push('| # | Family | Realistic for an open-source project | Approach |', '| --- | --- | --- | --- |', ...r.items.map((x) => `| ${x.rank} | ${cell(x.family)} | ${x.realistic} | ${cell(x.approach)} |`), '');
  for (const x of r.items) {
    L.push(`**${x.rank}. ${x.family}.** ${x.what}`, '', ...x.sources.map((u) => `- ${/^https:/.test(u) ? `<${u}>` : `\`${u}\``}`), '');
  }
  L.push(...r.notes.map((n) => `- ${n}`), '');

  L.push('## For developers', '');
  L.push('### The catalogue', '');
  L.push('`lib/launch-monitors.json` is the data, self-contained (the README and the website read the same file); `lib/launch-monitors.js` is its loader and shape check. Per device: `id`, `brand`, `name`, `models`, `tier` (`tested` / `expected` / `community` / `unsupported`), `route` (`open-connect` / `foresight-bridge` / `none`), `address` (`local`: the connector runs on this PC; `lan`: it is given this PC\'s network address), `connector` (`name`, `url`, `license`), `alternatives`, `needs`, `steps` (each at most 64 characters: they are read from the hitting mat), `settings` (`label`, `value` with `{address}` and `{port}`), `notes`, `sources` (`url`, `note`, `confirmed`), and `why` when it is not supported. Also `generic` (the instructions for a connector that is not listed), `conformance` and `roadmap`, which this document prints.', '');
  L.push('After changing it: `node tools/arcade-dev/launch-monitors-doc.mjs --write`. `test/launch-monitors.test.js` fails while this file is stale.', '');
  L.push('### Endpoints (`lib/connect.js`)', '');
  L.push('| Route | Answer |', '| --- | --- |');
  L.push('| `GET /api/launch-monitors` | The catalogue (`tiers`, `brands`, `devices`, `generic`) plus `port` (this server\'s Open Connect port), `addresses` (this PC\'s IPv4 addresses, `[{ address, name, private }]`, likeliest first), `lanAddress`, `localAddress`, `chosen` (the saved choice or null). |');
  L.push('| `GET /api/connect/status` | Everything about the connection in one call, below. Also sent as the `connect` event on `/events` whenever it changes. |');
  L.push('| `POST /api/connect/device { id }` | Remember the chosen launch monitor: a catalogue id, `other` (not listed) or `none` (no launch monitor). `null` forgets it. Kept in `<data dir>/launch-monitor.json`. Answers the status. |');
  L.push('| `POST /api/connect/probe { on }` | Hold swings for the wizard\'s test ball: while on, every swing (launch monitor or `/api/test-shot`) is shown in the status (`probe.shot`) and played in no game, not recorded in the bag. Lets go by itself after 2 minutes unless renewed. Answers the status. |');
  L.push('');
  L.push('```js', '// GET /api/connect/status',
    '{ ok: true, now, port: 921,',
    '  state: \'blocked\' | \'waiting\' | \'connected\' | \'ready\',     // the status light',
    '  connected, source: \'open-connect\' | \'foresight\' | null, ready,',
    '  listener: { state: \'starting\' | \'listening\' | \'port-in-use\' | \'error\', listening, holder: \'loopback\' | \'wildcard\' | null,',
    '              holderName: \'GSPconnect\' | null, error, since },   // holderName: the program on the port (Windows)',
    '  clients: [{ address, local, deviceId, connectedAt, lastMessageAt, messages, shots, heartbeats }],',
    '  everConnected, connectedAt, lastDisconnectAt, lastMessageAt,',
    '  shots, lastShot: { seq, at, source, device, speedMph, vla, hla, totalSpin, spinAxis, check: { ok, issues: [{ id, text }] } },',
    '  foresight: { state, mode, active, idleReason, port, connections, shots, lastShotAt, lastError } | null,   // the bridge (docs/foresight-bridge.md)',
    '  chosen: true, device: { id, name, brand, tier, route, address } | null, chosenAt,',
    '  probe: { on, shot: <like lastShot> | null },',
    '  addresses, lanAddress,',
    '  cause: { id, title, help } | null }   // the likely reason nothing is connected, or nothing is arriving',
    '```', '');
  L.push('`cause.id`: `port-in-use`, `port-error`, `starting`, `no-connector`, `firewall`, `dropped`, `no-shots`, and for the Foresight route `foresight-off`, `foresight-port`, `foresight-no-connector`, `foresight-error`, `foresight-waiting`.', '');
  L.push('At boot the hub first checks whether another program already answers on `127.0.0.1` at the port (GSPro\'s Open API does): Windows would otherwise let the game listen on every address and still hand the local connections to the other program, with no error at all. A taken port is reported, retried every 3 seconds and taken over without a restart.', '');
  L.push('### The wizard (`public/arcade/connect.js`, `connect.css`)', '');
  L.push('```js', 'import { ConnectWizard } from \'./arcade/connect.js\';', '',
    'const wizard = new ConnectWizard({ root, fetchJson, audio, events, onDone });',
    'wizard.dispose();', '',
    'ConnectWizard.overlay({ fetchJson, audio, events, onDone });   // full screen over any page', '```', '');
  L.push('- `root`: the element it fills. `fetchJson(url, opts) -> Promise<json | null>` (default: `fetch`).');
  L.push('- `audio`: the `ArcadeAudio` or null. Only `audio?.cue?.(\'ui-tick\' | \'ui-confirm\' | \'ui-back\')`, one sound per action, never a loop.');
  L.push('- `events`: the page\'s `EventSource` on `/events` (optional): it follows the `connect` event, and asks for the status every 1.5 s as well.');
  L.push('- `onDone({ device, connected, tested })`: called once, when the player leaves the last screen. `css: false` if the page links `arcade/connect.css` itself.');
  L.push('- Keys (taken while it is mounted): arrows choose, Enter selects, Esc or Backspace goes back. Mouse works too.');
  L.push('- The flow is a pure state machine (`reduce(state, action, catalogue)`, exported with `initialState`, `buttonsOf`, `lightOf`, `shotText`), tested under Node in `test/connect-wizard.test.mjs`.');
  L.push('');
  L.push('Screens: **SELECT YOUR LAUNCH MONITOR** (brands, then models, each with its tier; I DON\'T HAVE ONE; MINE ISN\'T LISTED), **GET CONNECTED** (that device\'s steps one at a time, the values to type, the status light, the Foresight bridge\'s panel for a Foresight unit), **HIT A BALL** (waits for one real shot and shows its speed, launch, direction and spin: "WE SEE YOU: 142 MPH", with a "that looks wrong" hint when the numbers are not a golf shot), **YOU\'RE OFF TO THE RACES** (on to the main menu). A unit that is not supported gets a screen that says why and offers test swings.', '');
  L.push('### The first-run rule', '');
  L.push('The wizard is due when `GET /api/connect/status` answers `chosen: false` and `connected: false`. Choosing anything in it (a device, MINE ISN\'T LISTED, I DON\'T HAVE ONE) posts `/api/connect/device`, so `chosen` is true from then on and the wizard does not come back by itself; SETTINGS > LAUNCH MONITOR runs it again. The shell (`public/arcade/shell.js`) mounts it on its `connect` screen, which is a menu screen, so swings are already dropped there; the wizard holds its own test ball as well (`/api/connect/probe`), so it also works with no shell around it (`?connect=1` on the simulator opens it as an overlay).', '');
  L.push('### Trying it with no hardware', '');
  L.push('```', 'node tools/arcade-dev/fake-connector.mjs --port <the server\'s Open Connect port> --shot-after 10', '```', '');
  L.push('connects like a real connector, says the monitor is ready, sends heartbeats and one specification-shaped shot. `--port` is required: it must never be pointed at a game somebody is playing.', '');
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { CATALOGUE } = require('../../lib/launch-monitors.js');
  const text = render(CATALOGUE);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(DOC_FILE, text);
    console.log(`wrote ${path.relative(ROOT, DOC_FILE)} (${text.split('\n').length} lines)`);
  } else if (process.argv.includes('--check')) {
    const have = fs.existsSync(DOC_FILE) ? fs.readFileSync(DOC_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
    if (have !== text) {
      console.error('docs/launch-monitors.md is stale: run  node tools/arcade-dev/launch-monitors-doc.mjs --write');
      process.exit(1);
    }
    console.log('docs/launch-monitors.md is up to date');
  } else process.stdout.write(text);
}
