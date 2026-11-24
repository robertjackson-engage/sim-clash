#!/usr/bin/env node
// v2:connect A stand-in for a launch monitor's connector: it connects to the game's Open
// Connect port the way a real one does and sends specification-shaped messages
// (https://gsprogolf.com/GSProConnectV1.html). For trying the connection wizard and the
// status endpoint with no hardware.
//
//   node tools/arcade-dev/fake-connector.mjs --port 9968                 connect, say "ready", stay 60 s
//   ... --shot-after 5                    hit one ball 5 s after connecting (repeat the flag for more)
//   ... --speed 142 --vla 13.5 --hla 1.2 --spin 2800 --axis -3          that ball's numbers
//   ... --stay 30                         seconds to stay connected (default 60)
//   ... --no-ready                        never say the monitor is ready
//   ... --mps                             send the speed in metres per second (a wrong-units connector)
//   ... --host 192.168.1.20               default 127.0.0.1
//
// --port is required on purpose: 921 is the live game's port, and this tool must never
// send a ball into somebody's match by accident.

import net from 'node:net';

const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const opt = (name, def) => { const v = all(name); return v.length ? v[v.length - 1] : def; };
const flag = (name) => args.includes(`--${name}`);

const port = Number(opt('port', NaN));
if (!Number.isInteger(port) || port <= 0) {
  console.error('fake-connector: --port <the game\'s Open Connect port> is required (a private test server: its BIRDIE_OC_PORT)');
  process.exit(2);
}
const host = opt('host', '127.0.0.1');
const stay = Number(opt('stay', 60));
const shotTimes = all('shot-after').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const speedMph = Number(opt('speed', 142.3));
const ball = {
  Speed: flag('mps') ? Math.round(speedMph / 2.23694 * 10) / 10 : speedMph,
  SpinAxis: Number(opt('axis', -3.1)), TotalSpin: Number(opt('spin', 2850)),
  HLA: Number(opt('hla', 1.2)), VLA: Number(opt('vla', 13.4)),
};
ball.BackSpin = Math.round(ball.TotalSpin * Math.cos(ball.SpinAxis * Math.PI / 180));
ball.SideSpin = Math.round(ball.TotalSpin * Math.sin(ball.SpinAxis * Math.PI / 180));

let shotNumber = Math.floor(Date.now() / 1000) % 100000;   // never the number of an earlier run
const message = (options, withBall) => ({
  DeviceID: 'Fake Connector 1.0', Units: 'Yards', ShotNumber: withBall ? ++shotNumber : 0, APIversion: '1',
  BallData: withBall ? { ...ball, CarryDistance: 0 } : { Speed: 0, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: 0, VLA: 0, CarryDistance: 0 },
  ClubData: { Speed: 0, AngleOfAttack: 0, FaceToTarget: 0, Lie: 0, Loft: 0, Path: 0, SpeedAtImpact: 0, VerticalFaceImpact: 0, HorizontalFaceImpact: 0, ClosureRate: 0 },
  ShotDataOptions: { ContainsBallData: !!withBall, ContainsClubData: false, LaunchMonitorIsReady: !flag('no-ready'), LaunchMonitorBallDetected: !flag('no-ready'), IsHeartBeat: false, ...options },
});

const sock = net.connect(port, host);
sock.setNoDelay(true);
const send = (obj, what) => { sock.write(JSON.stringify(obj)); console.log(`-> ${what}`); };
sock.on('connect', () => {
  console.log(`connected to ${host}:${port}`);
  send(message({ IsHeartBeat: true }, false), 'heartbeat (ready)');
  const beat = setInterval(() => send(message({ IsHeartBeat: true }, false), 'heartbeat'), 5000);
  for (const t of shotTimes) setTimeout(() => send(message({}, true), `shot #${shotNumber}: ${ball.Speed} ${flag('mps') ? 'm/s' : 'mph'}, VLA ${ball.VLA}, HLA ${ball.HLA}, spin ${ball.TotalSpin}`), t * 1000);
  setTimeout(() => { clearInterval(beat); console.log('done'); sock.end(); }, stay * 1000);
});
sock.on('data', (c) => console.log(`<- ${c.toString('utf8')}`));
sock.on('error', (e) => { console.error(`fake-connector: ${e.message}`); process.exit(1); });
sock.on('close', () => process.exit(0));
