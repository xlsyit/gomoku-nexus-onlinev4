(function () {
  'use strict';

  var GC = window.GC;
  var Rules = window.Rules;
  var SIZE = GC.SIZE;
  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');

  var els = {
    hud: document.getElementById('hud'),
    cover: document.getElementById('cover'),
    winOverlay: document.getElementById('winOverlay'),
    turnChip: document.getElementById('turnChip'),
    themeChip: document.getElementById('themeChip'),
    connChip: document.getElementById('connChip'),
    comboChip: document.getElementById('comboChip'),
    winTitle: document.getElementById('winTitle'),
    winMeta: document.getElementById('winMeta'),
    winEmblem: document.getElementById('winEmblem'),
    winRematchArea: document.getElementById('winRematchArea'),
    winRematchStatus: document.getElementById('winRematchStatus'),
    winNormalActions: document.getElementById('winNormalActions'),
    btnRematch: document.getElementById('btnRematch'),
    btnRematchBack: document.getElementById('btnRematchBack'),
    btnAuto: document.getElementById('btnAuto'),
    btnMenu: document.getElementById('btnMenu'),
    btnRestart: document.getElementById('btnRestart'),
    btnUndo: document.getElementById('btnUndo'),
    btnHint: document.getElementById('btnHint'),
    btnAgain: document.getElementById('btnAgain'),
    btnBackWin: document.getElementById('btnBackWin'),
    btnMuteGame: document.getElementById('btnMuteGame'),
    btnMuteCover: document.getElementById('btnMuteCover')
  };

  var W = 0;
  var H = 0;
  var DPR = 1;
  var time = 0;
  var last = performance.now();
  var scene = 'cover';
  var game = null;
  var cover = null;
  var raf = 0;
  var activeAmbient = null;
  var options = {};
  var geomCache = null;
  var lastTickSecond = -1;

  function inB(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function withAlpha(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function easeInOut(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  function easeOutBack(p) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  }

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function openDialog(d) { if (d && !d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } var s = d.querySelector('.panel-sheet'); if (s) s.scrollTop = 0; } }
  function closeDialog(d) { if (d && d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } } }
  function anyDialogOpen() { return !!document.querySelector('dialog[open]'); }

  function announce(text) {
    if (GC.announce) GC.announce(text);
  }

  // ---------------- 棋盘几何（带缓存） ----------------

  function boardGeom() {
    if (geomCache && geomCache.w === W && geomCache.h === H && geomCache.size === SIZE) return geomCache;
    var pad = Math.max(22, Math.min(W, H) * 0.04);
    var side = Math.min(W, H) * 0.78;
    var cell = Math.max(9, (side - pad * 2) / (SIZE - 1));
    var ox = (W - side) / 2;
    var oy = (H - side) / 2;
    geomCache = { pad: pad, side: side, cell: cell, ox: ox, oy: oy, w: W, h: H, size: SIZE };
    return geomCache;
  }

  function ix(c) {
    var g = boardGeom();
    return g.ox + g.pad + c * g.cell;
  }

  function iy(r) {
    var g = boardGeom();
    return g.oy + g.pad + r * g.cell;
  }

  function cellAt(px, py) {
    var g = boardGeom();
    if (px < g.ox - 8 || px > g.ox + g.side + 8 || py < g.oy - 8 || py > g.oy + g.side + 8) return null;
    var c = Math.round((px - g.ox - g.pad) / g.cell);
    var r = Math.round((py - g.oy - g.pad) / g.cell);
    if (!inB(r, c)) return null;
    return { r: r, c: c };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function luminance(hex) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // ---------------- 棋形分析（仅用于特效/文案，不参与胜负） ----------------

  function analyzeMove(board, r, c, p) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    var patterns = [];
    for (var d = 0; d < 4; d++) {
      var dr = dirs[d][0];
      var dc = dirs[d][1];
      var len = 1;
      for (var rr = r + dr, cc = c + dc; inB(rr, cc) && board[rr][cc] === p; rr += dr, cc += dc) len++;
      for (var rr2 = r - dr, cc2 = c - dc; inB(rr2, cc2) && board[rr2][cc2] === p; rr2 -= dr, cc2 -= dc) len++;
      var e1 = inB(r + dr, c + dc) && board[r + dr][c + dc] === 0 ? 1 : 0;
      var e2 = inB(r - dr, c - dc) && board[r - dr][c - dc] === 0 ? 1 : 0;
      patterns.push({ dir: d, len: len, open: e1 + e2 });
    }
    var five = null;
    for (var fi = 0; fi < patterns.length; fi++) {
      if (patterns[fi].len >= 5) { five = patterns[fi]; break; }
    }
    if (five) return { tier: 6, len: five.len, open: five.open, dir: five.dir, patterns: patterns, strong: 1 };
    var maxTier = 0;
    var maxLen = 0;
    var maxOpen = 0;
    var maxDir = 0;
    for (var i = 0; i < patterns.length; i++) {
      var ptn = patterns[i];
      var tier = 0;
      if (ptn.len === 4) tier = ptn.open >= 1 ? 4 : 0;
      else if (ptn.len === 3) tier = ptn.open === 2 ? 3 : ptn.open === 1 ? 2 : 0;
      else if (ptn.len === 2 && ptn.open >= 1) tier = 1;
      if (tier > maxTier) {
        maxTier = tier;
        maxLen = ptn.len;
        maxOpen = ptn.open;
        maxDir = ptn.dir;
      }
    }
    var strong = 0;
    for (var si = 0; si < patterns.length; si++) {
      if (patterns[si].len >= 3 && patterns[si].open >= 1) strong++;
    }
    if (strong >= 2 && maxTier >= 3) maxTier = 5;
    return { tier: maxTier, len: maxLen, open: maxOpen, dir: maxDir, patterns: patterns, strong: strong };
  }

  function findWinLine(board, r, c, p) {
    var wl = Rules.winLine(board, SIZE, r, c, p);
    return wl ? { r1: wl.r1, c1: wl.c1, r2: wl.r2, c2: wl.c2 } : null;
  }

  function isBreakingMove(board, r, c, opp) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    var best = 0;
    for (var d = 0; d < 4; d++) {
      var dr = dirs[d][0];
      var dc = dirs[d][1];
      var a = 0;
      var rr = r + dr;
      var cc = c + dc;
      while (inB(rr, cc) && board[rr][cc] === opp) { a++; rr += dr; cc += dc; }
      var openA = inB(rr, cc) && board[rr][cc] === 0;
      var b = 0;
      rr = r - dr;
      cc = c - dc;
      while (inB(rr, cc) && board[rr][cc] === opp) { b++; rr -= dr; cc -= dc; }
      var openB = inB(rr, cc) && board[rr][cc] === 0;
      var total = a + b;
      var tier = 0;
      if (total >= 5) tier = 5;
      else if (total === 4 && (openA || openB)) tier = 4;
      else if (total === 3 && openA && openB) tier = 3;
      if (tier > best) best = tier;
    }
    return best;
  }

  // ---------------- 对局控制 ----------------

  function createSim() {
    return {
      board: Rules.makeBoard(SIZE),
      current: 1,
      winner: 0,
      winLine: null,
      lastMove: null,
      moves: 0
    };
  }

  function startGame(settings) {
    if (game && game.aiTimer) clearTimeout(game.aiTimer);
    settings = settings || { mode: 'pvp' };
    SIZE = settings.size || window.GC.SIZE || 15;
    if ([9, 11, 13, 15, 19].indexOf(SIZE) < 0) SIZE = 15;
    window.GC.SIZE = SIZE;
    window.GC.STARS = window.GC.starsFor(SIZE);
    geomCache = null;

    var humanColor = 1;
    if (settings.mode === 'ai') humanColor = settings.humanSide === 0 ? 1 : 2;

    game = {
      settings: settings,
      sim: createSim(),
      theme: window.Theme.random(null),
      stoneAnims: [],
      combo: { streak: 0, best: 0 },
      autoTimer: 0,
      aiThinking: false,
      aiTimer: null,
      ghost: null,
      cursor: { r: Math.floor((SIZE - 1) / 2), c: Math.floor((SIZE - 1) / 2) },
      switching: null,
      ambient: null,
      rule: settings.rule || (settings.renju ? 'renju' : (window.GC.settings && window.GC.settings.rule) || 'free'),
      renjuLoss: false,
      myColor: (settings.mode === 'online') ? settings.myColor : 0,
      humanColor: humanColor,
      isMyTurn: (settings.mode === 'online') ? settings.myColor === 1 : true,
      onlineActive: (settings.mode === 'online') || false,
      onlineEnded: false,
      awaitingResult: false,
      lastLocalMove: null,
      endReason: '',
      rematchRequested: false,
      rematchReceived: false,
      history: [],
      turnSeconds: settings.turnSeconds || 30,
      clock: { remaining: settings.turnSeconds || 30 },
      hint: null,
      _spriteKey: null,
      _sprite: null
    };
    game.aiPlayer = settings && settings.mode === 'ai' ? (settings.humanSide === 0 ? 2 : 1) : 0;

    if (game.onlineActive) {
      var onlineNick = settings.myNickname || '你';
      var oppNick = settings.opponentNickname || '对手';
      GC.PLAYER_NAMES = [
        game.myColor === 1 ? onlineNick : oppNick,
        game.myColor === 2 ? onlineNick : oppNick
      ];
    } else if (settings.mode === 'ai') {
      var humanName = settings.humanSide === 0 ? '你' : 'AI';
      var aiName = settings.humanSide === 0 ? 'AI' : '你';
      GC.PLAYER_NAMES = [humanName, aiName];
    } else {
      GC.PLAYER_NAMES = ['黑方', '白方'];
    }

    applyThemeLight();
    window.FX.clear();
    window.FX.syncIntensity();
    window.PS.clear();
    game.ambient = window.Theme.createAmbient(game.theme, window.PS, W, H);
    activeAmbient = game.ambient;
    scene = 'game';
    hide(els.cover);
    closeDialog(els.winOverlay);
    show(els.hud);
    els.btnUndo.classList.toggle('hidden', game.onlineActive);
    els.btnHint.classList.toggle('hidden', game.onlineActive);
    if (game.onlineActive) {
      show(els.connChip);
      updateConnChip();
    } else {
      hide(els.connChip);
    }
    refreshAutoChip();
    updateHud();
    if (game.aiPlayer && game.sim.current === game.aiPlayer) scheduleAi();
  }

  function backToMenu() {
    if (game && game.onlineActive) {
      if (!game.onlineEnded) window.Network.sendAbort();
      window.Network.leaveRoom();
    }
    if (game && game.aiTimer) clearTimeout(game.aiTimer);
    game = null;
    scene = 'cover';
    GC.PLAYER_NAMES = ['黑方', '白方'];
    closeDialog(els.winOverlay);
    window.FX.clear();
    if (cover) {
      window.PS.clear();
      cover.ambient = window.Theme.createAmbient(cover.theme, window.PS, W, H);
    }
    activeAmbient = cover ? cover.ambient : null;
    hide(els.hud);
    show(els.cover);
    window.Cover.show();
  }

  function restoreOnlineGame(state, color) {
    if (!state || !color) return;
    var session = window.Network.getSession ? window.Network.getSession() : null;
    var myNick = (session && session.nickname) || (color === 1 ? '黑方' : '白方');
    var oppNick = state.players ? (color === 1 ? state.players[2] : state.players[1]) : '对手';
    startGame({
      mode: 'online',
      size: state.size || window.GC.SIZE,
      rule: state.rule || (state.renju ? 'renju' : 'free'),
      myColor: color,
      myNickname: myNick,
      opponentNickname: oppNick || '对手',
      roomCode: session ? session.code : null,
      turnSeconds: state.turnSeconds || 30
    });
    var next = [];
    for (var r = 0; r < SIZE; r++) next.push(state.board[r].slice());
    game.sim.board = next;
    game.sim.current = state.currentTurn || 1;
    game.sim.winner = state.winner || 0;
    game.sim.lastMove = state.lastMove || null;
    game.sim.moves = state.moveCount || 0;
    game.onlineEnded = !!state.gameOver;
    game.awaitingResult = !!state.gameOver;
    game.endReason = state.reason || '';
    game.clock.remaining = state.remaining != null ? state.remaining : 30;
    game.isMyTurn = !game.onlineEnded && game.sim.current === color;
    updateHud();
    if (state.gameOver && state.winner) {
      game.sim.winLine = state.lastMove ? findWinLine(game.sim.board, state.lastMove.r, state.lastMove.c, state.winner) : null;
      handleWin(state.winner, state.reason || 'five');
    } else if (state.gameOver && state.draw) {
      handleDraw();
    }
  }

  function isMyTurnNow() {
    if (!game) return false;
    if (!game.onlineActive) return true;
    return game.sim.current === game.myColor;
  }

  function canPlace() {
    if (!game || scene !== 'game' || game.sim.winner || game.switching) return false;
    if (game.awaitingResult || game.onlineEnded) return false;
    if (game.onlineActive && !isMyTurnNow()) return false;
    if (game.aiThinking) return false;
    if (game.aiPlayer && game.sim.current === game.aiPlayer) return false;
    return true;
  }

  function placeMove(r, c) {
    if (!game) return;
    var sim = game.sim;
    var p = sim.current;
    var verdict = Rules.judge(sim.board, SIZE, game.rule, r, c, p);

    if (!verdict.ok) {
      if (verdict.forbidden) {
        if (game.onlineActive) {
          // 交给服务端裁决，客户端只提示
          window.Network.sendMove(r, c);
          window.SFX.illegal();
          window.FX.toast('禁手，等待服务端裁决…', ix(c), iy(r) - 30, '#ff6b6b', true);
          return;
        }
        game.renjuLoss = true;
        sim.winner = 2;
        sim.lastMove = { r: r, c: c };
        window.FX.toast('黑方禁手 · 白方获胜', W / 2, H / 2, '#ff6b6b', false);
        window.SFX.counter(5);
        handleWin(2, 'forbidden');
      } else {
        window.SFX.illegal();
      }
      return;
    }

    // rules.judge 已把棋子放上棋盘
    sim.moves++;
    sim.lastMove = { r: r, c: c };
    game.history.push({ r: r, c: c, color: p });
    game.stoneAnims.push({ r: r, c: c, t0: time });
    window.SFX.place(p);
    var info = analyzeMove(sim.board, r, c, p);
    triggerCombo(info, r, c, p);

    if (game.onlineActive) {
      game.lastLocalMove = { r: r, c: c };
      window.Network.sendMove(r, c);
      if (verdict.win || verdict.draw) {
        game.awaitingResult = true;
      } else {
        sim.current = 3 - p;
        game.isMyTurn = (sim.current === game.myColor);
      }
      updateHud();
      return;
    }

    if (verdict.win) {
      sim.winLine = findWinLine(sim.board, r, c, p);
      handleWin(p, 'five');
      return;
    }
    if (verdict.draw) {
      handleDraw();
      return;
    }
    sim.current = 3 - p;
    updateHud();
    if (game.aiPlayer && sim.current === game.aiPlayer) scheduleAi();
  }

  function placeRemoteMove(r, c, color) {
    if (!game || game.sim.winner || game.switching) return;
    var sim = game.sim;
    if (!inB(r, c) || sim.board[r][c] !== 0) return;
    var p = color || sim.current;
    var verdict = Rules.judge(sim.board, SIZE, game.rule, r, c, p);
    if (!verdict.ok) {
      // 与服务端状态不一致：请求一次重连同步
      window.Network.rejoinRoom((window.Network.getSession() || {}).code, (window.Network.getSession() || {}).token);
      return;
    }

    sim.moves++;
    sim.lastMove = { r: r, c: c };
    game.history.push({ r: r, c: c, color: p });
    game.stoneAnims.push({ r: r, c: c, t0: time });
    window.SFX.place(p);
    var info = analyzeMove(sim.board, r, c, p);
    triggerCombo(info, r, c, p);

    if (verdict.win || verdict.draw) {
      game.awaitingResult = true;
    } else {
      sim.current = 3 - p;
      game.isMyTurn = (sim.current === game.myColor);
      if (game.isMyTurn) window.SFX.turn();
    }
    updateHud();
  }

  function scheduleAi() {
    if (!game) return;
    if (game.aiTimer) clearTimeout(game.aiTimer);
    game.aiThinking = true;
    updateHud();
    var g = game;
    var delay = 140 + Math.random() * 220;
    game.aiTimer = setTimeout(function () {
      if (!g || game !== g || scene !== 'game' || g.sim.winner) return;
      var done = function (move) {
        if (!g || game !== g || scene !== 'game') return;
        g.aiThinking = false;
        updateHud();
        if (move) placeMove(move.r, move.c);
      };
      var p = window.AI.chooseMoveAsync(g.sim.board, g.aiPlayer, g.settings.difficulty || 'normal', g.rule || 'free');
      if (p && p.then) p.then(done);
      else done(p);
    }, delay);
  }

  function triggerCombo(info, r, c, p) {
    var th = game.theme;
    var px = ix(c);
    var py = iy(r);
    var st = th.pieces[p === 1 ? 0 : 1];
    var colors = [th.accent, th.accent2, st.edge, '#ffffff'];
    var tier = info.tier;
    var brk = isBreakingMove(game.sim.board, r, c, 3 - p);
    var gain = 0;

    window.FX.burst(px, py, colors, 7, { speed: 90, size: 2.2, life: 0.7 });
    if (tier >= 1 || brk >= 3) {
      window.FX.ring(px, py, th.accent, 56, 0.55, 2.6, 12);
    }

    if (brk >= 3) {
      window.Theme.playThemeFx(th, 'break', brk, px, py, colors);
      if (brk >= 5) {
        window.FX.shake(13, 0.55);
        window.FX.flash('#ffffff', 0.25, 0.4);
        window.FX.pulseZoom(1, 1.06, 0.4);
      } else if (brk >= 4) {
        window.FX.shake(10, 0.45);
        window.FX.pulseZoom(1, 1.04, 0.35);
      } else {
        window.FX.shake(6, 0.35);
      }
      window.FX.toast(
        brk >= 5 ? '绝杀封堵!' : brk >= 4 ? '破解冲四!' : '封锁活三!',
        px, py - 58,
        brk >= 4 ? th.accent2 : th.accent,
        false
      );
      window.SFX.counter(brk);
      gain = Math.max(gain, brk);
    }

    if (tier >= 2) {
      window.Theme.playThemeFx(th, 'move', tier, px, py, colors);
      window.SFX.effect(tier);
      var labels = { 2: '流星三连', 3: '彗星活三', 4: '雷暴四连', 5: '双线新星' };
      window.FX.toast(labels[tier], px, py - 34, tier >= 4 ? th.accent2 : th.accent, tier <= 2);
      gain = Math.max(gain, tier);
      if (Math.random() < 0.18) {
        window.FX.burst(px, py, [th.accent, '#ffffff'], 16, { speed: 180, size: 2.6, life: 0.9 });
      }
    }

    if (tier === 3) window.FX.shake(5, 0.32);
    if (tier === 4) window.FX.shake(8, 0.4);
    if (tier === 5) {
      window.FX.shake(12, 0.55);
      window.FX.pulseZoom(1, 1.05, 0.4);
      window.FX.flash(th.accent2, 0.18, 0.35);
    }

    if (gain >= 2) {
      game.combo.streak++;
      game.combo.best = Math.max(game.combo.best, game.combo.streak);
    } else {
      game.combo.streak = 0;
    }
    updateCombo();
  }

  function reasonLabel(reason) {
    if (reason === 'forbidden') return '黑方禁手';
    if (reason === 'timeout') return '对手超时';
    if (reason === 'leave') return '对手离开';
    if (reason === 'disconnect') return '对手掉线';
    if (reason === 'draw') return '棋盘已满';
    return '五连珠';
  }

  function handleWin(p, reason) {
    if (!game || game._winShown) return;
    game._winShown = true;
    var sim = game.sim;
    var name = p === 1 ? GC.PLAYER_NAMES[0] : GC.PLAYER_NAMES[1];
    var lastMove = sim.lastMove;
    var myWin = !game.onlineActive || p === game.myColor;

    updateHud();

    if (game.onlineActive && game.myColor) {
      if (myWin) window.SFX.win();
      else window.SFX.lose();
    } else {
      window.SFX.win();
    }

    if (!GC.PREFERS_REDUCED_MOTION && game.theme) {
      window.FX.setSlowmo(0.35, 1200);
      window.FX.flash('#ffffff', 0.4, 0.5);
      window.FX.shake(14, 0.7);
      window.FX.pulseZoom(1, 1.08, 0.6);
      window.FX.fireworks(W * 0.5, H * 0.38);
    }
    var toastText = reason === 'forbidden' ? '黑方禁手 · 白方获胜' : '五连珠 · ' + name + '胜';
    window.FX.toast(toastText, lastMove ? ix(lastMove.c) : W / 2, lastMove ? iy(lastMove.r) - 44 : H / 2, '#ffd66e', false);
    announce(name + '获胜，' + reasonLabel(reason));

    if (!game.onlineActive && game.settings.mode === 'ai') {
      var outcome = p === game.humanColor ? 'win' : 'loss';
      GC.recordLocalResult(outcome, sim.moves, game.combo.best);
    }

    var g = game;
    setTimeout(function () {
      if (!g || game !== g || scene !== 'game') return;
      var comboMeta = ' · 最长特效连击 ×' + g.combo.best + ' · 共 ' + sim.moves + ' 手';
      if (g.onlineActive && g.myColor) {
        els.winTitle.textContent = myWin ? '你获胜' : '你落败';
        els.winMeta.textContent = (myWin ? '' : name + ' 获胜 · ') + reasonLabel(reason) + comboMeta;
      } else {
        els.winTitle.textContent = name + '获胜';
        els.winMeta.textContent = reasonLabel(reason) + comboMeta;
      }
      els.winEmblem.textContent = game.onlineActive ? (myWin ? '🏆' : '💔') : '🏆';
      if (g.onlineActive) {
        showOnlineWinControls();
      } else {
        hide(els.winRematchArea);
        show(els.winNormalActions);
      }
      hide(els.hud);
      openDialog(els.winOverlay);
    }, 1100);
  }

  function handleDraw() {
    if (!game) return;
    if (game._winShown) return;
    game._winShown = true;
    game.sim.winner = 0;
    window.SFX.draw();
    window.FX.toast('和棋 · 棋盘已满', W / 2, H / 2, '#ffd66e', false);
    announce('和棋，棋盘已满');
    if (!game.onlineActive && game.settings.mode === 'ai') {
      GC.recordLocalResult('draw', game.sim.moves, game.combo.best);
    }
    var g = game;
    setTimeout(function () {
      if (!g || game !== g || scene !== 'game') return;
      els.winTitle.textContent = '和棋';
      els.winMeta.textContent = reasonLabel('draw') + ' · 共 ' + g.sim.moves + ' 手';
      els.winEmblem.textContent = '🤝';
      if (g.onlineActive) showOnlineWinControls();
      else {
        hide(els.winRematchArea);
        show(els.winNormalActions);
      }
      hide(els.hud);
      openDialog(els.winOverlay);
    }, 900);
  }

  function showOnlineWinControls() {
    hide(els.winNormalActions);
    show(els.winRematchArea);
    if (game.rematchReceived) {
      els.winRematchStatus.textContent = '对手请求再战！';
      els.btnRematch.textContent = '接受再战';
      els.btnRematch.onclick = function () {
        window.SFX.click();
        window.Network.acceptRematch();
        game.rematchRequested = false;
        game.rematchReceived = false;
      };
      show(els.btnRematch);
    } else if (game.rematchRequested) {
      els.winRematchStatus.textContent = '已发送再战请求，等待对方…';
      hide(els.btnRematch);
    } else {
      els.winRematchStatus.textContent = '';
      els.btnRematch.textContent = '请求再战';
      els.btnRematch.onclick = function () {
        window.SFX.click();
        window.Network.acceptRematch();   // 登记自己的票
        window.Network.requestRematch();  // 通知对手
        game.rematchRequested = true;
        els.winRematchStatus.textContent = '已发送再战请求，等待对方…';
        hide(els.btnRematch);
      };
      show(els.btnRematch);
    }
  }

  function updateHud() {
    if (!game) return;
    var sim = game.sim;
    var thinking = game.aiThinking;
    var label;
    if (thinking) {
      label = 'AI 思考中…';
    } else if (sim.winner) {
      label = (sim.winner === 1 ? GC.PLAYER_NAMES[0] : GC.PLAYER_NAMES[1]) + '胜';
    } else if (game.onlineActive && !isMyTurnNow()) {
      label = '等待对手…';
    } else if (game.awaitingResult && game.onlineActive) {
      label = '结算中…';
    } else {
      label = (sim.current === 1 ? GC.PLAYER_NAMES[0] : GC.PLAYER_NAMES[1]) + '回合';
    }
    if (game.onlineActive && !sim.winner && game.clock) {
      label += ' · ' + game.clock.remaining + 's';
    }
    els.turnChip.textContent = label;
    els.turnChip.classList.toggle('thinking', !!thinking || (game.onlineActive && !isMyTurnNow() && !sim.winner));
    els.turnChip.classList.toggle('urgent', game.onlineActive && !sim.winner && game.clock && game.clock.remaining <= 5);
    els.themeChip.textContent = game.theme.name + ' · ' + game.theme.tagline;
    updateCombo();
    // 便于自动化/客服排查的只读状态（不参与逻辑）
    document.body.dataset.turn = String(sim.current);
    document.body.dataset.moves = String(sim.moves);
    document.body.dataset.winner = String(sim.winner || 0);
    document.body.dataset.myColor = String(game.myColor || 0);
    document.body.dataset.scene = scene;
  }

  function updateCombo() {
    if (!game) return;
    if (game.combo.streak >= 2) {
      els.comboChip.textContent = '✦ 特效连击 ×' + game.combo.streak;
      show(els.comboChip);
    } else {
      hide(els.comboChip);
    }
  }

  function updateConnChip() {
    if (!els.connChip) return;
    var ok = window.Network && window.Network.isConnected && window.Network.isConnected();
    els.connChip.textContent = ok ? '已连接' : '重连中…';
    els.connChip.classList.toggle('offline', !ok);
  }

  // ---------------- 悔棋 / 提示 ----------------

  function undoMove() {
    if (!game) return;
    if (game.onlineActive) {
      window.FX.toast('在线对局不支持悔棋', W / 2, H / 2, '#ffd66e', true);
      return;
    }
    if (game.aiTimer) clearTimeout(game.aiTimer);
    game.aiThinking = false;
    if (!game.history.length) {
      window.FX.toast('没有可悔的棋', W / 2, H / 2, '#ffd66e', true);
      return;
    }
    var pops = 1;
    if (game.aiPlayer) {
      // 若轮到 AI，撤销自己的一手；否则撤销 AI + 自己各一手
      pops = game.sim.current === game.aiPlayer ? 1 : 2;
    }
    for (var i = 0; i < pops; i++) {
      var last = game.history.pop();
      if (!last) break;
      game.sim.board[last.r][last.c] = 0;
      game.sim.moves = Math.max(0, game.sim.moves - 1);
    }
    game.sim.current = game.sim.moves % 2 === 0 ? 1 : 2;
    game.sim.lastMove = game.history.length ? game.history[game.history.length - 1] : null;
    game.sim.winner = 0;
    game.sim.winLine = null;
    game.renjuLoss = false;
    game.awaitingResult = false;
    game._winShown = false;
    game.combo.streak = 0;
    game.stoneAnims = [];
    closeDialog(els.winOverlay);
    show(els.hud);
    window.SFX.click();
    updateHud();
    if (game.aiPlayer && game.sim.current === game.aiPlayer) scheduleAi();
  }

  function hintMove() {
    if (!game || game.sim.winner) return;
    if (game.onlineActive) {
      window.FX.toast('在线对局不支持提示', W / 2, H / 2, '#ffd66e', true);
      return;
    }
    if (game.aiThinking || !canPlace()) return;
    var move = window.AI.chooseMoveQuick(game.sim.board, game.sim.current, game.rule);
    if (!move) return;
    game.hint = { r: move.r, c: move.c, until: performance.now() + 3000 };
    var col = String.fromCharCode(65 + move.c);
    window.FX.toast('提示 ' + col + (move.r + 1), ix(move.c), iy(move.r) - 34, '#7dffb0', true);
    window.SFX.effect(1);
  }

  // ---------------- 场景切换 ----------------

  function switchTheme() {
    if (scene !== 'game' || !game || game.switching) return;
    var snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext('2d').drawImage(canvas, 0, 0);
    var next = window.Theme.random(game.theme.id);
    game.theme = next;
    game._spriteKey = null;
    game._sprite = null;
    window.PS.clear();
    game.ambient = window.Theme.createAmbient(next, window.PS, W, H);
    activeAmbient = game.ambient;
    game.switching = {
      snap: snap,
      from: performance.now(),
      dur: clamp(GC.settings.duration, 0.5, 2.5) * 1000,
      p: 0,
      burst: false,
      flashed: false
    };
    game.autoTimer = 0;
    applyThemeLight();
    window.SFX.whoosh();
    updateHud();
  }

  function applyThemeLight() {
    if (!game) return;
    var light = ['sakura', 'ink', 'candy'].indexOf(game.theme.bgType) >= 0;
    document.body.dataset.themeLight = light ? '1' : '0';
  }

  function drawPortal(sw) {
    var eased = easeInOut(sw.p);
    var cx = W / 2;
    var cy = H / 2;
    var R = Math.hypot(W, H) * 0.72;
    ctx.save();
    if (sw.snap) {
      ctx.globalAlpha = 1 - eased * 0.9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(6, R * (1 - eased)), 0, Math.PI * 2);
      ctx.clip();
      var zoom = 1 + (1 - sw.p) * 0.04;
      var zw = W * zoom;
      var zh = H * zoom;
      ctx.drawImage(sw.snap, (W - zw) / 2, (H - zh) / 2, zw, zh);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    var a = Math.sin(sw.p * Math.PI);
    var th = game.theme;
    for (var i = 0; i < 3; i++) {
      ctx.strokeStyle = withAlpha(i % 2 ? th.accent2 : th.accent, 0.8 * a);
      ctx.lineWidth = Math.max(1.5, 7 * (1 - sw.p) + 1);
      ctx.shadowColor = i % 2 ? th.accent2 : th.accent;
      ctx.shadowBlur = 26;
      ctx.beginPath();
      var start = sw.p * Math.PI * 6 + i * 2.1;
      var span = 1.7 + (1 - sw.p) * 4.4;
      ctx.arc(cx, cy, R * (0.38 + i * 0.07) * (1 - sw.p * 0.75), start, start + span);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.6 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 12 + R * 0.32 * (1 - sw.p), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- 棋子 sprite 缓存 ----------------

  function buildSprite(p) {
    var th = game.theme;
    var cell = boardGeom().cell;
    var r = cell * 0.42;
    var half = r + 28;
    var dpr = Math.min(2, DPR);
    var canvasSize = Math.ceil(half * 2 * dpr);
    var c = document.createElement('canvas');
    c.width = canvasSize;
    c.height = canvasSize;
    var x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var st = th.pieces[p === 1 ? 0 : 1];

    x.save();
    x.fillStyle = 'rgba(0,0,0,0.32)';
    x.beginPath();
    x.ellipse(half + r * 0.14, half + r * 0.16, r * 0.94, r * 0.5, 0, 0, Math.PI * 2);
    x.fill();

    x.shadowColor = st.glow;
    x.shadowBlur = 18;
    var grad = x.createRadialGradient(half - r * 0.35, half - r * 0.42, r * 0.08, half, half, r);
    grad.addColorStop(0, st.hi);
    grad.addColorStop(0.55, st.core);
    grad.addColorStop(0.97, st.edge);
    grad.addColorStop(1, st.edge);
    x.fillStyle = grad;
    x.beginPath();
    x.arc(half, half, r, 0, Math.PI * 2);
    x.fill();
    x.shadowBlur = 0;

    x.save();
    x.translate(half, half);
    window.Theme.drawMotif(th, x, r * 0.96, luminance(st.core) < 120);
    x.restore();

    x.strokeStyle = withAlpha(st.edge, 0.9);
    x.lineWidth = Math.max(1, r * 0.06);
    x.beginPath();
    x.arc(half, half, r * 0.97, 0, Math.PI * 2);
    x.stroke();
    x.restore();

    return { canvas: c, half: half };
  }

  function spriteFor(p) {
    var g = boardGeom();
    var key = game.theme.id + '|' + p + '|' + g.cell.toFixed(2) + '|' + Math.min(2, DPR);
    if (game._spriteKey !== key || !game._sprite) {
      game._spriteKey = key;
      game._sprite = {};
    }
    if (!game._sprite[p]) game._sprite[p] = buildSprite(p);
    return game._sprite[p];
  }

  function drawPiece(x, y, p, scale, alpha) {
    var sp = spriteFor(p);
    ctx.save();
    ctx.globalAlpha = alpha !== undefined ? alpha : 1;
    if (scale === 1) {
      ctx.drawImage(sp.canvas, x - sp.half, y - sp.half, sp.half * 2, sp.half * 2);
    } else {
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.drawImage(sp.canvas, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
    }
    ctx.restore();
  }

  function stoneScale(r, c) {
    for (var i = game.stoneAnims.length - 1; i >= 0; i--) {
      var a = game.stoneAnims[i];
      if (a.r === r && a.c === c) {
        var p = (time - a.t0) / 0.24;
        if (p >= 1) {
          game.stoneAnims.splice(i, 1);
          return 1;
        }
        return Math.max(0.02, easeOutBack(p));
      }
    }
    return 1;
  }

  function drawBoard() {
    var th = game.theme;
    var sim = game.sim;
    var g = boardGeom();
    ctx.save();
    ctx.shadowColor = th.board.glow;
    ctx.shadowBlur = 26;
    roundRect(g.ox, g.oy, g.side, g.side, 20);
    ctx.fillStyle = th.board.fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    var frame = ctx.createLinearGradient(g.ox, g.oy, g.ox, g.oy + g.side);
    frame.addColorStop(0, withAlpha(th.board.frameTop, 0.9));
    frame.addColorStop(1, withAlpha(th.board.frameBottom, 0.9));
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2;
    roundRect(g.ox, g.oy, g.side, g.side, 20);
    ctx.stroke();
    var cornerR = 7;
    ctx.fillStyle = th.board.corner;
    ctx.shadowColor = th.board.glow;
    ctx.shadowBlur = 10;
    for (var i = 0; i < 4; i++) {
      var cx = i % 2 === 0 ? g.ox + 7 : g.ox + g.side - 7;
      var cy = i < 2 ? g.oy + 7 : g.oy + g.side - 7;
      ctx.beginPath();
      ctx.arc(cx, cy, cornerR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    ctx.strokeStyle = th.board.line;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var li = 0; li < SIZE; li++) {
      ctx.moveTo(ix(0), iy(li));
      ctx.lineTo(ix(SIZE - 1), iy(li));
      ctx.moveTo(ix(li), iy(0));
      ctx.lineTo(ix(li), iy(SIZE - 1));
    }
    ctx.stroke();

    ctx.fillStyle = th.board.star;
    ctx.shadowColor = th.board.star;
    ctx.shadowBlur = 8;
    for (var si = 0; si < GC.STARS.length; si++) {
      var s = GC.STARS[si];
      ctx.beginPath();
      ctx.arc(ix(s[1]), iy(s[0]), g.cell * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = sim.board[r][c];
        if (v === 0) continue;
        drawPiece(ix(c), iy(r), v, stoneScale(r, c), 1);
      }
    }

    if (game.ghost && canPlace() && sim.board[game.ghost.r][game.ghost.c] === 0) {
      drawPiece(ix(game.ghost.c), iy(game.ghost.r), sim.current, 1, 0.38);
    }

    if (sim.lastMove) {
      var pulse = 0.55 + 0.45 * Math.sin(time * 5);
      ctx.strokeStyle = withAlpha(th.accent, pulse);
      ctx.lineWidth = 2.4;
      ctx.shadowColor = th.accent;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ix(sim.lastMove.c), iy(sim.lastMove.r), g.cell * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (game.hint && performance.now() < game.hint.until) {
      var hx = ix(game.hint.c);
      var hy = iy(game.hint.r);
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(hx, hy, g.cell * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (game.hint) {
      game.hint = null;
    }

    if (scene === 'game' && !game.onlineActive && canPlace() && game.cursor) {
      var kx = ix(game.cursor.c);
      var ky = iy(game.cursor.r);
      ctx.strokeStyle = withAlpha(th.accent, 0.7);
      ctx.lineWidth = 1.6;
      roundRect(kx - g.cell * 0.45, ky - g.cell * 0.45, g.cell * 0.9, g.cell * 0.9, 5);
      ctx.stroke();
    }

    if (sim.winner && sim.winLine) {
      var wl = sim.winLine;
      var x1 = ix(wl.c1);
      var y1 = iy(wl.r1);
      var x2 = ix(wl.c2);
      var y2 = iy(wl.r2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(th.accent2, 0.95);
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.shadowColor = th.accent2;
      ctx.shadowBlur = 22;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -time * 60;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawConstellation() {
    var pts = [];
    for (var i = 0; i < 7; i++) {
      pts.push({
        x: W * (0.14 + ((i * 37 + 13) % 10) / 10 * 0.72),
        y: H * (0.18 + ((i * 53 + 7) % 10) / 10 * 0.64),
        ph: i * 2.1,
        color: i % 3 === 0 ? cover.theme.accent : i % 3 === 1 ? cover.theme.accent2 : '#ffffff'
      });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var a = 0; a < pts.length; a++) {
      for (var b = a + 1; b < pts.length; b++) {
        var dx = pts[a].x - pts[b].x;
        var dy = pts[a].y - pts[b].y;
        var dist = Math.hypot(dx, dy);
        var maxD = Math.min(W, H) * 0.3;
        if (dist < maxD) {
          ctx.globalAlpha = (1 - dist / maxD) * (0.12 + 0.08 * Math.sin(time * 0.8 + a + b));
          ctx.strokeStyle = '#7df9ff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
          ctx.stroke();
        }
      }
    }
    for (var pi = 0; pi < pts.length; pi++) {
      var p = pts[pi];
      var tw = 0.55 + 0.45 * Math.sin(time * 1.6 + p.ph);
      ctx.globalAlpha = 0.5 + tw * 0.5;
      var pr = 3 + tw * 4;
      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr * 2.4);
      grad.addColorStop(0, withAlpha(p.color, 0.9));
      grad.addColorStop(1, withAlpha(p.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pr * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var off = window.FX.shakeOffset();
    var zoom = window.FX.getZoomScale(performance.now());
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);
    ctx.translate(off.x, off.y);
    if (scene === 'cover') {
      if (cover) {
        window.Theme.drawBackground(ctx, cover.theme, W, H, time);
        if (cover.crossAlpha > 0) {
          ctx.globalAlpha = cover.crossAlpha;
          window.Theme.drawBackground(ctx, cover.theme2, W, H, time);
          ctx.globalAlpha = 1;
        }
        drawConstellation();
        window.PS.draw(ctx, time, 'bg');
      }
    } else if (game) {
      window.Theme.drawBackground(ctx, game.theme, W, H, time);
      window.PS.draw(ctx, time, 'bg');
      drawBoard();
      if (game.switching) drawPortal(game.switching);
      window.PS.draw(ctx, time, 'fg');
    }
    ctx.restore();
    drawVignette();
    window.FX.draw(ctx);
  }

  // ---------------- 封面状态 ----------------

  function initCover() {
    cover = {
      theme: window.Theme.random(null),
      theme2: window.Theme.random(null),
      crossAlpha: 0,
      mode: 'hold',
      t: 0,
      ambient: null
    };
    cover.ambient = window.Theme.createAmbient(cover.theme, window.PS, W, H);
    activeAmbient = cover.ambient;
  }

  function updateCover(dt) {
    if (!cover) return;
    cover.t += dt;
    if (cover.mode === 'hold' && cover.t > 8) {
      cover.mode = 'cross';
      cover.t = 0;
    }
    if (cover.mode === 'cross') {
      cover.crossAlpha = Math.min(1, cover.crossAlpha + dt / 1.3);
      if (cover.crossAlpha >= 1) {
        cover.theme = cover.theme2;
        cover.theme2 = window.Theme.random(cover.theme.id);
        cover.crossAlpha = 0;
        cover.mode = 'hold';
        window.PS.clear();
        cover.ambient = window.Theme.createAmbient(cover.theme, window.PS, W, H);
        activeAmbient = cover.ambient;
      }
    }
    if (cover.ambient) cover.ambient.update(dt);
  }

  // ---------------- 主循环 ----------------

  function update(dt) {
    window.FX.update(dt, performance.now());
    if (scene === 'cover') {
      updateCover(dt);
    } else if (game) {
      if (game.ambient) game.ambient.update(dt);
      if (game.switching) {
        game.switching.p = Math.min(1, (performance.now() - game.switching.from) / game.switching.dur);
        if (game.switching.p >= 0.5 && !game.switching.burst) {
          game.switching.burst = true;
          window.FX.burst(W / 2, H / 2, [game.theme.accent, game.theme.accent2, '#ffffff'], 26, {
            speed: 300,
            size: 3,
            life: 0.65
          });
          window.SFX.effect(3);
        }
        if (game.switching.p >= 0.86 && !game.switching.flashed) {
          game.switching.flashed = true;
          window.FX.flash(game.theme.accent, 0.14, 0.28);
        }
        if (game.switching.p >= 1) {
          game.switching = null;
        }
      }
      if (GC.settings.auto && !game.sim.winner && !game.switching) {
        game.autoTimer = (game.autoTimer || 0) + dt;
        if (game.autoTimer >= GC.settings.interval) {
          game.autoTimer = 0;
          switchTheme();
        }
      }
    }
    window.PS.update(dt, time);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var ts = window.FX.getTimeScale(now);
    time += dt * ts;
    update(dt * ts);
    draw();
  }

  // ---------------- 在线事件监听 ----------------

  function setupOnlineListeners() {
    window.Network.on('opponentMove', function (data) {
      if (game && game.onlineActive && !game.onlineEnded) {
        placeRemoteMove(data.r, data.c, data.color);
      }
    });

    window.Network.on('gameOver', function (data) {
      if (!game || !game.onlineActive || !data) return;
      if (game._winShown) return;
      var sim = game.sim;
      if (data.board) {
        var next = [];
        for (var r = 0; r < SIZE; r++) next.push(data.board[r].slice());
        sim.board = next;
      }
      if (data.lastMove) sim.lastMove = data.lastMove;
      game.onlineEnded = true;
      game.awaitingResult = false;
      game.endReason = data.reason || 'five';
      if (data.draw) {
        window.SFX.draw();
        handleDraw();
        return;
      }
      sim.winner = data.winner;
      sim.winLine = data.winLine ? { r1: data.winLine.r1, c1: data.winLine.c1, r2: data.winLine.r2, c2: data.winLine.c2 }
        : (sim.lastMove ? findWinLine(sim.board, sim.lastMove.r, sim.lastMove.c, data.winner) : null);
      if (sim.winner && !sim.winLine && sim.lastMove) {
        sim.winLine = findWinLine(sim.board, sim.lastMove.r, sim.lastMove.c, sim.winner);
      }
      handleWin(sim.winner, game.endReason);
    });

    window.Network.on('moveRejected', function (data) {
      if (!game || !game.onlineActive || !data) return;
      var lm = game.lastLocalMove;
      if (lm && lm.r === data.r && lm.c === data.c && game.sim.board[lm.r][lm.c] === game.myColor) {
        game.sim.board[lm.r][lm.c] = 0;
        game.sim.moves = Math.max(0, game.sim.moves - 1);
        game.sim.current = game.myColor;
        game.isMyTurn = true;
        game.lastLocalMove = null;
        game.stoneAnims = game.stoneAnims.filter(function (a) { return !(a.r === lm.r && a.c === lm.c); });
        if (game.history.length && game.history[game.history.length - 1].r === lm.r && game.history[game.history.length - 1].c === lm.c) {
          game.history.pop();
        }
      }
      window.SFX.illegal();
      window.FX.toast(data.reason || '落子被拒绝', W / 2, H / 2, '#ff6b6b', true);
      updateHud();
    });

    window.Network.on('clock', function (data) {
      if (!game || !game.onlineActive || !data) return;
      game.clock.remaining = data.remaining;
      if (data.currentTurn) game.sim.current = data.currentTurn;
      if (!game.sim.winner && !game.onlineEnded) {
        game.isMyTurn = game.sim.current === game.myColor;
        if (data.remaining <= 5 && data.remaining !== lastTickSecond && data.currentTurn === game.myColor) {
          lastTickSecond = data.remaining;
          window.SFX.tick(data.remaining <= 3);
        }
        updateHud();
      }
    });

    window.Network.on('opponentLeft', function (data) {
      if (!game || !game.onlineActive) return;
      if (data && data.reconnecting && !game.onlineEnded) {
        window.FX.toast('对手掉线，等待重连…', W / 2, H / 2, '#ffd66e', true);
      } else if (!game.onlineEnded) {
        window.FX.toast('对手已离开', W / 2, H / 2, '#ff6b6b', false);
      }
    });

    window.Network.on('rematchRequested', function (data) {
      if (!game || !game.onlineActive || !game.onlineEnded) return;
      game.rematchReceived = true;
      window.SFX.rematch();
      window.FX.toast((data && data.nickname ? data.nickname : '对手') + ' 请求再战', W / 2, H / 2, '#00e5ff', true);
      if (els.winOverlay.open) showOnlineWinControls();
    });

    window.Network.on('rematchAccepted', function () {
      if (!game || !game.onlineActive) return;
      window.FX.toast('对手已同意再战', W / 2, H / 2, '#7dffb0', true);
    });

    window.Network.on('rematchDeclined', function (data) {
      if (!game || !game.onlineActive || !game.onlineEnded) return;
      game.rematchRequested = false;
      window.FX.toast((data && data.nickname ? data.nickname : '对手') + ' 拒绝了再战', W / 2, H / 2, '#ffd66e', true);
      if (els.winOverlay.open) {
        els.winRematchStatus.textContent = '对方拒绝了再战';
        hide(els.btnRematch);
      }
    });

    window.Network.on('disconnect', function () {
      updateConnChip();
      if (game && game.onlineActive && !game.onlineEnded) {
        window.FX.toast('网络断开，正在重连…', W / 2, H / 2, '#ff6b6b', false);
        if (game.awaitingResult) {
          game.awaitingResult = false;
          game.sim.current = game.myColor;
          game.isMyTurn = true;
        }
      }
    });

    window.Network.on('connect', function () {
      updateConnChip();
      if (game && game.onlineActive && !game.onlineEnded) {
        window.FX.toast('已重新连接', W / 2, H / 2, '#00e5ff', true);
      }
    });

    window.Network.on('connectFailed', function (msg) {
      updateConnChip();
      if (scene === 'cover') {
        var hint = document.getElementById('onlineConnectHint');
        if (hint) hint.textContent = '无法连接服务器：' + (msg || '请稍后重试');
      }
    });

    window.Network.on('error', function (msg) {
      if (game && game.onlineActive) {
        window.FX.toast(String(msg), W / 2, H / 2, '#ff6b6b', true);
      }
    });
  }

  // ---------------- 事件 ----------------

  function onPointerMove(e) {
    if (scene !== 'game' || !game) return;
    var rect = canvas.getBoundingClientRect();
    var pt = cellAt(e.clientX - rect.left, e.clientY - rect.top);
    game.ghost = pt;
    if (pt) game.cursor = pt;
  }

  function onPointerDown(e) {
    if (scene !== 'game' || !game) return;
    if (anyDialogOpen()) return;
    var rect = canvas.getBoundingClientRect();
    var pt = cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!pt || !canPlace()) return;
    if (game.sim.board[pt.r][pt.c] === 0) {
      game.cursor = pt;
      placeMove(pt.r, pt.c);
    }
  }

  function onKey(e) {
    if (anyDialogOpen()) return;
    if (!game || scene !== 'game') {
      if (e.code === 'Space' && scene === 'cover') e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      switchTheme();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
      backToMenu();
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && !game.onlineActive) {
      startGame(game.settings);
      return;
    }
    var dx = 0;
    var dy = 0;
    if (e.key === 'ArrowLeft') dx = -1;
    else if (e.key === 'ArrowRight') dx = 1;
    else if (e.key === 'ArrowUp') dy = -1;
    else if (e.key === 'ArrowDown') dy = 1;
    if (dx || dy) {
      e.preventDefault();
      game.cursor.r = clamp(game.cursor.r + dy, 0, SIZE - 1);
      game.cursor.c = clamp(game.cursor.c + dx, 0, SIZE - 1);
      game.ghost = { r: game.cursor.r, c: game.cursor.c };
      return;
    }
    if (e.key === 'Enter' && canPlace()) {
      e.preventDefault();
      if (game.sim.board[game.cursor.r][game.cursor.c] === 0) {
        placeMove(game.cursor.r, game.cursor.c);
      }
    }
  }

  function onResize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    geomCache = null;
    for (var t = 0; t < window.Theme.ALL.length; t++) window.Theme.clearDecor(window.Theme.ALL[t]);
    if (scene === 'game' && game) {
      window.PS.clear();
      game._spriteKey = null;
      game._sprite = null;
      game.ambient = window.Theme.createAmbient(game.theme, window.PS, W, H);
      activeAmbient = game.ambient;
    } else if (cover) {
      window.PS.clear();
      cover.ambient = window.Theme.createAmbient(cover.theme, window.PS, W, H);
      activeAmbient = cover.ambient;
    }
  }

  function updateMuteIcons() {
    var muted = window.SFX.isMuted();
    els.btnMuteGame.textContent = muted ? '🔇' : '🔊';
    els.btnMuteGame.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
    if (els.btnMuteCover) {
      var span = els.btnMuteCover.querySelector('.mute-icon');
      if (span) span.textContent = muted ? '🔇' : '🔊';
      els.btnMuteCover.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
    }
  }

  function refreshAutoChip() {
    els.btnAuto.textContent = '⏱ 自动:' + (GC.settings.auto ? '开' : '关');
    els.btnAuto.classList.toggle('on', GC.settings.auto);
  }

  function wireButtons() {
    els.btnAuto.addEventListener('click', function () {
      GC.settings.auto = !GC.settings.auto;
      GC.saveSettings();
      refreshAutoChip();
      if (game) game.autoTimer = 0;
      window.SFX.click();
    });
    els.btnMenu.addEventListener('click', function () {
      window.SFX.click();
      backToMenu();
    });
    els.btnRestart.addEventListener('click', function () {
      window.SFX.click();
      if (game && game.onlineActive) {
        window.FX.toast('在线模式无法重开', W / 2, H / 2, '#ffd66e', true);
        return;
      }
      if (game) startGame(game.settings);
    });
    els.btnUndo.addEventListener('click', function () {
      window.SFX.click();
      undoMove();
    });
    els.btnHint.addEventListener('click', function () {
      hintMove();
    });
    els.btnAgain.addEventListener('click', function () {
      window.SFX.click();
      if (game && game.onlineActive) {
        if (!game.rematchRequested) {
          game.rematchRequested = true;
          window.Network.acceptRematch();
          window.Network.requestRematch();
          els.winRematchStatus.textContent = '已发送再战请求，等待对方…';
          hide(els.btnRematch);
        }
        return;
      }
      if (game) startGame(game.settings);
    });
    els.btnBackWin.addEventListener('click', function () {
      window.SFX.click();
      backToMenu();
    });
    els.btnRematchBack.addEventListener('click', function () {
      window.SFX.click();
      backToMenu();
    });
    els.btnMuteGame.addEventListener('click', function () {
      window.SFX.toggle();
      updateMuteIcons();
    });
    els.btnMuteCover.addEventListener('click', function () {
      window.SFX.toggle();
      updateMuteIcons();
    });

    // 结算对话框：禁止 Esc 直接关闭，必须做出选择
    els.winOverlay.addEventListener('cancel', function (e) { e.preventDefault(); });

    // 悬停音效（只对带文字的主按钮，避免刷屏）
    document.addEventListener('pointerover', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button.big-btn, button.ghost-btn, button.chip-btn') : null;
      if (!btn) return;
      if (btn.dataset.hovered === '1') return;
      btn.dataset.hovered = '1';
      window.SFX.hover();
    });
    document.addEventListener('pointerout', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (btn) btn.dataset.hovered = '0';
    });
  }

  window.Gomoku = {
    init: function (opts) {
      options = opts || {};
      wireButtons();
      setupOnlineListeners();
      onResize();
      initCover();
      updateMuteIcons();
      window.FX.syncIntensity();
      if (window.PS && window.PS.syncBudget) window.PS.syncBudget();
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerleave', function () { if (game) game.ghost = null; });
      window.addEventListener('resize', onResize);
      window.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', function () {
        window.SFX.unlock();
      }, { once: false });
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    startGame: function (settings) { startGame(settings); },
    placeRemoteMove: placeRemoteMove,
    restoreOnlineGame: restoreOnlineGame,
    backToMenu: backToMenu,
    refreshAutoChip: refreshAutoChip,
    updateMuteIcons: updateMuteIcons,
    updateConnChip: updateConnChip,
    debug: function () {
      if (!game) return { scene: scene, game: null };
      return {
        scene: scene,
        mode: game.settings.mode,
        moves: game.sim.moves,
        current: game.sim.current,
        winner: game.sim.winner,
        myColor: game.myColor,
        aiPlayer: game.aiPlayer,
        onlineEnded: game.onlineEnded,
        awaiting: game.awaitingResult,
        history: game.history.length
      };
    }
  };
})();