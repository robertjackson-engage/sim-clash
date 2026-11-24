// Sim Clash site: fills the GitHub links from config.js, runs the hero clip, the trailer
// lightbox, the route overlays, the before / after sliders and the launch-monitor filter.
// No framework, no network calls of its own, nothing tracked. Every page works without it.
(function () {
  'use strict';
  var doc = document;
  var cfg = window.SIMCLASH_SITE || {};
  var owner = cfg.owner || 'OWNER';
  var repo = cfg.repo || 'sim-clash';
  var branch = cfg.branch || 'main';
  var base = 'https://github.com/' + owner + '/' + repo;
  var releases = base + '/releases';
  var each = function (sel, fn, root) { Array.prototype.forEach.call((root || doc).querySelectorAll(sel), fn); };
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- links and texts from config.js ----------
  var links = {
    repo: base,
    releases: releases,
    latest: releases + '/latest',
    download: cfg.downloadUrl || releases + '/latest',
    issues: base + '/issues',
    'new-issue': base + '/issues/new/choose',
    pulls: base + '/pulls',
    fork: base + '/fork',
    license: base + '/blob/' + branch + '/LICENSE',
    disclaimer: base + '/blob/' + branch + '/DISCLAIMER.md',
  };
  var fills = {
    'clone-url': base + '.git',
    'repo-slug': owner + '/' + repo,
    'repo-dir': repo,
    owner: owner,
    release: cfg.release || '',
  };
  function linkFor(key) {
    if (links[key]) return links[key];
    // data-gh="blob:docs/match.md" or "tree:tools/arcade-holes": a path in the source tree
    var m = /^(blob|tree):(.+)$/.exec(key);
    return m ? base + '/' + m[1] + '/' + branch + '/' + m[2] : base;
  }
  each('a[data-gh]', function (a) { a.href = linkFor(a.getAttribute('data-gh')); });
  each('[data-fill]', function (el) { var v = fills[el.getAttribute('data-fill')]; if (v) el.textContent = v; });
  if (owner === 'OWNER' && window.console) console.warn('Sim Clash site: set "owner" in config.js so the GitHub links point at the real repository.');

  // ---------- the hero clip ----------
  // A short silent loop behind the headline. It is fetched only after the page has loaded,
  // and not at all for people who asked for less motion or less data.
  var hero = doc.querySelector('[data-loop]');
  if (hero) {
    var video = hero.querySelector('video');
    var toggle = doc.querySelector('[data-loop-toggle]');
    var conn = navigator.connection || {};
    var saveData = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
    var label = function (on) { if (toggle) { toggle.setAttribute('aria-pressed', on ? 'true' : 'false'); toggle.textContent = on ? 'Pause clip' : 'Play clip'; } };
    var play = function () {
      if (!video) return;
      video.muted = true;
      var p = video.play();
      if (p && p.then) p.then(function () { video.classList.add('on'); label(true); }, function () { label(false); });
      else { video.classList.add('on'); label(true); }
    };
    var pause = function () { if (video) video.pause(); label(false); };
    if (video && toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', function () { if (video.paused) play(); else pause(); });
    }
    if (video && !reduce && !saveData) {
      if (doc.readyState === 'complete') play();
      else window.addEventListener('load', play);
      // not while it is off screen
      if ('IntersectionObserver' in window) {
        var wanted = true;
        if (toggle) toggle.addEventListener('click', function () { wanted = !video.paused; });
        new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (!e.isIntersecting) { if (!video.paused) { video.pause(); } } else if (wanted && video.paused && video.classList.contains('on')) play(); });
        }, { threshold: 0.05 }).observe(hero);
      }
    }
  }

  // ---------- the trailer ----------
  // A link to the video file without this script; with it, a lightbox. config.youtubeUrl
  // swaps the site's own file for a YouTube player (asked for only when the button is pressed).
  function youtubeId(url) {
    var m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/.exec(String(url || ''));
    return m ? m[1] : null;
  }
  var box = null;
  function openTrailer(src, poster) {
    if (!box) {
      box = doc.createElement('dialog');
      box.className = 'lightbox';
      box.setAttribute('aria-label', 'The Sim Clash trailer');
      box.innerHTML = '<div class="lightbox-in"></div><button type="button" class="lightbox-close">Close ✕</button>';
      doc.body.appendChild(box);
      var shut = function () { box.querySelector('.lightbox-in').innerHTML = ''; if (hero && video && video.classList.contains('on') && !reduce) video.play(); };
      box.addEventListener('close', shut);
      box.querySelector('.lightbox-close').addEventListener('click', function () { box.close(); });
      box.addEventListener('click', function (e) { if (e.target === box) box.close(); });
    }
    var holder = box.querySelector('.lightbox-in');
    var yt = youtubeId(cfg.youtubeUrl);
    if (yt) {
      holder.innerHTML = '<iframe title="Sim Clash trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
      holder.firstChild.src = 'https://www.youtube-nocookie.com/embed/' + yt + '?autoplay=1&rel=0';
    } else {
      var v = doc.createElement('video');
      v.controls = true; v.playsInline = true; v.preload = 'none';
      if (poster) v.poster = poster;
      v.src = src;
      holder.appendChild(v);
      var p = v.play(); if (p && p.catch) p.catch(function () { /* the visitor presses play */ });
    }
    if (video) video.pause();
    box.showModal();
  }
  if (typeof HTMLDialogElement === 'function') {
    each('a[data-trailer]', function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault();
        openTrailer(a.getAttribute('href'), a.getAttribute('data-poster'));
      });
    });
  }

  // ---------- the routes of a stage: a tap on the button (hover and focus are CSS) ----------
  each('.routes-btn', function (btn) {
    var card = btn.closest('.stage');
    btn.addEventListener('click', function () {
      var open = !card.classList.contains('open');
      each('.stage.open', function (c) { c.classList.remove('open'); var b = c.querySelector('.routes-btn'); if (b) b.setAttribute('aria-expanded', 'false'); });
      card.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // ---------- before / after ----------
  each('.ba', function (ba) {
    var range = ba.querySelector('input[type="range"]');
    if (!range) return;
    var set = function () { ba.style.setProperty('--pos', range.value + '%'); };
    range.addEventListener('input', set);
    set();
  });

  // ---------- the launch-monitor filter on the Connect page ----------
  var filter = doc.querySelector('[data-lm-filter]');
  if (filter) {
    var wrap = doc.querySelector('.lm-filter');
    if (wrap) wrap.hidden = false;
    var none = doc.querySelector('.lm-none');
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var shown = 0;
      each('details.lm', function (d) {
        var hit = !q || (d.getAttribute('data-k') || '').indexOf(q) >= 0;
        d.hidden = !hit;
        if (hit) shown++;
      });
      if (none) none.hidden = shown > 0;
    });
  }
  // a link to a launch monitor's entry opens it
  function openTarget() {
    var id = decodeURIComponent(location.hash.slice(1));
    var el = id && doc.getElementById(id);
    if (el && el.tagName === 'DETAILS') { el.hidden = false; el.open = true; }
  }
  window.addEventListener('hashchange', openTarget);
  openTarget();

  // ---------- copy a request ----------
  if (navigator.clipboard) {
    each('.prompt', function (p) {
      var text = p.querySelector('p');
      if (!text) return;
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(text.textContent.trim()).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); });
      });
      p.appendChild(b);
    });
  }

  // ---------- things that ease in ----------
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    each('.rise', function (el) { io.observe(el); });
  } else {
    each('.rise', function (el) { el.classList.add('in'); });
  }

  // the page's own entry in the navigation, scrolled into view on a phone
  var cur = doc.querySelector('.nav a[aria-current="page"]');
  var nav = doc.querySelector('.nav');
  if (cur && nav && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - 24);
})();
