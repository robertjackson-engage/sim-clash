// Where every shipped sound effect comes from, and how it is cut.
//
// Three kinds of source, all of them free to ship inside a game:
//   k:<pack>/<file>     Kenney.nl audio packs, Creative Commons Zero (CC0)
//   f:<sound id>        a freesound.org sound whose own page says Creative Commons 0
//   h:<group>/<name>    generated for this project in a Higgsfield account
// Nothing here is taken from a commercial game, a film or a broadcast.
//
// The source files are NOT in the repo: they are downloaded into .scratch/voice/downloads/
// (see docs/arcade-voice.md, "Sources"). `node tools/arcade-voice/import.mjs` cuts, layers,
// fades, levels and encodes them into public/arcade/sfx/, rewrites the manifest and
// CREDITS.md. To swap a sound: change its entry here and run the importer again.
//
// An entry:  clip(file, { lufs, keepS, fadeMs, fadeInMs }, ...layers)
//   file     '<cue>.mp3', '<cue>-2.mp3' (another take), '<cue>-hard.mp3' (a take for hard hits)
//   layer    L(source, { from, to, at, gain, rate, fadeOutMs })
//              from / to   seconds inside the source (default: its whole sounding part)
//              at          seconds into the result where this layer starts
//              gain        level against the other layers (each is first levelled alike)
//              rate        playback rate: above 1 is higher and shorter

export const PACKS_KENNEY = {
  'interface-sounds': { name: 'Kenney Interface Sounds', url: 'https://kenney.nl/assets/interface-sounds' },
  'ui-audio': { name: 'Kenney UI Audio', url: 'https://kenney.nl/assets/ui-audio' },
  'impact-sounds': { name: 'Kenney Impact Sounds', url: 'https://kenney.nl/assets/impact-sounds' },
  'casino-audio': { name: 'Kenney Casino Audio', url: 'https://kenney.nl/assets/casino-audio' },
  'digital-audio': { name: 'Kenney Digital Audio', url: 'https://kenney.nl/assets/digital-audio' },
  'rpg-audio': { name: 'Kenney RPG Audio', url: 'https://kenney.nl/assets/rpg-audio' },
};

// freesound.org sounds used (each page was read and says "Creative Commons 0").
export const FREESOUND = {
  372899: ['Quick Swhooshing Noise', 'FairhavenCollection'],
  388281: ['Single Swish', 'deleted_user_6479820'],
  850168: ['swoosh_bamboo_05', 'Evan_McLoud'],
  755054: ['Sound Design Elements Impact SFX PS 017', 'AudioPapkin'],
  812709: ['Sound Design Elements Impact SFX PS 043', 'AudioPapkin'],
  754771: ['Riser Hit sfx 097', 'AudioPapkin'],
  557113: ['FDP - Coin Flip 4', 'FirediesProductions'],
  181189: ['coin flip.wav', 'Raventhornn'],
  510735: ['Coin dropped on table 5', 'HoseNoseSounds'],
  763815: ['CRWDApls_Loud Applause, Cheering, Whistling (GSC24, XY-AKG214)', 'ShangusBurger'],
  763829: ['CRWDCheer_Cheering, Whistling, No Clapping (GSC24, XY-AKG214)', 'ShangusBurger'],
  763828: ['CRWDCele_Large Crowd, Unison Surprise, Cheering (GSC24, XY-AKG214)', 'ShangusBurger'],
  763830: ['CRWDCheer_Short Affirmative Cheer (GSC24, XY-AKG214)', 'ShangusBurger'],
  763881: ['CRWDReac_Excitement Build Up, Let Down (GSC24, XY-AKG214)', 'ShangusBurger'],
  763884: ['CRWDReac_Excitement Build Up, Let Down, Some Words (GSC24, XY-AKG214)', 'ShangusBurger'],
  763810: ['CRWDAngr_Crowd Groans At Bad Joke 02 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763877: ['CRWDReac_Crowd Groan In Disagreement (GSC24, XY-AKG214)', 'ShangusBurger'],
  763870: ['CRWDReac_Crowd Gasping In Surprise, Quick 04 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763869: ['CRWDReac_Crowd Gasping In Surprise, Quick 03 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763834: ['CRWDLaff_Crowd Laughing, Reaction 02 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763842: ['CRWDLaff_Short Hearty Laugh (GSC24, XY-AKG214)', 'ShangusBurger'],
  763812: ['CRWDApls_Loud Applause 01 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763882: ['CRWDReac_Excitement Build Up, Let Down, Recovery 01 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763883: ['CRWDReac_Excitement Build Up, Let Down, Recovery 02 (GSC24, XY-AKG214)', 'ShangusBurger'],
  763811: ['CRWDApls_Generic Applause (GSC24, XY-AKG214)', 'ShangusBurger'],
  233: ['timpaniroll01.wav', 'Erratic'],
  578574: ['Timpani Crescendo', 'nomiqbomi'],
  362206: ['horn_fail_wahwah_1.wav', 'TaranP'],
  876167: ['Soft Magic Spell Cast Whoosh (Fantasy RPG)', 'Assetsmith'],
  714563: ['Bewitched - Cursed Dark Magic Stinger', 'LilMati'],
  458398: ['Balloon Pop / Christmas cracker / Confetti Cannon', 'Breviceps'],
  622414: ['golf ball hits.wav', 'fluctuating_frequency'],
  707022: ['Golf shot.wav', 'MioMeg'],
  881085: ['Golf hit', 'packman01'],
  655867: ['Golf ball getting hit OWI.wav', 'Jarryd28'],
  593483: ['Driver hitting golf ball.wav', 'Scottrex05'],
  75207: ['Golf 13.wav', 'zolopher'],
  512505: ['Minigolf putt, right into the hole!', 'pfranzen'],
  718503: ['WATRImpt_Impact12_InMotionAudio_FREESampleSunday', 'InMotionAudio'],
  398039: ['water splash 2', 'swordofkings128'],
  440431: ['Splash_throw_2.wav', 'cribbler'],
  170235: ['Stove Water Sizzle', 'roachpowder'],
  703115: ['crush1.wav', 'franzzle'],
  340313: ['OsVaDuImDustImpact.wav', 'The_Sean_'],
  521377: ['Rocket Launch', 'Jarusca'],
  675773: ['S18-15a Fireworks rocket launching.wav', 'craigsmith'],
  22440: ['Single Heartbeat Clean HQ_BeatSmith.wav', 'Lunardrive'],
};

// Generated in a Higgsfield account (ElevenLabs Music v2.5). No reference audio.
export const GENERATED = {
  'music/stage-sting-orch': 'a single huge orchestral hit, title card stinger',
  'music/tee-off-brass': 'a short brass stab "go" sting',
  'music/sting-knockout-orch': 'a low brass and taiko knockout stinger',
  'music/fanfare-win': 'a brass and orchestra victory fanfare',
  'music/fanfare-hole': 'a short brass victory sting',
  'music/levelup': 'a short level-up jingle',
  'music/turn-chime': 'a two note bell chime',
};

const L = (src, o = {}) => ({ src, ...o });
const clip = (file, o, ...layers) => ({ file, ...o, layers });

export const IMPORTS = [
  // ───────────── the match setup flow: every touch has its own real sound ─────────────
  clip('ui-tick.mp3', { lufs: -27 }, L('k:interface-sounds/select_002')),
  clip('select-player.mp3', { lufs: -22 }, L('k:ui-audio/switch24')),
  clip('select-format.mp3', { lufs: -22 }, L('k:ui-audio/switch22')),
  clip('select-stage.mp3', { lufs: -21 }, L('k:ui-audio/switch11'), L('k:interface-sounds/switch_003', { gain: 0.7 })),
  clip('toggle-on.mp3', { lufs: -24 }, L('k:interface-sounds/toggle_001', { rate: 1.12 })),
  clip('toggle-off.mp3', { lufs: -24 }, L('k:interface-sounds/toggle_001', { rate: 0.84 })),
  clip('drawer-open.mp3', { lufs: -25 }, L('k:interface-sounds/maximize_006'), L('k:interface-sounds/open_002', { gain: 0.25 })),
  clip('drawer-close.mp3', { lufs: -25 }, L('k:interface-sounds/minimize_006'), L('k:interface-sounds/close_002', { gain: 0.25 })),
  clip('ui-back.mp3', { lufs: -25 }, L('k:interface-sounds/back_002')),
  clip('ui-error.mp3', { lufs: -23 }, L('k:interface-sounds/error_006')),
  clip('ui-confirm.mp3', { lufs: -23 }, L('k:interface-sounds/confirmation_001')),
  // a swish that lands in a thud: the match screen arriving
  clip('lobby-open.mp3', { lufs: -19, keepS: 1.4, fadeMs: 350 },
    L('f:372899', { gain: 0.9 }), L('f:755054', { to: 1.25, at: 0.22 })),
  // START: a confirm and a punch, then a rise that is cut at its peak (the VS slam answers it)
  clip('start-match.mp3', { lufs: -18, keepS: 1.2, fadeMs: 40 },
    L('k:interface-sounds/confirmation_002'), L('k:impact-sounds/impactPunch_heavy_000', { gain: 0.8 }),
    L('f:754771', { from: 0.2, to: 0.92, at: 0.06, gain: 0.9, fadeOutMs: 30 })),
  clip('vs-slam.mp3', { lufs: -17, keepS: 1.4, fadeMs: 400 },
    L('f:812709', { to: 1.45 }), L('k:impact-sounds/impactMetal_heavy_001', { gain: 0.7 })),
  clip('vs-slam-2.mp3', { lufs: -17, keepS: 1.4, fadeMs: 400 },
    L('f:755054', { to: 1.45 }), L('k:impact-sounds/impactMetal_heavy_003', { gain: 0.7 })),
  // a real coin: the thumb flick, then the ring of it spinning (about 1.2 s)
  clip('coin-flip.mp3', { lufs: -22, keepS: 1.25, fadeMs: 200 },
    L('f:557113', { from: 0, to: 0.35 }), L('f:181189', { from: 0, to: 1.15, at: 0.05, gain: 0.9, fadeOutMs: 200 })),
  // the coin slapping down and settling, then a short bright sting for the result
  clip('coin-land.mp3', { lufs: -20, keepS: 1.5, fadeMs: 250 },
    L('k:casino-audio/chip-lay-1', { gain: 0.6 }), L('f:510735', { from: 0.47, to: 1.6, at: 0.01 }),
    L('k:interface-sounds/confirmation_002', { at: 0.1, gain: 0.5 })),
  clip('stage-sting.mp3', { lufs: -18, keepS: 2.0, fadeMs: 500 }, L('h:music/stage-sting-orch')),
  clip('tee-off.mp3', { lufs: -18, keepS: 1.35, fadeMs: 350 }, L('h:music/tee-off-brass', { to: 1.75 })),
  clip('whoosh.mp3', { lufs: -23 }, L('f:372899')),
  clip('whoosh-2.mp3', { lufs: -23 }, L('f:388281')),
  clip('whoosh-3.mp3', { lufs: -23 }, L('f:850168')),

  // ───────────── the crowd: real recordings of a crowd session, short, faded ─────────────
  clip('crowd-roar.mp3', { lufs: -19, keepS: 3.6, fadeMs: 900, fadeInMs: 20 },
    L('f:763815', { from: 0.75, to: 4.4 }), L('f:763829', { from: 0.8, to: 4.4, gain: 0.7 })),
  clip('crowd-roar-2.mp3', { lufs: -19, keepS: 3.6, fadeMs: 900, fadeInMs: 20 }, L('f:763828', { from: 0.5, to: 4.15 })),
  clip('crowd-cheer.mp3', { lufs: -21, keepS: 2.7, fadeMs: 600, fadeInMs: 20 }, L('f:763830', { from: 0, to: 2.8 })),
  clip('crowd-cheer-2.mp3', { lufs: -21, keepS: 2.6, fadeMs: 700, fadeInMs: 25 }, L('f:763829', { from: 5.0, to: 7.7 })),
  clip('crowd-ohh.mp3', { lufs: -20, keepS: 2.3, fadeMs: 500, fadeInMs: 25 }, L('f:763881', { from: 2.55, to: 4.95 })),
  clip('crowd-ohh-2.mp3', { lufs: -20, keepS: 2.3, fadeMs: 500, fadeInMs: 25 }, L('f:763884', { from: 1.9, to: 4.3 })),
  clip('crowd-aww.mp3', { lufs: -21, keepS: 2.3, fadeMs: 500, fadeInMs: 25 }, L('f:763810', { from: 0.95, to: 3.35 })),
  clip('crowd-aww-2.mp3', { lufs: -21, keepS: 2.2, fadeMs: 500, fadeInMs: 25 }, L('f:763877', { from: 0.95, to: 3.25 })),
  clip('crowd-gasp.mp3', { lufs: -21, keepS: 1.3, fadeMs: 300, fadeInMs: 15 }, L('f:763870', { from: 0.6, to: 2.0 })),
  clip('crowd-gasp-2.mp3', { lufs: -21, keepS: 1.4, fadeMs: 300, fadeInMs: 15 }, L('f:763869', { from: 0.75, to: 2.25 })),
  clip('crowd-laugh.mp3', { lufs: -21, keepS: 2.5, fadeMs: 500, fadeInMs: 20 }, L('f:763834', { from: 0.4, to: 3.0 })),
  clip('crowd-laugh-2.mp3', { lufs: -21, keepS: 3.0, fadeMs: 600, fadeInMs: 20 }, L('f:763842', { from: 0.1, to: 3.3 })),
  clip('applause.mp3', { lufs: -21, keepS: 3.0, fadeMs: 800, fadeInMs: 20 }, L('f:763812', { from: 0.4, to: 3.6 })),
  clip('applause-2.mp3', { lufs: -21, keepS: 3.0, fadeMs: 800, fadeInMs: 20 }, L('f:763811', { from: 0.9, to: 4.0 })),
  // the rise as a rolling ball closes on the cup (the build-up half of the same reaction)
  clip('oooh.mp3', { lufs: -21, keepS: 2.1, fadeMs: 250, fadeInMs: 40 }, L('f:763881', { from: 1.2, to: 3.35 })),
  clip('oooh-2.mp3', { lufs: -21, keepS: 2.0, fadeMs: 250, fadeInMs: 40 }, L('f:763884', { from: 0.5, to: 2.6 })),

  // ───────────── anticipation: the gallery rising as the ball tracks at the hole ─────────────
  // The build-up half of recorded "excitement builds, then lets down" crowd reactions, in four
  // lengths. Each file climbs to its peak at peakS and keeps 0.4 s more: audio.anticipate()
  // lands the peak on the moment and audio.resolve() cuts it there (the payoff replaces it);
  // the 0.4 s is only heard, fading, if nobody resolves. A soft timpani crescendo sits under it.
  clip('crowd-rise-1s.mp3', { lufs: -21, peakS: 1.2, ramp: -14, exact: true, fadeInMs: 264, fadeMs: 300 },
    L('f:763881', { from: 1.95, to: 3.55, fadeOutMs: 5 }), L('f:578574', { from: 1.15, to: 2.38, at: 0.00, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-1s-2.mp3', { lufs: -21, peakS: 1.2, ramp: -14, exact: true, fadeInMs: 264, fadeMs: 300 },
    L('f:763884', { from: 1.50, to: 3.10, fadeOutMs: 5 }), L('f:578574', { from: 1.15, to: 2.38, at: 0.00, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-2s.mp3', { lufs: -21, peakS: 2, ramp: -14, exact: true, fadeInMs: 440, fadeMs: 300 },
    L('f:763881', { from: 1.15, to: 3.55, fadeOutMs: 5 }), L('f:578574', { from: 0.35, to: 2.38, at: 0.00, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-2s-2.mp3', { lufs: -21, peakS: 2, ramp: -14, exact: true, fadeInMs: 440, fadeMs: 300 },
    L('f:763884', { from: 0.70, to: 3.10, fadeOutMs: 5 }), L('f:578574', { from: 0.35, to: 2.38, at: 0.00, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-3s.mp3', { lufs: -21, peakS: 3, ramp: -14, exact: true, fadeInMs: 660, fadeMs: 300 },
    L('f:763882', { from: 4.90, to: 8.30, fadeOutMs: 5 }), L('f:578574', { from: 0.05, to: 2.38, at: 0.70, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-3s-2.mp3', { lufs: -21, peakS: 3, ramp: -14, exact: true, fadeInMs: 660, fadeMs: 300 },
    L('f:763883', { from: 7.30, to: 10.70, fadeOutMs: 5 }), L('f:578574', { from: 0.05, to: 2.38, at: 0.70, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-4s.mp3', { lufs: -21, peakS: 4.5, ramp: -14, exact: true, fadeInMs: 990, fadeMs: 300 },
    L('f:763882', { from: 3.40, to: 8.30, fadeOutMs: 5 }), L('f:578574', { from: 0.05, to: 2.38, at: 2.20, gain: 0.22, fadeOutMs: 60 })),
  clip('crowd-rise-4s-2.mp3', { lufs: -21, peakS: 4.5, ramp: -14, exact: true, fadeInMs: 990, fadeMs: 300 },
    L('f:763883', { from: 5.80, to: 10.70, fadeOutMs: 5 }), L('f:578574', { from: 0.05, to: 2.38, at: 2.20, gain: 0.22, fadeOutMs: 60 })),

  // ───────────── outcome stings and rewards ─────────────
  clip('drumroll.mp3', { lufs: -20, keepS: 2.5, fadeMs: 150 }, L('f:233', { from: 0, to: 2.5 })),
  clip('sting-knockout.mp3', { lufs: -17, keepS: 2.0, fadeMs: 400 },
    L('h:music/sting-knockout-orch', { to: 2.1 }), L('k:impact-sounds/impactBell_heavy_000', { at: 0.03, gain: 0.6 })),
  clip('sting-fail.mp3', { lufs: -20, keepS: 2.6, fadeMs: 500 }, L('f:362206', { from: 0.1, to: 2.7 })),
  clip('fanfare-win.mp3', { lufs: -17, keepS: 5.7, fadeMs: 600 }, L('h:music/fanfare-win', { to: 6.4 })),
  clip('fanfare-hole.mp3', { lufs: -18, keepS: 2.2, fadeMs: 400 }, L('h:music/fanfare-hole', { to: 2.3 })),
  clip('levelup.mp3', { lufs: -19, keepS: 2.4, fadeMs: 400 }, L('h:music/levelup', { to: 2.5 })),
  clip('turn-chime.mp3', { lufs: -23, keepS: 1.3, fadeMs: 400 }, L('h:music/turn-chime', { to: 1.4 })),
  clip('chest-open.mp3', { lufs: -20, keepS: 1.8, fadeMs: 350 },
    L('k:rpg-audio/metalLatch'), L('k:rpg-audio/doorOpen_1', { at: 0.1, gain: 0.9 }), L('k:interface-sounds/glass_004', { at: 0.75, gain: 0.6 })),
  clip('trick-cast.mp3', { lufs: -20, keepS: 1.3, fadeMs: 250 }, L('f:876167'), L('f:714563', { from: 0, to: 1.3, gain: 0.5 })),
  clip('coin-burst.mp3', { lufs: -21 }, L('k:rpg-audio/handleCoins')),
  clip('coin-burst-2.mp3', { lufs: -21 }, L('k:casino-audio/chips-handle-5')),
  clip('confetti-pop.mp3', { lufs: -20, keepS: 0.9, fadeMs: 200 }, L('f:458398'), L('k:casino-audio/card-fan-1', { at: 0.06, gain: 0.5 })),

  // ───────────── the physical game ─────────────
  // the club on the ball: the most-heard sound in the game. Four takes, and three heavier
  // ones (drivers) that play when the ball leaves fast.
  clip('strike.mp3', { lufs: -17 }, L('f:622414', { from: 0.42, to: 0.8 })),
  clip('strike-2.mp3', { lufs: -17 }, L('f:622414', { from: 1.62, to: 2.0 })),
  clip('strike-3.mp3', { lufs: -17 }, L('f:707022')),
  clip('strike-4.mp3', { lufs: -17 }, L('f:881085', { from: 1.15, to: 1.6 })),
  clip('strike-hard.mp3', { lufs: -16 }, L('f:655867', { from: 0.85, to: 1.5 })),
  clip('strike-hard-2.mp3', { lufs: -16 }, L('f:593483')),
  clip('strike-hard-3.mp3', { lufs: -16 }, L('f:75207')),
  // the ball going into the cup and rattling: the tail of a recorded putt
  clip('cup-drop.mp3', { lufs: -19, keepS: 1.15, fadeMs: 150 }, L('f:512505', { from: 0.86, to: 2.05 })),
  clip('flag-clank.mp3', { lufs: -20 }, L('k:impact-sounds/impactMetal_light_003')),
  clip('flag-clank-2.mp3', { lufs: -20 }, L('k:impact-sounds/impactMetal_light_000')),
  clip('green-thump.mp3', { lufs: -22 }, L('k:impact-sounds/impactSoft_medium_001')),
  clip('green-thump-2.mp3', { lufs: -22 }, L('k:impact-sounds/impactSoft_medium_004')),
  clip('fairway-bounce.mp3', { lufs: -21 }, L('k:impact-sounds/impactSoft_heavy_000')),
  clip('fairway-bounce-2.mp3', { lufs: -21 }, L('k:impact-sounds/impactSoft_heavy_003')),
  clip('sand-thud.mp3', { lufs: -21 }, L('k:impact-sounds/impactSoft_heavy_001'), L('f:340313', { from: 0, to: 0.6, gain: 0.35 })),
  clip('sand-thud-2.mp3', { lufs: -21 }, L('k:impact-sounds/impactSoft_heavy_004'), L('k:impact-sounds/footstep_snow_001', { gain: 0.5 })),
  clip('tree-knock.mp3', { lufs: -19 }, L('k:impact-sounds/impactWood_heavy_000'), L('k:impact-sounds/footstep_grass_002', { from: 0, to: 0.6, at: 0.05, gain: 0.3 })),
  clip('tree-knock-2.mp3', { lufs: -19 }, L('k:impact-sounds/impactWood_heavy_003'), L('k:impact-sounds/footstep_grass_004', { from: 0, to: 0.55, at: 0.05, gain: 0.3 })),
  clip('rough-rustle.mp3', { lufs: -23, fadeMs: 150 }, L('k:impact-sounds/footstep_grass_000', { from: 0, to: 0.7 })),
  clip('rough-rustle-2.mp3', { lufs: -23, fadeMs: 150 }, L('k:impact-sounds/footstep_grass_003', { from: 0, to: 0.62 })),
  clip('water-plunk.mp3', { lufs: -20, keepS: 1.2, fadeMs: 250 }, L('f:718503'), L('f:398039', { at: 0.03, gain: 0.8 })),
  clip('water-plunk-2.mp3', { lufs: -20, keepS: 1.2, fadeMs: 250 }, L('f:440431')),
  clip('lava-sizzle.mp3', { lufs: -20, keepS: 1.7, fadeMs: 500 }, L('f:718503', { gain: 0.9 }), L('f:170235', { from: 0, to: 1.75, at: 0.02 })),
  clip('ice-skid.mp3', { lufs: -21 }, L('f:703115'), L('k:impact-sounds/impactGlass_light_000', { gain: 0.5 })),
  clip('rocket.mp3', { lufs: -19, keepS: 1.4, fadeMs: 400 }, L('f:521377')),
  clip('rocket-2.mp3', { lufs: -19, keepS: 1.6, fadeMs: 500 }, L('f:675773', { from: 0, to: 1.7 })),
  // one rise that stops at its peak (a timpani crescendo): never looped
  clip('riser.mp3', { lufs: -20, keepS: 2.42, fadeMs: 60 }, L('f:578574', { from: 0, to: 2.44, fadeOutMs: 50 })),
  clip('heartbeat-hit.mp3', { lufs: -17 }, L('f:22440')),

  // ───────────── game feel ─────────────
  clip('arm-common.mp3', { lufs: -22 }, L('k:digital-audio/powerUp5')),
  clip('arm-rare.mp3', { lufs: -21 }, L('k:digital-audio/powerUp8')),
  clip('arm-epic.mp3', { lufs: -19, keepS: 1.3, fadeMs: 200 },
    L('k:digital-audio/powerUp1'), L('f:754771', { from: 0.2, to: 0.92, gain: 0.5, fadeOutMs: 40 })),
  clip('streak-up.mp3', { lufs: -22 }, L('k:digital-audio/phaserUp4')),
  clip('streak-break.mp3', { lufs: -22 }, L('k:digital-audio/phaserDown3')),
  clip('trophy-tick.mp3', { lufs: -27 }, L('k:interface-sounds/glass_005')),
  // the countdown: a clean tone, and the same tone a fifth up for the last one (cue intensity 0.78 and up)
  clip('countdown-beep.mp3', { lufs: -24, keepS: 0.28, fadeMs: 80 }, L('k:digital-audio/tone1', { from: 0, to: 0.3 })),
  clip('countdown-beep-hard.mp3', { lufs: -23, keepS: 0.45, fadeMs: 120 }, L('k:digital-audio/tone1', { from: 0, to: 0.66, rate: 1.5 })),
];

/** The cue a shipped file belongs to: 'strike-hard-2.mp3' -> { cue: 'strike', hard: true }. */
export function cueOfFile(file) {
  const m = /^(.*?)(-hard)?(?:-(\d))?\.mp3$/.exec(file);
  return m ? { cue: m[1], hard: !!m[2], take: Number(m[3] || 1) } : null;
}
