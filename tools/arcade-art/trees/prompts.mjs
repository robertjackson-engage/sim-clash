// The prompts the painted tree textures were generated from (an image model, one picture a
// tile; tools/arcade-art/trees/paint.mjs cuts them out and builds the atlases). Kept so the
// art can be regenerated or extended in the same hand. Everything here describes plants in
// general: no artist, no game, no brand, no photograph is named or imitated.
//
// key: the flat background the subject was painted on ('magenta' or 'blue'), which the cut
// removes. aspect: the picture's shape; a long leaf is painted at its natural proportions and
// squeezed into its square tile (the model's strip stretches it back).
const STYLE = 'Painterly semi-realistic game foliage texture, like the hand-painted albedo of a modern console arcade sports game (not flat vector art, not cel-shaded): believable natural shapes, crisp readable detail, subtle surface texture and natural irregularity, soft painted shading, rich but natural colour. Flat even studio light from the front, no cast shadow, no drop shadow, no ground.';
const BG = {
  magenta: 'Isolated on a perfectly flat, uniform, pure magenta (#FF00FF) background that fills the whole frame, with no gradient, no vignette, no texture and no shadow on it. No magenta or pink anywhere on the plant.',
  blue: 'Isolated on a perfectly flat, uniform, pure blue (#0000FF) background that fills the whole frame, with no gradient, no vignette, no texture and no shadow on it. No blue anywhere on the plant.',
};
const END = 'No text, no labels, no border, no frame, no watermark. Sharp edges against the background.';
const cluster = (what) => `${STYLE} A single dense cluster of ${what}, seen face-on, roughly round with an irregular leafy outline and small gaps between the outer leaves, leaves overlapping in layers: brighter fresh leaves on top, deeper shaded leaves beneath, darkest in the middle of the cluster. The cluster is centred and fills about 85% of the square frame; nothing is cropped by the edges.`;
const strip = (what) => `${STYLE} ${what} It is perfectly straight and vertical, laid flat and seen face-on, its stalk at the bottom centre of the frame and its tip at the top centre; it fills the full height of the frame and nothing is cropped by the left or right edges.`;

export const LEAF_PROMPTS = Object.freeze({
  broadA: { key: 'magenta', aspect: '1:1', prompt: cluster('broad oval tropical tree leaves with pointed tips, each leaf with a visible pale midrib and fine side veins, colour varying from leaf to leaf between fresh yellow-green and deep green') },
  broadB: { key: 'magenta', aspect: '1:1', prompt: cluster('long narrow glossy leaves like mango or laurel leaves that hang downward from short twigs at the top of the cluster, each with a pale midrib, colour varying between fresh light green and deep green, a few thin brown twigs visible at the top') },
  bigleaf: { key: 'magenta', aspect: '1:1', prompt: cluster('very large bold jungle leaves, like rubber plant or tropical almond leaves, only about ten leaves radiating from the centre, each with a strong pale midrib and clear herringbone side veins, some leaves lighter yellow-green and some deep green') },
  spray: { key: 'magenta', aspect: '1:1', prompt: cluster('fine feathery acacia foliage: many thin twigs radiating outward, each carrying two neat rows of tiny oval leaflets, airy at the outside with small gaps, light olive green to mid green') },
  juniper: { key: 'magenta', aspect: '1:1', prompt: cluster('juniper foliage: dense scaly cord-like sprays branching outward from thin brown twigs, blue-green to grey-green with lighter tips') },
  pineTuft: { key: 'magenta', aspect: '1:1', prompt: cluster('long pine needles: several tufts of long slender needles bursting outward from short brown twig ends like starbursts, deep green needles with lighter yellow-green tips, the needles separate at the outside') },
  blossom: { key: 'blue', aspect: '1:1', prompt: cluster('cherry blossom: dozens of five-petalled pale pink and white flowers with deeper pink centres, crowded along a few thin dark brown twigs, a few pink buds, no green leaves') },
  maple: { key: 'blue', aspect: '1:1', prompt: cluster('Japanese maple leaves in autumn: many small five-pointed to seven-pointed palmate leaves with fine veins, in scarlet, orange-red and deep crimson, on thin dark twigs') },
  bushFlower: { key: 'magenta', aspect: '1:1', prompt: cluster('small glossy dark green bush leaves with about fifteen pure white five-petalled flowers with pale yellow centres scattered evenly over it') },
  gorse: { key: 'magenta', aspect: '1:1', prompt: cluster('gorse in flower: spiky dark green needle-like shoots radiating outward, covered with many small bright golden yellow pea flowers') },
  dryScrub: { key: 'magenta', aspect: '1:1', prompt: cluster('dry desert scrub like sagebrush: thin woody grey-brown twigs branching outward with sparse small dusty grey-green leaves, airy with many gaps') },
  frond: { key: 'magenta', aspect: '1:4', prompt: strip('One whole coconut palm frond: a strong pale yellow-green central rib with long narrow pointed leaflets in two neat rows, the leaflets angled toward the tip, longest in the lower middle and shortening to a point at the tip, small gaps between the leaflets especially toward their ends, the left row slightly darker than the right, fresh mid green.') },
  fan: { key: 'magenta', aspect: '1:1', prompt: `${STYLE} One fan palm leaf seen face-on: a wide pleated fan of about thirty stiff pointed segments radiating from a hub, the segments joined for the inner half and split into separate points at the outside, alternating lighter and darker green pleats, on a short pale stalk that enters from the bottom centre of the frame. The fan fills about 90% of the square frame and nothing is cropped by the edges.` },
  banana: { key: 'magenta', aspect: '9:16', prompt: strip('One large banana leaf: a broad paddle-shaped blade with a thick pale midrib and many fine parallel side veins, the edges torn into a few natural splits, bright fresh green with a lighter right half.') },
  fern: { key: 'magenta', aspect: '9:16', prompt: strip('One fern frond: a long triangle of paired pinnae, each pinna lined with small rounded leaflets, widest near the bottom and tapering to a fine tip, mid green with lighter tips and a thin brown stalk.') },
  bough: { key: 'magenta', aspect: '3:4', prompt: strip('One spruce bough seen from above: a brown twig with many side twigs spreading in a flat fan shape, wider at the bottom and tapering to a pointed tip, every twig densely lined with short dark green needles, lighter green at the outer tips.') },
  boughSnow: { key: 'magenta', aspect: '3:4', prompt: strip('One spruce bough seen from above, laden with snow: a brown twig with many side twigs spreading in a flat fan shape, wider at the bottom and tapering to a pointed tip, densely lined with short dark green needles, with thick soft lumps of pure white snow lying along the middle of the bough and on the larger side twigs, green needle tips showing all round the snow.') },
  grass: { key: 'magenta', aspect: '1:1', prompt: `${STYLE} One tuft of long wild grass seen from the side: many slender blades fanning upward and outward from a narrow base at the bottom centre of the frame, light and dark green blades, with six or seven pale straw-coloured feathery seed heads on thin stems rising above the blades. The tuft fills the full height of the frame and nothing is cropped by the left, right or top edges.` },
  vine: { key: 'magenta', aspect: '9:16', prompt: `${STYLE} A curtain of hanging jungle vines seen face-on: seven or eight thin green-brown strands hanging straight down from the top edge of the frame to different lengths, each lined with small heart-shaped green leaves, the longest strand reaching almost to the bottom, clear gaps between the strands. Nothing is cropped by the left or right edges.` },
  twig: { key: 'magenta', aspect: '1:1', prompt: `${STYLE} One bare leafless tree branch seen face-on: a grey-brown branch rising from the bottom centre of the frame and forking again and again into a wide fan of fine bare twigs, each twig ending in a tiny bright yellow bud. The branch fills about 90% of the square frame and nothing is cropped by the left, right or top edges.` },
});

const BARK = 'Seamless hand-painted game texture in a stylised-realism style, as in a modern arcade sports video game: a flat, straight-on, evenly lit close view of tree bark that fills the whole frame edge to edge, the trunk running vertically, no curvature, no background, no branches, no leaves, no highlights or shadows from a light, no text.';
export const BARK_PROMPTS = Object.freeze({
  ridged: { aspect: '1:4', prompt: `${BARK} Rough bark of a broadleaf tree: deep vertical furrows between thick interlacing corky ridges, warm grey-brown.` },
  plated: { aspect: '1:4', prompt: `${BARK} Flaky bark of a pine or spruce: irregular overlapping scaly plates divided by dark cracks, reddish brown and grey.` },
  smooth: { aspect: '1:4', prompt: `${BARK} Smooth pale grey bark of a tropical kapok or beech tree: fine vertical streaks, a few thin horizontal wrinkles and small scars, subtle patches of lighter and darker grey.` },
  ringed: { aspect: '1:4', prompt: `${BARK} The trunk of a coconut palm: evenly spaced horizontal leaf-scar rings running straight across the frame like stacked bands, with fine vertical fibres and cracks between them, grey-brown.` },
  banded: { aspect: '1:4', prompt: `${BARK} Smooth glossy bark of a cherry tree: satin reddish-brown bark crossed by many short pale horizontal lenticel bands, a few thin peeling curls.` },
  fibrous: { aspect: '1:4', prompt: `${BARK} The trunk of a date palm: a regular diamond lattice of old cut leaf bases overlapping like large scales, with coarse brown fibres between them, tan and brown.` },
  dead: { aspect: '1:4', prompt: `${BARK} Burnt charred dead wood: black and dark grey charcoal cracked into small blocks in an alligator pattern, with long vertical splits showing silver-grey weathered wood grain.` },
  mossy: { aspect: '1:4', prompt: `${BARK} Dark furrowed bark of a rainforest tree with large irregular patches of bright green moss and a few pale lichen spots growing over it.` },
});

export const promptFor = (name) => {
  const p = LEAF_PROMPTS[name];
  if (p) return { ...p, prompt: `${p.prompt} ${BG[p.key]} ${END}` };
  return BARK_PROMPTS[name] ? { ...BARK_PROMPTS[name] } : null;
};

if (process.argv[1] && process.argv[1].endsWith('prompts.mjs')) {
  const names = process.argv.slice(2);
  const all = names.length ? names : [...Object.keys(LEAF_PROMPTS), ...Object.keys(BARK_PROMPTS)];
  console.log(JSON.stringify(all.map((n, index) => ({ index, name: n, ...promptFor(n) })), null, 1));
}
