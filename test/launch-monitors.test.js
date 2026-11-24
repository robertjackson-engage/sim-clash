'use strict';
// v2:connect The launch-monitor catalogue (lib/launch-monitors.json) and the document
// generated from it (docs/launch-monitors.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const lm = require('../lib/launch-monitors');

const { CATALOGUE } = lm;
const ROOT = path.join(__dirname, '..');

test('the catalogue is sound: every entry has a tier, steps, sources, and says how it connects', () => {
  assert.deepEqual(lm.problems(), []);
  assert.ok(CATALOGUE.devices.length >= 25, 'the launch monitors a sim owner is likely to have');
  for (const d of CATALOGUE.devices) {
    assert.ok(lm.TIER_IDS.includes(d.tier), `${d.id}: tier`);
    assert.ok(d.steps.length >= 1 && d.steps.every((s) => s.length <= lm.STEP_MAX), `${d.id}: steps short enough to read from the mat`);
    assert.ok(d.sources.length >= 1, `${d.id}: at least one source`);
  }
});

test('ids are unique, and never one of the reserved choices', () => {
  const ids = CATALOGUE.devices.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('none') && !ids.includes('other'));
  assert.equal(lm.choice('none').route, 'none');
  assert.equal(lm.choice('other').route, 'open-connect');
  assert.equal(lm.choice('no-such-thing'), null);
});

test('nothing untested is presented as tested', () => {
  const tested = CATALOGUE.devices.filter((d) => d.tier === 'tested').map((d) => d.id);
  assert.deepEqual(tested, ['foresight-gcquad'], 'one rig has been hit with: the developer\'s GCQuad, through the bridge');
  for (const d of CATALOGUE.devices.filter((x) => x.tier === 'expected' || x.tier === 'community')) {
    assert.ok(d.notes.some((n) => /untested|not tested/i.test(n)), `${d.id} says it is untested`);
    assert.ok(d.connector && /^https:\/\//.test(d.connector.url), `${d.id} names and links its connector`);
    assert.ok(d.sources.some((s) => s.confirmed), `${d.id} rests on at least one confirmed source`);
  }
  for (const d of CATALOGUE.devices.filter((x) => x.tier === 'unsupported')) assert.ok(d.why.length > 40, `${d.id} says why`);
});

test('the problems check catches a broken entry', () => {
  const bad = JSON.parse(JSON.stringify(CATALOGUE));
  bad.devices[1].id = bad.devices[0].id;                        // a duplicate id
  bad.devices[2].sources = [];                                  // no source
  bad.devices[3].steps = ['x'.repeat(lm.STEP_MAX + 1)];         // a step too long to read
  bad.devices[4].tier = 'probably';                             // not a tier
  const found = lm.problems(bad).join('\n');
  assert.match(found, /used twice/);
  assert.match(found, /no source/);
  assert.match(found, /a step longer/);
  assert.match(found, /unknown tier/);
});

test('this PC\'s addresses: home networks first, never loopback or link-local', () => {
  const list = lm.lanAddresses({
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.48.1', internal: false }],
    Ethernet: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '10.0.0.12', internal: false }],
    'Wi-Fi': [{ family: 4, address: '192.168.1.40', internal: false }],
    Odd: [{ family: 'IPv4', address: '169.254.10.10', internal: false }],
  });
  assert.deepEqual(list.map((a) => a.address), ['192.168.1.40', '10.0.0.12', '172.20.48.1']);
  assert.equal(lm.addressFor({ address: 'lan' }, list), '192.168.1.40');
  assert.equal(lm.addressFor({ address: 'local' }, list), '127.0.0.1');
  assert.equal(lm.addressFor({ address: 'lan' }, []), '127.0.0.1', 'no network: nothing better to offer');
  assert.equal(lm.fill('{address}:{port}', { address: '10.0.0.12', port: 921 }), '10.0.0.12:921');
});

test('what the page is served carries this server\'s port and addresses', () => {
  const out = lm.forClient({ port: 9968, addresses: [{ address: '192.168.1.40', name: 'Wi-Fi', private: true }] });
  assert.equal(out.port, 9968);
  assert.equal(out.defaultPort, 921);
  assert.equal(out.lanAddress, '192.168.1.40');
  assert.equal(out.devices.length, CATALOGUE.devices.length);
  assert.ok(out.generic.steps.length >= 3);
});

test('docs/launch-monitors.md is in sync with the catalogue', async () => {
  const { render, DOC_FILE } = await import(pathToFileURL(path.join(ROOT, 'tools', 'arcade-dev', 'launch-monitors-doc.mjs')).href);
  const want = render(CATALOGUE);
  const have = fs.existsSync(DOC_FILE) ? fs.readFileSync(DOC_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
  assert.ok(have === want, 'docs/launch-monitors.md is stale: run  node tools/arcade-dev/launch-monitors-doc.mjs --write');
  assert.match(want, /## Direct connections: roadmap/);
  for (const d of CATALOGUE.devices) assert.ok(want.includes(`\`${d.id}\``), `${d.id} is in the document`);
});
