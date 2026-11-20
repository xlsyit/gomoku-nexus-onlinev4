(function () {
  'use strict';

  function starsFor(size) {
    if (size === 9) return [[2, 2], [4, 4], [6, 6]];
    if (size === 13) return [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]];
    if (size === 19) return [
      [3, 3], [3, 9], [3, 15],
      [9, 3], [9, 9], [9, 15],
      [15, 3], [15, 9], [15, 15]
    ];
    return [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
  }

  var defaults = {
    auto: false,
    interval: 30,
    duration: 1.2,
    boardSize: 15,
    rule: 'free',
    uiTheme: 'neon',
    sfx: 0.8,
    music: 0.35,
    muted: false,
    fx: 'full'
  };

  var settings = {
    auto: defaults.auto,
    interval: defaults.interval,
    duration: defaults.duration,
    boardSize: defaults.boardSize,
    rule: defaults.rule,
    uiTheme: defaults.uiTheme,
    sfx: defaults.sfx,
    music: defaults.music,
    muted: defaults.muted,
    fx: defaults.fx
  };

  function clamp01(v, fallback) {
    var n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  try {
    var saved = JSON.parse(window.localStorage.getItem('gmx_settings') || 'null');
    if (saved) {
      settings.auto = !!saved.auto;
      if (typeof saved.interval === 'number') settings.interval = Math.max(8, Math.min(120, saved.interval));
      if (typeof saved.duration === 'number') settings.duration = Math.max(0.5, Math.min(2.5, saved.duration));
      if ([9, 13, 15, 19].indexOf(saved.boardSize) >= 0) settings.boardSize = saved.boardSize;
      if (['free', 'renju', 'folk'].indexOf(saved.rule) >= 0) settings.rule = saved.rule;
      else if (typeof saved.renju === 'boolean' && saved.renju) settings.rule = 'renju';
      if (['neon', 'paper', 'terminal'].indexOf(saved.uiTheme) >= 0) settings.uiTheme = saved.uiTheme;
      settings.sfx = clamp01(saved.sfx, defaults.sfx);
      settings.music = clamp01(saved.music, defaults.music);
      settings.muted = !!saved.muted;
      if (['full', 'lite', 'off'].indexOf(saved.fx) >= 0) settings.fx = saved.fx;
    }
    var savedNick = window.localStorage.getItem('gmx_nickname') || '';
    if (savedNick) settings.lastNickname = savedNick;
  } catch (e) { /* ignore */ }

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var GC = window.GC = {
    SIZE: settings.boardSize,
    PLAYER_NAMES: ['黑方', '白方'],
    DIFFICULTY_NAMES: { easy: '简单', normal: '普通', hard: '困难', master: '大师' },
    STARS: starsFor(settings.boardSize),
    SERVER_URL: '',
    PREFERS_REDUCED_MOTION: !!(motionQuery && motionQuery.matches),
    starsFor: starsFor
  };

  GC.settings = settings;
  if (settings.lastNickname) GC.lastNickname = settings.lastNickname;

  if (motionQuery) {
    var onMotionChange = function (e) {
      GC.PREFERS_REDUCED_MOTION = !!e.matches;
      if (window.FX && window.FX.syncIntensity) window.FX.syncIntensity();
      if (window.PS && window.PS.syncBudget) window.PS.syncBudget();
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  /* 特效档位：用户选择 + 系统偏好。系统要求减少动效时至少降到 lite。 */
  GC.effectiveFx = function () {
    var fx = GC.settings.fx || 'full';
    if (GC.PREFERS_REDUCED_MOTION && fx === 'full') return 'lite';
    return fx;
  };

  GC.saveSettings = function () {
    try {
      window.localStorage.setItem('gmx_settings', JSON.stringify({
        auto: GC.settings.auto,
        interval: GC.settings.interval,
        duration: GC.settings.duration,
        boardSize: GC.settings.boardSize,
        rule: GC.settings.rule,
        uiTheme: GC.settings.uiTheme,
        sfx: GC.settings.sfx,
        music: GC.settings.music,
        muted: GC.settings.muted,
        fx: GC.settings.fx
      }));
    } catch (e) { /* ignore */ }
  };

  GC.saveNickname = function (nick) {
    try {
      window.localStorage.setItem('gmx_nickname', nick || '');
      GC.lastNickname = nick;
    } catch (e) { /* ignore */ }
  };

  GC.applyUiTheme = function () {
    var theme = GC.settings.uiTheme || 'neon';
    if (document.documentElement) document.documentElement.dataset.uiTheme = theme;
    if (document.body) document.body.dataset.uiTheme = theme;
  };

  GC.setBoardSize = function (size) {
    size = [9, 13, 15, 19].indexOf(size) >= 0 ? size : 15;
    GC.settings.boardSize = size;
    GC.SIZE = size;
    GC.STARS = starsFor(size);
    GC.saveSettings();
  };

  /* 屏幕阅读器播报 */
  var liveRegion = null;
  GC.announce = function (text) {
    if (!liveRegion) liveRegion = document.getElementById('a11yLive');
    if (!liveRegion) return;
    liveRegion.textContent = '';
    window.setTimeout(function () { liveRegion.textContent = text; }, 30);
  };

  /* 本机战绩（人机/本地对局） */
  var LOCAL_STATS_KEY = 'gmx_local_stats';
  GC.localStats = function () {
    try {
      var raw = JSON.parse(window.localStorage.getItem(LOCAL_STATS_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          wins: raw.wins || 0,
          losses: raw.losses || 0,
          draws: raw.draws || 0,
          bestCombo: raw.bestCombo || 0,
          fastestWin: raw.fastestWin || 0
        };
      }
    } catch (e) { /* ignore */ }
    return { wins: 0, losses: 0, draws: 0, bestCombo: 0, fastestWin: 0 };
  };

  GC.recordLocalResult = function (outcome, moves, combo) {
    var s = GC.localStats();
    if (outcome === 'win') {
      s.wins++;
      if (!s.fastestWin || (moves > 0 && moves < s.fastestWin)) s.fastestWin = moves;
    } else if (outcome === 'loss') {
      s.losses++;
    } else if (outcome === 'draw') {
      s.draws++;
    }
    if (combo > s.bestCombo) s.bestCombo = combo;
    try { window.localStorage.setItem(LOCAL_STATS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  };
})();