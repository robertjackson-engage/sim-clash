// v2:seeover The arcade's VIEW FROM ABOVE control (the see-over address camera itself is
// render/see-over-rig.js; this is its one button and its one key).
//
// The players stand at a mat with a club in hand, so it is one big button on the screen
// and one key: V. A tap (or a click) flies the camera up to a high view of the way from
// the ball to the pin and holds it there; a second tap glides back down behind the ball.
// Holding V is a peek: up while it is held, down on release. When the camera has gone up
// by itself (nothing behind the ball sees the target) the button says so and the same
// key brings it down. It never plays anything that delays a swing: a ball struck while the
// camera is up, or on its way, is followed from wherever the camera is.

const CSS = `
#so-above { position: absolute; left: 12px; top: 160px; z-index: 21;   /* v2:final 160: clear of the wind dial above it (at 150 the two overlapped by a pixel or two) */
  display: flex; align-items: center; gap: 12px; padding: 13px 16px 13px 14px; cursor: pointer; text-align: left;
  font: 900 19px/1 system-ui, 'Segoe UI', sans-serif; letter-spacing: 0.06em; color: #fff;
  background: linear-gradient(180deg, rgba(34, 44, 62, 0.94), rgba(14, 18, 28, 0.94)); border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 16px; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  transition: opacity 0.2s, border-color 0.2s, background 0.2s; }
#so-above:hover { border-color: #fff; }
#so-above.gone { opacity: 0; pointer-events: none; }
#so-above .so-ico { width: 30px; height: 30px; flex: none; }
#so-above kbd { font: 900 16px/1 system-ui, sans-serif; padding: 6px 9px; border-radius: 8px; color: #10141c; background: #ffd23a; box-shadow: 0 2px 0 #a97f00; }
#so-above.on { background: linear-gradient(180deg, rgba(255, 210, 58, 0.97), rgba(232, 160, 20, 0.97)); color: #17130a; border-color: #fff3c4; text-shadow: none; }
#so-above.on kbd { background: #17130a; color: #ffd23a; box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5); }
#so-above .so-sub { display: none; font: 700 12px/1 system-ui, sans-serif; letter-spacing: 0.05em; opacity: 0.85; margin-top: 5px; }
#so-above.auto .so-sub, #so-above.hint .so-sub { display: block; }
#so-above.hint { border-color: #ffd23a; animation: so-pulse 1.6s ease-in-out 3; }
@keyframes so-pulse { 50% { box-shadow: 0 0 0 7px rgba(255, 210, 58, 0.35), 0 6px 22px rgba(0, 0, 0, 0.55); } }
`;

const ICON_UP = '<svg class="so-ico" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 L26 15 H19 V27 H11 V15 H4 Z" fill="currentColor"/></svg>';
const ICON_DOWN = '<svg class="so-ico" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 27 L26 15 H19 V3 H11 V15 H4 Z" fill="currentColor"/></svg>';

// How the button reads in each state of the camera (pure: test/see-over-ui.test.mjs).
export function aboveLabel(st = {}) {
  if (st.above) return { main: 'BACK TO THE BALL', sub: st.auto ? 'THE TARGET IS HIDDEN FROM BEHIND THE BALL' : '', icon: 'down' };
  return { main: 'VIEW FROM ABOVE', sub: st.hidden ? 'THE TARGET IS HIDDEN FROM HERE' : '', icon: 'up' };
}

// How much of the bottom of the picture the HUD covers where the ball is drawn (the middle of
// the frame): the share of the frame's height from its bottom edge up to the top of the
// highest thing that is hit there (the ball dock, the aim bar, the bottom bar). hit(x, y):
// the element at a point of the page (document.elementFromPoint); frame { left, top, width,
// height }: the picture's box; isPicture(el): the canvas, or something it is inside. Only
// the bottom 45 % is looked at, and a cover of more than 30 % (an open tray, a full-screen
// panel) is no dock: null, and the caller keeps what it had.
export function coveredBottom(hit, frame, isPicture) {
  let top = frame.top + frame.height;
  for (const dx of [-0.04, 0, 0.04]) {
    const x = frame.left + frame.width * (0.5 + dx);
    for (let y = frame.top + frame.height - 3; y > frame.top + frame.height * 0.55; y -= 8) {
      const el = hit(x, y);
      if (el && !isPicture(el)) top = Math.min(top, y);
    }
  }
  const frac = (frame.top + frame.height - top) / Math.max(1, frame.height);
  return frac > 0.3 ? null : Math.max(0, frac);
}

// What a V key event does: 'toggle' on the first press, 'release' when a hold ends (a peek:
// back to how it was), nothing for a tap's own release or an auto-repeat.
export function keyAction(ev, st, holdMs = 350) {
  if (ev.type === 'keydown') {
    if (ev.repeat || st.down) return null;
    st.down = true; st.at = ev.timeStamp;
    return 'toggle';
  }
  if (ev.type === 'keyup' && st.down) {
    st.down = false;
    return ev.timeStamp - st.at > holdMs ? 'release' : null;
  }
  return null;
}

/**
 * scene: the GolfScene (its seeOver rig); host: the element the button goes in (the HUD);
 * blocked(): true while something else owns the keyboard (a menu, a full-bleed screen).
 * Turns the see-over camera on. Returns { el, dispose }.
 */
export function mountSeeOver({ scene, host = document.getElementById('hud') || document.body, blocked = () => false } = {}) {
  const rig = scene.seeOver;
  if (!document.getElementById('so-ui-style')) {
    document.head.appendChild(Object.assign(document.createElement('style'), { id: 'so-ui-style', textContent: CSS }));
  }
  const el = document.createElement('button');
  el.id = 'so-above';
  el.type = 'button';
  el.className = 'gone';
  el.title = 'Fly the camera up to see the way to the pin, and back (V; hold V to peek)';
  host.appendChild(el);
  let last = '';
  const draw = (st) => {
    const l = aboveLabel(st), k = `${l.main}|${l.sub}|${l.icon}`;
    el.classList.toggle('on', !!st.above);
    el.classList.toggle('auto', !!st.above && !!st.auto);
    el.classList.toggle('hint', !st.above && !!st.hidden);
    if (k === last) return;
    last = k;
    el.innerHTML = `${l.icon === 'down' ? ICON_DOWN : ICON_UP}<span><span class="so-main">${l.main}</span><span class="so-sub">${l.sub}</span></span><kbd>V</kbd>`;
  };
  rig.onState = draw;
  draw({});
  el.addEventListener('click', () => { rig.toggleAbove(); el.blur(); });

  const key = { down: false, at: 0 };
  let before = false;
  const onKey = (e) => {
    if (String(e.key || '').toLowerCase() !== 'v') return;
    if (e.type === 'keydown') {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (blocked() || scene.camMode !== 'idle' || scene.anim) return;
    }
    const act = keyAction(e, key, 350);
    if (act === 'toggle') { before = rig.above; rig.toggleAbove(); e.preventDefault(); }
    else if (act === 'release') rig.setAbove(before);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  // the button belongs to the address view: gone while a shot flies, in a flyover or the free camera
  let ticks = 0, safeMax = 0, safeFor = '';
  const tick = setInterval(() => {
    el.classList.toggle('gone', !(rig.on && scene.geo && scene.camMode === 'idle' && !scene.anim) || blocked());
    // the ball is framed above the dock: how much of the bottom of the picture is covered, a couple of times a second
    if (ticks++ % 3 === 0 && !blocked() && document.visibilityState === 'visible') {
      const canvas = scene.renderer.domElement, r = canvas.getBoundingClientRect();
      const frac = coveredBottom((x, y) => document.elementFromPoint(x, y), r, (e) => e === canvas || e.contains(canvas));
      // (the highest it has been in this layout: the dock's armed tab moves with the ball, and a
      // frame that follows the dock that follows the ball never comes to rest)
      const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (size !== safeFor) { safeFor = size; safeMax = 0; }
      if (frac != null) { safeMax = Math.max(safeMax, frac); rig.setSafeBottom(safeMax); }
    }
  }, 200);
  rig.enable(true);
  return {
    el,
    dispose() {
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      rig.onState = null;
      rig.enable(false);
      el.remove();
    },
  };
}
