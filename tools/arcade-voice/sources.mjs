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
//              reverse     played backwards (a tail becomes a rise)
//              lp / hp     a low-pass / high-pass at this many Hz
//              fadeInMs    this layer's own fade in (fadeOutMs: its fade out)
// A file named '<cue>-hard.mp3' plays when the cue is fired hard: at intensity 0.78 and up,
// or at the cue's own threshold in audio.js (HARD_AT: the x3 zone, the warp's exit).

export const PACKS_KENNEY = {
  'interface-sounds': { name: 'Kenney Interface Sounds', url: 'https://kenney.nl/assets/interface-sounds' },
  'ui-audio': { name: 'Kenney UI Audio', url: 'https://kenney.nl/assets/ui-audio' },
  'impact-sounds': { name: 'Kenney Impact Sounds', url: 'https://kenney.nl/assets/impact-sounds' },
  'casino-audio': { name: 'Kenney Casino Audio', url: 'https://kenney.nl/assets/casino-audio' },
  'digital-audio': { name: 'Kenney Digital Audio', url: 'https://kenney.nl/assets/digital-audio' },
  'rpg-audio': { name: 'Kenney RPG Audio', url: 'https://kenney.nl/assets/rpg-audio' },
  'sci-fi-sounds': { name: 'Kenney Sci-Fi Sounds', url: 'https://kenney.nl/assets/sci-fi-sounds' },
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
  // the second sound pass: gadgets, the living world, Bullseye, the duel, replays
  452379: ['Small Bell #2', 'steffcaffrey'],
  393811: ['Swish Single 4', 'deleted_user_6479820'],
  472478: ['battery compartment spring 01.wav', 'denalwa'],
  119794: ['Springboard B.wav', 'lmbubec'],
  172275: ['slickchick_pops.wav', 'relwin'],
  66780: ['Crate Break 4.wav', 'kevinkace'],
  562189: ['snd_box_smash.wav', 'gristi'],
  667652: ['wooden-crate-break2.wav', 'DeltaCode'],
  856630: ['crate_break3', 'K-Forces'],
  677853: ['Coin Flip Ping', 'el_boss'],
  248143: ['Coin Flip Shimmer', 'dpren'],
  842173: ['Coins Fall on Table Free', 'AardsReal'],
  614832: ['2022-01-14-crystal-bell-08.flac', 'arseniiv'],
  735062: ['Fast Warp In', 'GammaGool'],
  720112: ['Teleport_Cast', 'BaggoNotes'],
  375972: ['Teleportation 02.wav', 'Glitchedtones'],
  753138: ['Compressed Air-Short-9', 'wavecal22'],
  569109: ['Short Wind/Air Woosh | A gust of wind', 'NIKOKnecht'],
  830856: ['whoosh low', 'MeanRaccoon'],
  683185: ['Power Up', 'NearTheAtmoshphere'],
  807976: ['bass rumble - deepwhoosh 1', 'Logicogonist'],
  749465: ['Sound Design Elements Impact SFX PS 001', 'AudioPapkin'],
  822677: ['Sound Design Elements Impact SFX PS 100', 'AudioPapkin'],
  732089: ['Boom and Rattle', 'GammaGool'],
  651817: ['Dragon roar 1.wav', 'AMWD_Mortsel-Edegem-Kontich'],
  676482: ['Beast 9', 'NearTheAtmoshphere'],
  587173: ['firework_rocket_ignition.ogg', 'derplayer'],
  151713: ['PVC Rocket Cannon.wav', 'bowlingballout'],
  140727: ['tinymortar.wav', 'j1987'],
  140717: ['Firework Cluster', 'j1987'],
  750682: ['Firework Crackle', 'LukaCafuka'],
  349830: ['Fireworks22.wav', 'kingsrow'],
  349818: ['BottleRocket15.wav', 'kingsrow'],
  325667: ["Sammy's Best - Single Shot 6", 'sloppyjoe24'],
  445237: ['Firework 2', 'steffcaffrey'],
  588198: ['Fireworks - Pop Pop Crackle', 'el_boss'],
  26349: ['partypopper.flac', 'Streety'],
  27476: ['jawsingle2.wav', 'EcoDTR'],
  737233: ['Small Water Splash', 'qubodup'],
  495117: ['Wet Splat 2.mp3', 'nebulasnails'],
  719744: ['pop_low', 'alestorm24'],
  533147: ['Bubbling', 'mattfinarelli'],
  449996: ['whoosh_short_mid.wav', 'DJT4NN3R'],
  378059: ['sfx_snowball_hit-02.wav', 'bajko'],
  167080: ['JM_IMPACT_01c - Snow on cement.wav', 'Julien_Matthey'],
  131599: ['Kill Switch (Large Breaker Switch) .WAV', 'EchoCinematics'],
  465696: ['Breaker Switch', 'ZapertyHD'],
  746988: ['Robot Awakening | Power On', 'GammaGool'],
  400603: ['Bright Triple Sweep Quick', 'newagesoup'],
  530356: ['Electricity.wav', 'danielpodlovics'],
  418530: ['Darts.WAV', '14FPanskaBubik_Lukas'],
  540132: ['Darts.wav', 'aidansamuel'],
  549897: ['bell2.wav', 'Tairblenn'],
  497093: ['FX swanee whistle down.wav', 'v0idation'],
  470710: ['traditional stamp.wav', 'I.fekry'],
  683031: ['Thump.mp3', 'mpuffenbarger'],
  217351: ['Deflating Balloon.MP3', 'VKProduktion'],
  700527: ['Rewind Short.wav', 'LuKaiX'],
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
  'music/sting-fail-trombone': 'a three note sad trombone',
  'music/jackpot-b': 'bells sweeping up into a brass and orchestra hit',
  'music/perfect-b': 'a rising three note arpeggio on glockenspiel, celesta and trumpet',
  'music/great-b': 'two rising notes on celesta and bells',
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

  // ───────────── course gadgets (public/render/gadget-core.js GADGET_CUES) ─────────────
  // through a boost ring: a real small bell, a swish of air, a short rise underneath
  clip('gadget-ring.mp3', { lufs: -21, keepS: 0.9, fadeMs: 300 },
    L('f:452379', { gain: 0.9 }), L('f:393811', { gain: 0.6 }), L('k:digital-audio/phaserUp4', { gain: 0.3 })),
  clip('gadget-ring-2.mp3', { lufs: -21, keepS: 0.9, fadeMs: 300 },
    L('f:452379', { rate: 1.19, gain: 0.9 }), L('f:388281', { gain: 0.6 }), L('k:digital-audio/phaserUp6', { gain: 0.3 })),
  // off a bounce pad: a real spring, and a ruler twanged on a counter top, a soft thump under each
  clip('gadget-pad.mp3', { lufs: -20, keepS: 0.8, fadeMs: 200 },
    L('f:472478'), L('k:digital-audio/phaseJump1', { gain: 0.35 }), L('k:impact-sounds/impactSoft_heavy_002', { gain: 0.6 })),
  clip('gadget-pad-2.mp3', { lufs: -20, keepS: 0.8, fadeMs: 200 },
    L('f:119794'), L('k:digital-audio/phaseJump3', { gain: 0.35 }), L('k:impact-sounds/impactSoft_heavy_000', { gain: 0.6 })),
  // off a bumper or a rail: the pop bumpers of a 1963 pinball table, a little bell on top
  clip('gadget-bumper.mp3', { lufs: -19, keepS: 0.45, fadeMs: 140 },
    L('f:172275', { from: 0.10, to: 0.35 }), L('k:impact-sounds/impactBell_heavy_002', { rate: 1.7, gain: 0.3 })),
  clip('gadget-bumper-2.mp3', { lufs: -19, keepS: 0.45, fadeMs: 140 },
    L('f:172275', { from: 0.54, to: 0.94 }), L('k:impact-sounds/impactBell_heavy_003', { rate: 1.7, gain: 0.3 })),
  clip('gadget-bumper-3.mp3', { lufs: -19, keepS: 0.4, fadeMs: 120 },
    L('f:172275', { from: 1.40, to: 1.59 }), L('k:impact-sounds/impactBell_heavy_002', { rate: 2.0, gain: 0.3 })),
  // a breakable smashed: crates breaking, with weight under them
  clip('gadget-break.mp3', { lufs: -18, keepS: 1.2, fadeMs: 350 },
    L('f:66780'), L('f:562189', { gain: 0.8 }), L('k:impact-sounds/impactWood_heavy_001', { gain: 0.6 }),
    L('k:sci-fi-sounds/lowFrequency_explosion_001', { gain: 0.35, lp: 160 })),
  clip('gadget-break-2.mp3', { lufs: -18, keepS: 1.3, fadeMs: 400 },
    L('f:667652'), L('f:856630', { from: 0.5, to: 1.2, gain: 0.8 }), L('k:impact-sounds/impactPlank_medium_002', { gain: 0.6 }),
    L('k:sci-fi-sounds/lowFrequency_explosion_001', { gain: 0.35, lp: 160 })),
  // a coin: a real coin's ping at three pitches; the full trail (a hard take) is a handful landing with a shimmer
  clip('gadget-coin.mp3', { lufs: -23, keepS: 0.32, fadeMs: 140 }, L('f:677853', { from: 0.06, to: 0.5 }), L('f:248143', { gain: 0.35 })),
  clip('gadget-coin-2.mp3', { lufs: -23, keepS: 0.3, fadeMs: 130 }, L('f:677853', { from: 0.06, to: 0.5, rate: 1.122 }), L('f:248143', { gain: 0.35, rate: 1.122 })),
  clip('gadget-coin-3.mp3', { lufs: -23, keepS: 0.28, fadeMs: 120 }, L('f:677853', { from: 0.06, to: 0.5, rate: 1.26 }), L('f:248143', { gain: 0.35, rate: 1.26 })),
  clip('gadget-coin-hard.mp3', { lufs: -20, keepS: 1.2, fadeMs: 350 },
    L('f:842173', { from: 0.38, to: 0.97 }), L('k:rpg-audio/handleCoins', { at: 0.05, gain: 0.7 }), L('f:248143', { gain: 0.5 }), L('f:614832', { at: 0.08, gain: 0.4 })),
  // a warp: in is a swell that snaps shut; out (a hard take) is the cast and its thump
  clip('gadget-warp.mp3', { lufs: -20, keepS: 0.9, fadeMs: 200 },
    L('f:735062'), L('k:sci-fi-sounds/forceField_002', { gain: 0.5 })),
  clip('gadget-warp-hard.mp3', { lufs: -20, keepS: 1.0, fadeMs: 300 },
    L('f:720112'), L('f:375972', { from: 0, to: 0.6, reverse: true, gain: 0.5 }), L('f:372899', { gain: 0.4 })),
  // thrown by a geyser: a burst of air and a splash going up
  clip('gadget-geyser.mp3', { lufs: -19, keepS: 1.3, fadeMs: 400 },
    L('f:753138'), L('f:440431', { at: 0.04, gain: 0.8 }), L('f:718503', { gain: 0.6 }),
    L('k:sci-fi-sounds/lowFrequency_explosion_001', { gain: 0.3, lp: 180 })),
  // onto a speed strip: a quick rising zip
  clip('gadget-strip.mp3', { lufs: -21, keepS: 0.6, fadeMs: 200 },
    L('k:digital-audio/phaserUp3', { gain: 0.6 }), L('f:393811', { gain: 0.8 }),
    L('k:sci-fi-sounds/thrusterFire_001', { from: 0, to: 0.5, fadeInMs: 40, fadeOutMs: 250, gain: 0.7 })),
  // into a wind tunnel: one gust of wind
  clip('gadget-fan.mp3', { lufs: -21, keepS: 1.4, fadeInMs: 100, fadeMs: 600 },
    L('f:569109', { from: 0.55, to: 2.0, fadeInMs: 180, fadeOutMs: 500 }), L('f:830856', { at: 0.1, gain: 0.5 })),
  // landed in a multiplier ring: a power-up with a chime on it; the x3 (a hard take) is bigger
  clip('gadget-zone.mp3', { lufs: -20, keepS: 0.9, fadeMs: 300 },
    L('k:digital-audio/powerUp12'), L('f:614832', { gain: 0.5 }), L('k:impact-sounds/impactSoft_heavy_003', { gain: 0.5 })),
  clip('gadget-zone-hard.mp3', { lufs: -19, keepS: 1.3, fadeMs: 400 },
    L('k:digital-audio/powerUp1'), L('f:614832', { gain: 0.5 }), L('f:452379', { rate: 2, at: 0.12, gain: 0.4 }), L('f:683185', { from: 0, to: 1.2, gain: 0.4, fadeOutMs: 300 }),
    L('k:impact-sounds/impactSoft_heavy_003', { gain: 0.5 })),
  // a wall that held, a backboard, mud: a dull thud
  clip('gadget-thud.mp3', { lufs: -20 }, L('k:impact-sounds/impactPlank_medium_000'), L('k:impact-sounds/impactSoft_heavy_002', { gain: 0.8 })),
  clip('gadget-thud-2.mp3', { lufs: -20 }, L('k:impact-sounds/impactPlank_medium_003'), L('k:impact-sounds/impactPunch_medium_001', { gain: 0.6 })),

  // ───────────── the living world (public/render/world-life.js LIVING_CUES) ─────────────
  // The stage answering the game: each plays WITH a callout or a payoff, so none has a crowd
  // or a tune in it and all are levelled under the effects they share the moment with.
  clip('world-shockwave.mp3', { lufs: -21, keepS: 1.6, fadeMs: 600 },
    L('k:sci-fi-sounds/lowFrequency_explosion_000'), L('f:807976', { gain: 0.6 }), L('f:372899', { gain: 0.6 }),
    L('k:sci-fi-sounds/explosionCrunch_002', { gain: 0.45, fadeOutMs: 300 })),
  clip('world-eruption.mp3', { lufs: -20, keepS: 2.6, fadeMs: 900 },
    L('k:sci-fi-sounds/explosionCrunch_003'), L('k:sci-fi-sounds/lowFrequency_explosion_000', { gain: 0.9 }),
    L('f:749465', { from: 0.2, to: 2.9, gain: 0.7 }), L('f:732089', { at: 0.06, gain: 0.5 }),
    L('k:sci-fi-sounds/explosionCrunch_002', { at: 0.03, gain: 0.6, fadeOutMs: 300 })),
  // a slowed growl swelling into the roar, a recorded sub growl under it, the hiss of the fire going up
  clip('world-dragon-roar.mp3', { lufs: -20, keepS: 2.6, fadeMs: 600, fadeInMs: 30 },
    L('f:676482', { from: 0.7, to: 2.25, rate: 0.85, fadeInMs: 80, fadeOutMs: 450 }),
    L('f:651817', { from: 0.75, to: 2.9, gain: 0.9, fadeInMs: 60, fadeOutMs: 400 }),
    L('f:587173', { from: 0.45, to: 1.9, at: 0.7, gain: 0.3, lp: 3200, fadeInMs: 300, fadeOutMs: 600 })),
  // flares by day: the thump of the tube, the rocket hissing up
  clip('world-flare.mp3', { lufs: -22, keepS: 1.4, fadeMs: 500 },
    L('f:151713', { gain: 0.7 }), L('f:587173', { from: 0.45, to: 1.8, fadeInMs: 60, fadeOutMs: 500 })),
  // fireworks by night: a whizz up, the burst, the crackle falling
  clip('world-fireworks.mp3', { lufs: -21, keepS: 2.3, fadeMs: 800 },
    L('f:349818', { from: 0.1, to: 0.6, gain: 0.45, fadeOutMs: 80 }), L('f:140727', { from: 1.84, to: 3.3, at: 0.5 }),
    L('f:349830', { from: 0.3, to: 1.6, at: 0.5, gain: 0.8 }), L('f:750682', { at: 0.75, gain: 0.6 })),
  // a holed ball (0.8 s after the cup): poppers and a little crackle, under the roar
  clip('world-celebration.mp3', { lufs: -22, keepS: 2.2, fadeMs: 800 },
    L('f:26349'), L('f:458398', { at: 0.22, gain: 0.8 }), L('f:140717', { at: 0.3, gain: 0.6 }),
    L('f:588198', { from: 0.72, to: 2.5, at: 0.55, gain: 0.5 })),
  // fish, or a crocodile, at a splash: jaws and water
  clip('world-snap.mp3', { lufs: -21, keepS: 0.9, fadeMs: 300 },
    L('f:27476', { rate: 0.7 }), L('k:impact-sounds/impactWood_medium_002', { gain: 0.5 }),
    L('f:737233', { at: 0.05, gain: 0.8 }), L('f:495117', { at: 0.03, gain: 0.5 })),
  clip('world-lava-burp.mp3', { lufs: -21, keepS: 1.2, fadeMs: 400 },
    L('k:digital-audio/lowDown', { gain: 0.8 }), L('f:719744', { from: 0.13, to: 0.4, rate: 0.6, at: 0.25 }),
    L('f:533147', { from: 0, to: 1.0, gain: 0.5, fadeOutMs: 300 }), L('f:170235', { from: 0, to: 0.9, at: 0.3, gain: 0.35, fadeOutMs: 300 })),
  // a duff: dry grass tumbling past on a puff of wind
  clip('world-tumbleweed.mp3', { lufs: -24, keepS: 1.5, fadeMs: 500 },
    L('f:449996', { from: 0, to: 1.4, gain: 0.7 }), L('k:impact-sounds/footstep_grass_001', { gain: 0.8 }),
    L('k:impact-sounds/footstep_grass_002', { at: 0.3, rate: 1.1, gain: 0.7 }), L('k:impact-sounds/footstep_grass_004', { at: 0.58, gain: 0.55 }),
    L('k:impact-sounds/footstep_grass_000', { at: 0.9, rate: 1.1, gain: 0.4 })),
  // a snowman's head coming off, and landing
  clip('world-snowman.mp3', { lufs: -22, keepS: 1.0, fadeMs: 250 },
    L('f:378059'), L('k:impact-sounds/impactSoft_medium_002', { gain: 0.5 }), L('f:167080', { at: 0.34, gain: 0.7 })),
  // a knockout on a stage with no dragon and no volcano: a salvo of fireworks
  clip('world-knockout.mp3', { lufs: -20, keepS: 2.2, fadeMs: 800 },
    L('f:325667', { from: 1.46, to: 3.4, hp: 55, gain: 0.8 }), L('f:349830', { from: 0.3, to: 1.6, at: 0.28, gain: 0.8, hp: 45 }),
    L('f:140717', { at: 0.35, gain: 0.5 }), L('f:750682', { at: 0.6, gain: 0.5 })),
  // SUDDEN DEATH: the breaker thrown and the power sagging; 1.5 s later the lights slam back on
  clip('world-lights-dip.mp3', { lufs: -20, keepS: 1.4, fadeMs: 500 },
    L('f:131599', { from: 0.28, to: 1.7 }), L('k:digital-audio/lowDown', { at: 0.03, gain: 0.6 })),
  clip('world-lights-flare.mp3', { lufs: -20, keepS: 1.2, fadeMs: 450 },
    L('f:465696', { from: 0.04, to: 0.4 }), L('f:746988', { at: 0.02, gain: 0.8 }),
    L('f:400603', { from: 0, to: 0.8, at: 0.04, gain: 0.4 }), L('f:530356', { at: 0.05, gain: 0.25 })),
  // the match decided: four bursts and a long crackle (the fanfare is the music, the roar is the crowd)
  clip('world-finale.mp3', { lufs: -21, keepS: 3.8, fadeMs: 1300 },
    L('f:325667', { from: 1.46, to: 3.6, hp: 55, gain: 0.8 }), L('f:140727', { from: 1.84, to: 3.3, at: 0.55, gain: 0.9 }),
    L('f:349830', { from: 0.3, to: 1.7, at: 1.05, gain: 0.9, hp: 45 }),
    L('f:445237', { from: 1.7, to: 4.4, at: 0.9, gain: 0.6, fadeInMs: 80, fadeOutMs: 900 }),
    L('f:349830', { from: 2.56, to: 3.6, at: 1.65, gain: 0.8 }), L('f:750682', { at: 2.0, gain: 0.5 })),

  // ───────────── Bullseye, the duel, the replays (docs/modes.md) ─────────────
  // a dart landing: three real darts
  clip('be-thunk.mp3', { lufs: -20 }, L('f:418530', { from: 0.78, to: 1.2 }), L('k:impact-sounds/impactWood_light_001', { gain: 0.4 })),
  clip('be-thunk-2.mp3', { lufs: -20 }, L('f:540132', { from: 0.34, to: 0.8 }), L('k:impact-sounds/impactWood_light_003', { gain: 0.4 })),
  clip('be-thunk-3.mp3', { lufs: -20 }, L('f:540132', { from: 2.24, to: 2.6 }), L('k:impact-sounds/impactWood_light_000', { gain: 0.4 })),
  // the bullseye: the dart, and a real bell with a shimmer
  clip('be-bull.mp3', { lufs: -19, keepS: 1.3, fadeMs: 450 },
    L('f:418530', { from: 0.78, to: 1.2, gain: 0.7 }), L('f:549897', { at: 0.02 }),
    L('k:impact-sounds/impactBell_heavy_002', { rate: 1.5, gain: 0.4 }), L('f:614832', { at: 0.06, gain: 0.45 })),
  // a bust: a swanee whistle sliding down, and the thud at the bottom
  clip('be-bust.mp3', { lufs: -21, keepS: 1.3, fadeMs: 150 },
    L('f:497093'), L('k:impact-sounds/impactSoft_heavy_001', { at: 1.05, gain: 0.6 })),
  // a check out: two bells, chimes, the chips raked in
  clip('be-checkout.mp3', { lufs: -18, keepS: 1.8, fadeMs: 600 },
    L('f:549897'), L('f:452379', { rate: 1.5, at: 0.14, gain: 0.8 }), L('f:614832', { at: 0.1, gain: 0.5 }),
    L('k:casino-audio/chips-handle-3', { at: 0.2, gain: 0.5 }), L('k:impact-sounds/impactPunch_heavy_001', { gain: 0.45 })),
  // the call card slamming in: a swish, a punch, a plate
  clip('dl-call.mp3', { lufs: -18, keepS: 1.3, fadeMs: 450 },
    L('f:372899', { gain: 0.6 }), L('k:impact-sounds/impactPunch_heavy_002', { at: 0.18 }),
    L('k:impact-sounds/impactPlate_heavy_001', { at: 0.18, gain: 0.6 }), L('f:822677', { from: 0.1, to: 1.4, at: 0.16, gain: 0.5 })),
  // a letter stamped on the tiles: a real rubber stamp
  clip('dl-letter.mp3', { lufs: -20, keepS: 0.7, fadeMs: 150 },
    L('f:470710', { from: 0.48, to: 1.1 }), L('f:683031', { gain: 0.6 }), L('k:rpg-audio/bookClose', { gain: 0.4 })),
  clip('dl-matched.mp3', { lufs: -20, keepS: 1.0, fadeMs: 350 },
    L('k:interface-sounds/confirmation_004'), L('f:452379', { rate: 1.26, gain: 0.6 }), L('f:614832', { at: 0.05, gain: 0.4 })),
  // no call: the air going out of it
  clip('dl-no-call.mp3', { lufs: -22, keepS: 0.9, fadeMs: 150 },
    L('f:217351'), L('k:digital-audio/phaserDown3', { gain: 0.3 })),
  // the cut into a replay and back out: a tape whip, forwards then backwards
  clip('replay-in.mp3', { lufs: -23, keepS: 0.6, fadeMs: 120 },
    L('f:700527', { from: 0.3, to: 0.85, fadeInMs: 40, fadeOutMs: 60 }), L('k:interface-sounds/scratch_003', { gain: 0.5 }), L('f:388281', { gain: 0.5 })),
  clip('replay-out.mp3', { lufs: -23, keepS: 0.55, fadeMs: 150 },
    L('f:700527', { from: 0.3, to: 0.8, reverse: true, fadeInMs: 30, fadeOutMs: 120 }), L('k:interface-sounds/scratch_001', { gain: 0.5 }), L('f:850168', { gain: 0.5 })),
  clip('replay-offer.mp3', { lufs: -26 }, L('k:interface-sounds/pluck_001')),

  // ───────────── cues that were synthesized until the second pass ─────────────
  // a later bounce on any ground: three real soft thumps
  clip('bounce.mp3', { lufs: -23 }, L('k:impact-sounds/impactSoft_medium_000')),
  clip('bounce-2.mp3', { lufs: -23 }, L('k:impact-sounds/impactSoft_medium_002')),
  clip('bounce-3.mp3', { lufs: -23 }, L('k:impact-sounds/impactSoft_medium_003')),
  // the grade stings that carry a callout: generated, each cut from a three second render
  clip('jackpot.mp3', { lufs: -18, keepS: 2.0, fadeMs: 500 }, L('h:music/jackpot-b', { to: 2.1 })),
  clip('perfect.mp3', { lufs: -19, keepS: 1.9, fadeMs: 500 }, L('h:music/perfect-b', { to: 2.0 })),
  clip('great.mp3', { lufs: -20, keepS: 1.4, fadeMs: 450 }, L('h:music/great-b', { to: 1.5 })),
  clip('disaster.mp3', { lufs: -20, keepS: 1.9, fadeMs: 300 }, L('h:music/sting-fail-trombone', { to: 2.0 })),
];

/** The cue a shipped file belongs to: 'strike-hard-2.mp3' -> { cue: 'strike', hard: true }. */
export function cueOfFile(file) {
  const m = /^(.*?)(-hard)?(?:-(\d))?\.mp3$/.exec(file);
  return m ? { cue: m[1], hard: !!m[2], take: Number(m[3] || 1) } : null;
}
