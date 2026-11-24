// Sim Clash site: fills the GitHub links from config.js and starts the hero clip.
// No framework, no network calls, nothing tracked.
(function () {
  'use strict';
  var cfg = window.SIMCLASH_SITE || {};
  var owner = cfg.owner || 'OWNER';
  var repo = cfg.repo || 'sim-clash';
  var branch = cfg.branch || 'main';
  var base = 'https://github.com/' + owner + '/' + repo;
  var releases = base + '/releases';

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
  };

  function linkFor(key) {
    if (links[key]) return links[key];
    // data-gh="blob:docs/match.md" or "tree:tools/arcade-holes": a path in the source tree
    var m = /^(blob|tree):(.+)$/.exec(key);
    return m ? base + '/' + m[1] + '/' + branch + '/' + m[2] : base;
  }

  document.querySelectorAll('a[data-gh]').forEach(function (a) {
    a.href = linkFor(a.getAttribute('data-gh'));
  });
  document.querySelectorAll('[data-fill]').forEach(function (el) {
    var v = fills[el.getAttribute('data-fill')];
    if (v) el.textContent = v;
  });

  // links to other projects whose address is a setting (data-ext): no address, no link
  var bridge = String(cfg.bridgeUrl || '').replace(/\/+$/, '');
  var ext = { bridge: bridge, 'bridge-releases': bridge ? bridge + '/releases' : '' };
  document.querySelectorAll('a[data-ext]').forEach(function (a) {
    var url = ext[a.getAttribute('data-ext')];
    if (url) a.href = url;
  });

  if (owner === 'OWNER' && window.console) {
    console.warn('Sim Clash site: set "owner" in config.js so the GitHub links point at the real repository.');
  }

  // The hero clip is a looping, silent animation. It is fetched only after the page has
  // loaded, and not at all for people who asked for less motion or less data.
  var screen = document.querySelector('[data-clip]');
  if (screen) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var conn = navigator.connection || {};
    var saveData = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
    var toggle = screen.querySelector('[data-clip-toggle]');
    var clip = null;
    var playing = false;

    var show = function (on) {
      playing = on;
      if (clip) clip.hidden = !on;
      if (toggle) {
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        toggle.textContent = on ? 'Pause clip' : 'Play clip';
      }
    };
    var load = function () {
      if (clip) { show(true); return; }
      var img = new Image();
      img.alt = '';
      img.className = 'screen-clip';
      img.decoding = 'async';
      img.onload = function () { clip = img; screen.querySelector('.screen-in').appendChild(img); show(true); };
      img.src = screen.getAttribute('data-clip');
    };
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', function () { if (playing) show(false); else load(); });
    }
    if (!reduce && !saveData) {
      if (document.readyState === 'complete') load();
      else window.addEventListener('load', load);
    }
  }

  // A direct download: the click starts the installer, and a short panel says what happens next.
  if (cfg.downloadUrl) {
    var dlPanel = null;
    var showDl = function () {
      if (!dlPanel) {
        dlPanel = document.createElement('div');
        dlPanel.className = 'dl-panel';
        dlPanel.setAttribute('role', 'dialog');
        dlPanel.setAttribute('aria-label', 'Your download has started');
        dlPanel.innerHTML = '<div class="dl-card">' +
          '<button type="button" class="dl-close" aria-label="Close">×</button>' +
          '<p class="dl-kicker">Sim-Clash-Setup.exe · about 161 MB</p>' +
          '<h2>Your download has started</h2>' +
          '<ol>' +
          '<li><b>Find the file.</b> It is in your Downloads folder. Double-click it when it finishes.</li>' +
          '<li><b>Windows will warn you.</b> It says “Windows protected your PC” because the installer is not code-signed yet. Choose <b>More info</b>, then <b>Run anyway</b>.</li>' +
          '<li><b>Play.</b> Open Sim Clash from your desktop. No launch monitor yet? Press <b>T</b> for test swings.</li>' +
          '</ol>' +
          '<p class="dl-foot">Nothing happening? <a href="' + cfg.downloadUrl + '">Try the download again</a> · <a href="install.html">Install help</a> · <a href="' + links.latest + '">Checksum and older versions</a></p>' +
          '</div>';
        document.body.appendChild(dlPanel);
        var hide = function () { dlPanel.hidden = true; };
        dlPanel.querySelector('.dl-close').addEventListener('click', hide);
        dlPanel.addEventListener('click', function (e) { if (e.target === dlPanel) hide(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
      }
      dlPanel.hidden = false;
      var c = dlPanel.querySelector('.dl-close');
      if (c) c.focus();
    };
    document.querySelectorAll('a[data-gh="download"]').forEach(function (a) {
      a.addEventListener('click', function () { setTimeout(showDl, 200); });
    });
  }
})();
