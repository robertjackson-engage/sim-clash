'use strict';
// Shared helpers for the arcade hole tests (test/arcade-holes*.test.js).

// Can the address camera see a spot? As public/render/scene.js stands it: 14 m behind the ball on the
// line to the pin, 4.6 m above the ball or 1.7 m above its own ground, whichever is higher.
// g: a Game with the stage loaded (uses g.hole.tee, g.hole.pin, g.terrain.h)
// -> the least clearance (m) of the sight line over the ground on the way to (x, y)
function teeCameraClearance(g, x, y) {
  const { tee, pin } = g.hole, d = Math.hypot(pin[0] - tee[0], pin[1] - tee[1]);
  const cam = [tee[0] - 14 * (pin[0] - tee[0]) / d, tee[1] - 14 * (pin[1] - tee[1]) / d];
  const cz = Math.max(g.terrain.h(cam[0], cam[1]) + 1.7, g.terrain.h(tee[0], tee[1]) + 4.6);
  const tz = g.terrain.h(x, y) + 0.3, len = Math.hypot(x - cam[0], y - cam[1]);
  const lerp = (a, b, t) => a + (b - a) * t;
  let least = Infinity;
  for (let s = 1; s < len - 1; s += 0.5) {
    const px = lerp(cam[0], x, s / len), py = lerp(cam[1], y, s / len);
    least = Math.min(least, lerp(cz, tz, s / len) - g.terrain.h(px, py));
  }
  return least;
}

module.exports = { teeCameraClearance };
