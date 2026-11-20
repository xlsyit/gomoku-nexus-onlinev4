(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var music = { playing: false, timer: null, nodes: [], step: 0 };
  var unlocked = false;

  function settings() {
    return (window.GC && window.GC.settings) || { sfx: 0.8, music: 0.35, muted: false };
  }

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.connect(master);
      syncVolumes();
    }
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
    return ctx;
  }

  function syncVolumes() {
    var s = settings();
    var muted = !!s.muted;
    if (master) master.gain.value = muted ? 0 : 1;
    if (sfxBus) sfxBus.gain.value = muted ? 0 : Math.max(0, Math.min(1, s.sfx == null ? 0.8 : s.sfx));
    if (musicBus) musicBus.gain.value = muted ? 0 : Math.max(0, Math.min(1, s.music == null ? 0.35 : s.music)) * 0.5;
  }

  function tone(opts) {
    var ac = ensure();
    if (!ac) return;
    if (settings().muted) return;
    var f = opts.f || 440;
    var slide = opts.slide;
    var type = opts.type || 'sine';
    var dur = opts.dur || 0.2;
    var vol = Math.min(0.5, opts.vol == null ? 0.15 : opts.vol);
    var delay = opts.delay || 0;
    var t0 = ac.currentTime + delay;
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(opts) {
    var ac = ensure();
    if (!ac) return;
    if (settings().muted) return;
    var dur = opts.dur || 0.35;
    var vol = Math.min(0.35, opts.vol == null ? 0.12 : opts.vol);
    var delay = opts.delay || 0;
    var from = opts.from || 200;
    var to = opts.to || 2400;
    var t0 = ac.currentTime + delay;
    var len = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = ac.createBufferSource();
    src.buffer = buf;
    var filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function vibrate(pattern) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  /* ---------------- 环境音乐 ---------------- */
  var CHORDS = [
    [220.00, 261.63, 329.63],
    [196.00, 246.94, 293.66],
    [174.61, 220.00, 261.63],
    [233.08, 293.66, 349.23]
  ];

  function playChord() {
    var ac = ensure();
    if (!ac || !music.playing) return;
    var chord = CHORDS[music.step % CHORDS.length];
    music.step++;
    var t0 = ac.currentTime;
    var dur = 9;
    var filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    filter.connect(musicBus);
    var nodes = [filter];
    chord.forEach(function (f, i) {
      [1, 1.004].forEach(function (detune, j) {
        var osc = ac.createOscillator();
        var g = ac.createGain();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = f * (j ? detune : 1);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.035 / (i + 1), t0 + 1.6);
        g.gain.setValueAtTime(0.035 / (i + 1), t0 + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(filter);
        osc.start(t0);
        osc.stop(t0 + dur + 0.2);
        nodes.push(osc, g);
      });
    });
    music.nodes = nodes;
  }

  function startMusic() {
    if (music.playing) return;
    var ac = ensure();
    if (!ac) return;
    music.playing = true;
    music.step = 0;
    playChord();
    music.timer = setInterval(playChord, 8000);
  }

  function stopMusic() {
    music.playing = false;
    if (music.timer) {
      clearInterval(music.timer);
      music.timer = null;
    }
    music.nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) { /* ignore */ }
    });
    music.nodes = [];
  }

  window.SFX = {
    unlock: function () {
      var ac = ensure();
      if (!ac) return;
      if (!unlocked) {
        unlocked = true;
        if (settings().music > 0) startMusic();
      }
      syncVolumes();
    },
    syncVolumes: function () {
      syncVolumes();
      if (settings().muted || settings().music <= 0) stopMusic();
      else if (unlocked && !music.playing) startMusic();
    },
    isMuted: function () { return !!settings().muted; },
    setMuted: function (m) {
      if (window.GC && window.GC.settings) {
        window.GC.settings.muted = !!m;
        if (window.GC.saveSettings) window.GC.saveSettings();
      }
      syncVolumes();
      if (m) stopMusic();
      else if (unlocked) startMusic();
    },
    toggle: function () {
      this.setMuted(!this.isMuted());
      return this.isMuted();
    },
    setMusicEnabled: function (on) {
      if (window.GC && window.GC.settings) {
        window.GC.settings.music = on ? Math.max(0.1, window.GC.settings.music || 0.35) : 0;
        if (window.GC.saveSettings) window.GC.saveSettings();
      }
      syncVolumes();
      if (!on) stopMusic();
      else if (unlocked) startMusic();
    },
    click: function () {
      tone({ f: 880, slide: 640, type: 'sine', dur: 0.07, vol: 0.1 });
    },
    hover: function () {
      tone({ f: 1200, slide: 1000, type: 'sine', dur: 0.04, vol: 0.035 });
    },
    place: function (color) {
      var f = color === 2 ? 430 : 320;
      tone({ f: f, slide: f * 0.9, type: 'triangle', dur: 0.09, vol: 0.16 });
      noise({ dur: 0.06, vol: 0.05, from: 2600, to: 900 });
      vibrate(12);
    },
    illegal: function () {
      tone({ f: 200, slide: 120, type: 'square', dur: 0.16, vol: 0.12 });
      tone({ f: 150, slide: 90, type: 'square', dur: 0.2, vol: 0.1, delay: 0.08 });
      vibrate([20, 40, 20]);
    },
    turn: function () {
      tone({ f: 880, type: 'sine', dur: 0.12, vol: 0.13 });
      tone({ f: 1174.66, type: 'sine', dur: 0.16, vol: 0.12, delay: 0.1 });
      vibrate([14, 60, 14]);
    },
    join: function () {
      tone({ f: 523.25, type: 'triangle', dur: 0.14, vol: 0.12 });
      tone({ f: 783.99, type: 'triangle', dur: 0.18, vol: 0.11, delay: 0.09 });
    },
    leave: function () {
      tone({ f: 523.25, type: 'triangle', dur: 0.16, vol: 0.11 });
      tone({ f: 349.23, type: 'triangle', dur: 0.24, vol: 0.1, delay: 0.1 });
    },
    rematch: function () {
      tone({ f: 659.25, type: 'sine', dur: 0.12, vol: 0.12 });
      tone({ f: 880, type: 'sine', dur: 0.14, vol: 0.12, delay: 0.08 });
      tone({ f: 1046.5, type: 'sine', dur: 0.18, vol: 0.12, delay: 0.16 });
    },
    tick: function (urgent) {
      tone({ f: urgent ? 1046 : 784, type: 'square', dur: 0.05, vol: urgent ? 0.1 : 0.06 });
    },
    effect: function (level) {
      if (level <= 1) {
        tone({ f: 520, slide: 660, type: 'sine', dur: 0.12, vol: 0.12 });
      } else if (level === 2) {
        tone({ f: 520, type: 'sine', dur: 0.14, vol: 0.12 });
        tone({ f: 660, type: 'sine', dur: 0.14, vol: 0.12, delay: 0.07 });
      } else if (level === 3) {
        tone({ f: 520, type: 'sine', dur: 0.16, vol: 0.13 });
        tone({ f: 660, type: 'sine', dur: 0.16, vol: 0.13, delay: 0.06 });
        tone({ f: 880, type: 'sine', dur: 0.2, vol: 0.13, delay: 0.12 });
      } else if (level === 4) {
        tone({ f: 420, slide: 880, type: 'sawtooth', dur: 0.2, vol: 0.1 });
        tone({ f: 660, type: 'sine', dur: 0.22, vol: 0.14, delay: 0.02 });
        tone({ f: 1040, type: 'sine', dur: 0.26, vol: 0.14, delay: 0.1 });
        noise({ dur: 0.3, vol: 0.1, from: 300, to: 3600 });
      } else {
        tone({ f: 440, type: 'sine', dur: 0.24, vol: 0.13 });
        tone({ f: 660, type: 'sine', dur: 0.24, vol: 0.13, delay: 0.06 });
        tone({ f: 880, type: 'sine', dur: 0.3, vol: 0.14, delay: 0.12 });
        noise({ dur: 0.5, vol: 0.13, from: 500, to: 5000 });
      }
    },
    counter: function (level) {
      tone({ f: 170, slide: 90, type: 'sawtooth', dur: 0.22, vol: 0.14 });
      tone({ f: 340, slide: 520, type: 'sine', dur: 0.2, vol: 0.12, delay: 0.04 });
      noise({ dur: 0.24, vol: 0.12, from: 800, to: 2400 });
      if (level >= 4) {
        tone({ f: 620, slide: 920, type: 'triangle', dur: 0.26, vol: 0.13, delay: 0.08 });
      }
    },
    win: function () {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (n, i) {
        tone({ f: n, type: 'triangle', dur: 0.32, vol: 0.17, delay: i * 0.13 });
        tone({ f: n * 2, type: 'sine', dur: 0.2, vol: 0.07, delay: i * 0.13 });
      });
      tone({ f: 1318.5, type: 'sine', dur: 0.6, vol: 0.15, delay: 0.55 });
      noise({ dur: 0.7, vol: 0.08, from: 1200, to: 5200, delay: 0.3 });
      vibrate([30, 60, 30, 60, 90]);
    },
    lose: function () {
      var notes = [392.0, 349.23, 293.66, 246.94];
      notes.forEach(function (n, i) {
        tone({ f: n, type: 'triangle', dur: 0.34, vol: 0.15, delay: i * 0.16 });
      });
      tone({ f: 196, type: 'sine', dur: 0.7, vol: 0.1, delay: 0.5 });
      vibrate([60, 40, 60]);
    },
    draw: function () {
      tone({ f: 440, type: 'sine', dur: 0.28, vol: 0.13 });
      tone({ f: 440, type: 'sine', dur: 0.28, vol: 0.13, delay: 0.18 });
      tone({ f: 554.37, type: 'sine', dur: 0.4, vol: 0.12, delay: 0.36 });
    },
    whoosh: function () {
      noise({ dur: 0.55, vol: 0.18, from: 160, to: 4200 });
      tone({ f: 180, slide: 720, type: 'sine', dur: 0.5, vol: 0.1 });
    },
    pauseMusic: function () { stopMusic(); },
    resumeMusic: function () {
      if (!settings().muted && settings().music > 0 && unlocked) startMusic();
    }
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopMusic();
    else if (unlocked && !settings().muted && settings().music > 0) {
      startMusic();
    }
  });
})();