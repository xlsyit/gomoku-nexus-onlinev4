(function () {
  'use strict';

  var els = {
    cover: document.getElementById('cover'),
    btnPvp: document.getElementById('btnPvp'),
    btnVsAi: document.getElementById('btnVsAi'),
    btnOnline: document.getElementById('btnOnline'),
    aiConfig: document.getElementById('aiConfig'),
    onlineConfig: document.getElementById('onlineConfig'),
    leaderboardPanel: document.getElementById('leaderboardPanel'),
    segDifficulty: document.getElementById('segDifficulty'),
    segSide: document.getElementById('segSide'),
    segAiBoardSize: document.getElementById('segAiBoardSize'),
    segAiRule: document.getElementById('segAiRule'),
    aiRuleHint: document.getElementById('aiRuleHint'),
    btnAiStart: document.getElementById('btnAiStart'),
    btnAiBack: document.getElementById('btnAiBack'),
    btnCreateRoom: document.getElementById('btnCreateRoom'),
    btnJoinRoom: document.getElementById('btnJoinRoom'),
    btnRegister: document.getElementById('btnRegister'),
    btnLogin: document.getElementById('btnLogin'),
    btnOnlineBack: document.getElementById('btnOnlineBack'),
    authForm: document.getElementById('authForm'),
    inputNickname: document.getElementById('inputNickname'),
    inputPassword: document.getElementById('inputPassword'),
    inputRoomCode: document.getElementById('inputRoomCode'),
    onlineConnectHint: document.getElementById('onlineConnectHint'),
    roomStatus: document.getElementById('roomStatus'),
    segRoomPrivacy: document.getElementById('segRoomPrivacy'),
    lobbyGrid: document.getElementById('lobbyGrid'),
    roomCount: document.getElementById('roomCount'),
    btnLeaderboard: document.getElementById('btnLeaderboard'),
    btnLbClose: document.getElementById('btnLbClose'),
    btnLbRefresh: document.getElementById('btnLbRefresh'),
    segLbTab: document.getElementById('segLbTab'),
    lbList: document.getElementById('lbList'),
    btnSettings: document.getElementById('btnSettings'),
    settingsPanel: document.getElementById('settingsPanel'),
    segBoardSize: document.getElementById('segBoardSize'),
    segRule: document.getElementById('segRule'),
    ruleHint: document.getElementById('ruleHint'),
    segUiTheme: document.getElementById('segUiTheme'),
    segAuto: document.getElementById('segAuto'),
    sliderInterval: document.getElementById('sliderInterval'),
    intervalVal: document.getElementById('intervalVal'),
    sliderDuration: document.getElementById('sliderDuration'),
    durationVal: document.getElementById('durationVal'),
    btnSettingsClose: document.getElementById('btnSettingsClose'),
    sliderSfx: document.getElementById('sliderSfx'),
    sliderMusic: document.getElementById('sliderMusic'),
    sfxVal: document.getElementById('sfxVal'),
    musicVal: document.getElementById('musicVal'),
    segMute: document.getElementById('segMute'),
    segFx: document.getElementById('segFx')
  };

  var callbacks = { start: function () {} };
  var selected = { difficulty: 'easy', humanSide: 0 };
  var onlineState = { mode: 'idle', roomCode: null, color: null, isPublic: true };
  var auth = { token: null, nickname: '' };
  var lbTab = 'online';
  var RULE_INFO = {
    free: '自由规则：黑方白方都无禁手，先连成五子即胜。',
    renju: '职业禁手：黑方禁止双三、双四和长连，白方无禁手；黑方犯规判白胜。',
    folk: '民间禁手：仅禁止黑方长连（超过五子），双三双四仍可下，适合休闲对局。'
  };
  var RULE_LABELS = { free: '自由', renju: '职业禁手', folk: '民间禁手' };

  function openDialog(d) {
    if (!d || d.open) return;
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
    // 浏览器可能把焦点落在可滚动的 .panel-sheet 上并自动滚动，强制回到顶部
    var sheet = d.querySelector('.panel-sheet, .online-shell');
    if (sheet) sheet.scrollTop = 0;
  }

  function closeDialog(d) {
    if (!d || !d.open) return;
    try { d.close(); } catch (e) { d.removeAttribute('open'); }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function updateRuleHint(rule) {
    var text = RULE_INFO[rule] || RULE_INFO.free;
    if (els.ruleHint) els.ruleHint.textContent = text;
    if (els.aiRuleHint) els.aiRuleHint.textContent = text;
  }

  function refreshAuthUI() {
    var ok = !!auth.token;
    els.btnCreateRoom.disabled = !ok;
    els.btnJoinRoom.disabled = !ok;
    els.btnRegister.disabled = ok;
    els.btnRegister.textContent = ok ? '已登录' : '注册';
    els.btnLogin.textContent = ok ? '退出' : '登录';
    if (ok) els.inputNickname.value = auth.nickname || els.inputNickname.value;
  }

  function loadAuth() {
    var saved = window.Network.getAuth ? window.Network.getAuth() : null;
    auth.token = saved ? saved.token : null;
    auth.nickname = saved ? (saved.nickname || '') : '';
    if (auth.nickname) els.inputNickname.value = auth.nickname;
  }

  function setAuth(token, nickname) {
    auth.token = token || null;
    auth.nickname = nickname || '';
    if (window.Network.setAuth) window.Network.setAuth(auth.token, auth.nickname);
    refreshAuthUI();
  }

  function bindSeg(el, onPick, isTab) {
    if (!el) return;
    var btns = el.querySelectorAll('button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) {
          x.classList.remove('active');
          if (isTab) x.setAttribute('aria-selected', 'false');
        });
        b.classList.add('active');
        if (isTab) b.setAttribute('aria-selected', 'true');
        onPick(b.dataset.value);
        window.SFX.click();
      });
    });
  }

  function syncSeg(el, value) {
    if (!el) return;
    el.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.value === String(value));
    });
  }

  function setConfigVisible(v) {
    if (v) openDialog(els.aiConfig); else closeDialog(els.aiConfig);
  }

  function setOnlineConfigVisible(v) {
    if (!v) {
      closeDialog(els.onlineConfig);
      return;
    }
    openDialog(els.onlineConfig);
    resetOnlineUI();
    loadAuth();
    refreshAuthUI();
    if (window.GC && window.GC.lastNickname && !els.inputNickname.value) {
      els.inputNickname.value = window.GC.lastNickname;
    }
    updateConnectHint();
    if (!window.Network.isConnected()) window.Network.connect();
  }

  function updateConnectHint() {
    if (!els.onlineConnectHint) return;
    if (window.Network.isConnected()) els.onlineConnectHint.textContent = '已连接服务器';
    else if (window.Network.hasFailed && window.Network.hasFailed()) els.onlineConnectHint.textContent = '无法连接服务器，请检查网络或稍后重试';
    else els.onlineConnectHint.textContent = '正在连接服务器…';
  }

  function setLeaderboardVisible(v) {
    if (!v) {
      closeDialog(els.leaderboardPanel);
      return;
    }
    openDialog(els.leaderboardPanel);
    renderLeaderboard();
    if (lbTab === 'online') {
      if (!window.Network.isConnected()) window.Network.connect();
      loadLeaderboard();
    }
  }

  function setSettingsVisible(v) {
    if (v) {
      syncSettingsUI();
      openDialog(els.settingsPanel);
    } else {
      closeDialog(els.settingsPanel);
    }
  }

  function hideAllPanels() {
    closeDialog(els.aiConfig);
    closeDialog(els.onlineConfig);
    closeDialog(els.leaderboardPanel);
    closeDialog(els.settingsPanel);
  }

  function resetOnlineUI() {
    els.roomStatus.classList.add('hidden');
    els.roomStatus.innerHTML = '';
    els.inputRoomCode.value = '';
    els.inputNickname.disabled = false;
    els.inputPassword.disabled = false;
    els.btnCreateRoom.textContent = '创建房间';
    els.btnJoinRoom.textContent = '加入房间';
    onlineState = { mode: 'idle', roomCode: null, color: null, isPublic: onlineState.isPublic };
    syncSeg(els.segRoomPrivacy, onlineState.isPublic ? '1' : '0');
  }

  function showRoomStatus(html) {
    els.roomStatus.innerHTML = html;
    els.roomStatus.classList.remove('hidden');
  }

  function syncSettingsUI() {
    var s = window.GC.settings;
    syncSeg(els.segBoardSize, s.boardSize);
    syncSeg(els.segAiBoardSize, s.boardSize);
    syncSeg(els.segRule, s.rule);
    syncSeg(els.segAiRule, s.rule);
    syncSeg(els.segUiTheme, s.uiTheme);
    syncSeg(els.segAuto, s.auto ? '1' : '0');
    syncSeg(els.segFx, s.fx);
    syncSeg(els.segMute, s.muted ? '1' : '0');
    updateRuleHint(s.rule);
    els.sliderInterval.value = String(s.interval);
    els.intervalVal.textContent = s.interval + ' 秒';
    els.sliderDuration.value = String(s.duration);
    els.durationVal.textContent = s.duration.toFixed(1) + ' 秒';
    els.sliderSfx.value = String(Math.round((s.sfx == null ? 0.8 : s.sfx) * 100));
    els.sfxVal.textContent = Math.round((s.sfx == null ? 0.8 : s.sfx) * 100) + '%';
    els.sliderMusic.value = String(Math.round((s.music == null ? 0.35 : s.music) * 100));
    els.musicVal.textContent = Math.round((s.music == null ? 0.35 : s.music) * 100) + '%';
  }

  // ---------------- 排行榜 ----------------

  var lbCacheData = null;

  function tierBadge(p) {
    return '<span class="tier tier-' + escapeHtml(p.tierKey || 'bronze') + '">' + escapeHtml(p.tier || '青铜') + '</span>';
  }

  function renderLeaderboard() {
    if (lbTab === 'online') {
      els.lbList.innerHTML = lbCacheData === null ? '<div class="lb-empty">加载中…</div>' : '';
      return;
    }
    var s = window.GC.localStats ? window.GC.localStats() : { wins: 0, losses: 0, draws: 0, bestCombo: 0, fastestWin: 0 };
    var games = s.wins + s.losses + s.draws;
    var rate = games ? Math.round((s.wins / games) * 100) : 0;
    els.lbList.innerHTML = '' +
      '<div class="local-stats">' +
      '<div class="stat-card"><span class="stat-label">胜场</span><strong class="stat-value">' + s.wins + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">负场</span><strong class="stat-value">' + s.losses + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">和棋</span><strong class="stat-value">' + s.draws + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">胜率</span><strong class="stat-value">' + rate + '%</strong></div>' +
      '<div class="stat-card"><span class="stat-label">最高连击</span><strong class="stat-value">×' + s.bestCombo + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">最快取胜</span><strong class="stat-value">' + (s.fastestWin ? s.fastestWin + ' 手' : '—') + '</strong></div>' +
      '</div>' +
      '<p class="lb-note">本机战绩只统计人机对战，保存在当前浏览器。</p>';
  }

  function loadLeaderboard() {
    if (lbTab !== 'online') return;
    if (!lbCacheData) els.lbList.innerHTML = '<div class="lb-empty">加载中…</div>';
    window.Network.getLeaderboard(50, function (data) {
      if (!data) {
        els.lbList.innerHTML = '<div class="lb-empty">无法获取排行榜，请确认服务器已连接</div>';
        return;
      }
      lbCacheData = data;
      if (!data.length) {
        els.lbList.innerHTML = '<div class="lb-empty">暂无对局数据，去下一局吧</div>';
        return;
      }
      var me = (auth.nickname || '').toLowerCase();
      var html = '<table class="lb-table"><caption class="sr-only">在线排行榜</caption><thead><tr>' +
        '<th scope="col">#</th><th scope="col">玩家</th><th scope="col">段位</th>' +
        '<th scope="col">胜率</th><th scope="col">场次</th><th scope="col">积分</th><th scope="col">连胜</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < data.length; i++) {
        var p = data[i];
        var cls = 'lb-row';
        if (i < 3) cls += ' lb-rank-' + (i + 1);
        if (me && String(p.nickname).toLowerCase() === me) cls += ' is-me';
        html += '<tr class="' + cls + '">' +
          '<td data-label="排名">' + (i + 1) + '</td>' +
          '<td data-label="玩家">' + escapeHtml(p.nickname) + '</td>' +
          '<td data-label="段位">' + tierBadge(p) + '</td>' +
          '<td data-label="胜率">' + (p.winrate || 0) + '%</td>' +
          '<td data-label="场次">' + (p.games || 0) + '</td>' +
          '<td data-label="积分">' + p.rating + '</td>' +
          '<td data-label="连胜">' + (p.streak || 0) + '</td>' +
          '</tr>';
      }
      html += '</tbody></table>';
      els.lbList.innerHTML = html;
    });
  }

  // ---------------- 房间列表 ----------------

  function handleRoomList(list) {
    if (!els.lobbyGrid) return;
    list = list || [];
    if (els.roomCount) els.roomCount.textContent = String(list.length);
    if (!list.length) {
      els.lobbyGrid.innerHTML = '<div class="lb-empty">暂无公开房间，创建一个吧</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var room = list[i];
      var full = room.players >= 2;
      html += '<article class="room-card">' +
        '<header class="room-card-header"><span class="room-card-code">' + escapeHtml(room.code) + '</span>' +
        '<span class="room-state">' + (full ? '对局中' : '等待') + '</span></header>' +
        '<p class="room-card-meta">房主：' + escapeHtml(room.creator || '?') + '<br>' +
        (room.size || 15) + ' 路 · ' + (RULE_LABELS[room.rule] || '自由') + '<br>人数：' + (room.players || 1) + '/2</p>' +
        '<button class="big-btn primary small" type="button" data-code="' + escapeHtml(room.code) + '"' +
        (full ? ' disabled' : '') + '>加入</button>' +
        '</article>';
    }
    els.lobbyGrid.innerHTML = html;
  }

  function joinPublicRoom(code) {
    var nick = els.inputNickname.value.trim() || auth.nickname;
    if (!auth.token || !nick) {
      handleError('请先注册或登录');
      return;
    }
    window.SFX.click();
    window.Network.joinRoom({ token: auth.token, nickname: nick, code: code });
  }

  // ---------------- 在线流程 ----------------

  function handleConnect() {
    updateConnectHint();
  }

  function handleDisconnect() {
    updateConnectHint();
  }

  function handleRoomCreated(data) {
    onlineState.mode = 'waiting';
    onlineState.roomCode = data.code;
    onlineState.color = data.color || 1;
    onlineState.isPublic = !!data.isPublic;
    if (data.isPublic) {
      showRoomStatus(
        '<div class="room-waiting">房间已公开，等待对手加入…</div>' +
        '<div class="room-code-display">' + escapeHtml(data.code) + '</div>'
      );
    } else {
      showRoomStatus(
        '<div class="room-code-label">私密房间已创建，把房间码发给对手</div>' +
        '<div class="room-code-display">' + escapeHtml(data.code) + '</div>' +
        '<div class="room-waiting">等待对手加入…</div>'
      );
    }
    els.btnCreateRoom.textContent = '已创建';
    els.btnCreateRoom.disabled = true;
    els.btnJoinRoom.disabled = true;
    els.inputNickname.disabled = true;
    els.inputPassword.disabled = true;
    window.GC.saveNickname(els.inputNickname.value.trim());
  }

  function handleGameStart(data) {
    var session = window.Network.getSession ? window.Network.getSession() : null;
    var myNick = (data.myNickname) || els.inputNickname.value.trim() || auth.nickname || (session && session.nickname) || '你';
    var myColor = data.youColor || onlineState.color || (data.black.nickname === myNick ? 1 : 2);
    onlineState.mode = 'playing';
    onlineState.color = myColor;
    closeDialog(els.onlineConfig);
    closeDialog(els.winOverlay);
    window.GC.saveNickname(myNick);
    callbacks.start({
      mode: 'online',
      size: data.size || window.GC.SIZE,
      rule: data.rule || (data.renju ? 'renju' : 'free'),
      myColor: myColor,
      myNickname: myNick,
      opponentNickname: myColor === 1 ? data.white.nickname : data.black.nickname,
      roomCode: onlineState.roomCode || (session && session.code) || null,
      turnSeconds: data.turnSeconds || 30
    });
  }

  function handleOpponentJoined(data) {
    if (onlineState.mode !== 'waiting') return;
    showRoomStatus(
      '<div class="room-code-label">对手已加入</div>' +
      '<div class="room-code-display">' + escapeHtml(onlineState.roomCode || '') + '</div>' +
      '<div class="room-waiting">即将开始…</div>'
    );
    window.SFX.join();
    window.GC.announce((data && data.nickname ? data.nickname : '对手') + ' 已加入房间');
  }

  function handleRoomSession(data) {
    if (data && data.color) {
      onlineState.color = data.color;
      onlineState.roomCode = data.code || onlineState.roomCode;
    }
  }

  function handleRoomRejoined(data) {
    if (!data) return;
    onlineState.roomCode = data.code || onlineState.roomCode;
    onlineState.color = data.color || onlineState.color;
    var state = data.state || {};
    var bothReady = state.players && state.players[1] && state.players[2];
    var session = window.Network.getSession ? window.Network.getSession() : null;
    var myNick = (session && session.nickname) || auth.nickname || '你';

    if (state.moveCount > 0 || state.gameOver) {
      onlineState.mode = 'playing';
      if (els.onlineConfig.open) closeDialog(els.onlineConfig);
      window.Gomoku.restoreOnlineGame(state, data.color || onlineState.color);
      return;
    }
    if (bothReady) {
      onlineState.mode = 'playing';
      closeDialog(els.onlineConfig);
      callbacks.start({
        mode: 'online',
        size: state.size || window.GC.SIZE,
        rule: state.rule || (state.renju ? 'renju' : 'free'),
        myColor: data.color || onlineState.color,
        myNickname: myNick,
        opponentNickname: data.color === 1 ? state.players[2] : state.players[1],
        roomCode: data.code || onlineState.roomCode,
        turnSeconds: state.turnSeconds || 30
      });
      return;
    }
    onlineState.mode = 'waiting';
    if (els.onlineConfig.open) {
      showRoomStatus(
        '<div class="room-code-label">已恢复到房间</div>' +
        '<div class="room-code-display">' + escapeHtml(data.code || '') + '</div>' +
        '<div class="room-waiting">等待对手加入…</div>'
      );
    }
  }

  function handleOpponentRejoined(data) {
    window.FX.toast((data && data.nickname ? data.nickname : '对手') + ' 已重连', window.innerWidth / 2, window.innerHeight / 2, '#00e5ff', true);
  }

  function handleError(msg) {
    showRoomStatus('<div class="room-error">' + escapeHtml(msg) + '</div>');
    window.FX.toast(String(msg), window.innerWidth / 2, window.innerHeight / 2, '#ff6b6b', true);
    window.GC.announce(String(msg));
    if (window.console && console.warn) console.warn('[network]', msg);
    window.SFX.illegal();
  }

  function doAuth(register) {
    var nick = els.inputNickname.value.trim();
    var pass = els.inputPassword.value;
    if (!nick || !pass) {
      handleError('请输入昵称和密码');
      els.inputNickname.focus();
      return;
    }
    if (register && pass.length < 4) {
      handleError('密码至少 4 位');
      els.inputPassword.focus();
      return;
    }
    if (auth.token && !register) {
      if (onlineState.mode === 'waiting' || onlineState.mode === 'playing') window.Network.leaveRoom();
      if (auth.token) window.Network.logout(auth.token);
      setAuth(null, '');
      onlineState = { mode: 'idle', roomCode: null, color: null, isPublic: onlineState.isPublic };
      els.inputPassword.value = '';
      showRoomStatus('<div class="room-waiting">已退出登录</div>');
      return;
    }
    var cb = function (res) {
      if (res && res.ok) {
        setAuth(res.token, nick);
        window.GC.saveNickname(nick);
        els.inputPassword.value = '';
        showRoomStatus('<div class="room-waiting">' + (register ? '注册成功' : '登录成功') + '，可以创建或加入房间</div>');
        window.SFX.join();
      } else {
        handleError((res && res.error) || (register ? '注册失败' : '登录失败'));
      }
    };
    if (register) window.Network.register(nick, pass, cb);
    else window.Network.login(nick, pass, cb);
  }

  function createRoom() {
    var nick = els.inputNickname.value.trim() || auth.nickname;
    if (!auth.token || !nick) {
      handleError('请先注册或登录');
      return;
    }
    window.SFX.click();
    window.Network.createRoom({
      token: auth.token,
      nickname: nick,
      size: window.GC.settings.boardSize || window.GC.SIZE,
      rule: window.GC.settings.rule || 'free',
      isPublic: onlineState.isPublic
    });
  }

  function joinByCode() {
    var nick = els.inputNickname.value.trim() || auth.nickname;
    var code = els.inputRoomCode.value.trim().toUpperCase();
    if (!auth.token || !nick) { handleError('请先注册或登录'); return; }
    if (!code || code.length < 4) { handleError('请输入房间码'); els.inputRoomCode.focus(); return; }
    window.SFX.click();
    window.Network.joinRoom({ token: auth.token, nickname: nick, code: code });
  }

  // ---------------- 初始化 ----------------

  window.Cover = {
    init: function (cb) {
      callbacks = cb || callbacks;
      loadAuth();
      refreshAuthUI();

      els.btnPvp.addEventListener('click', function () {
        window.SFX.click();
        callbacks.start({ mode: 'pvp', size: window.GC.settings.boardSize || window.GC.SIZE, rule: window.GC.settings.rule || 'free' });
      });

      els.btnVsAi.addEventListener('click', function () {
        window.SFX.click();
        hideAllPanels();
        setConfigVisible(true);
      });
      els.btnAiBack.addEventListener('click', function () {
        window.SFX.click();
        setConfigVisible(false);
      });
      els.btnOnline.addEventListener('click', function () {
        window.SFX.click();
        hideAllPanels();
        setOnlineConfigVisible(true);
      });
      els.btnOnlineBack.addEventListener('click', function () {
        window.SFX.click();
        if (onlineState.mode === 'waiting') window.Network.leaveRoom();
        setOnlineConfigVisible(false);
      });
      els.onlineConfig.addEventListener('close', function () {
        if (onlineState.mode === 'waiting') {
          window.Network.leaveRoom();
          onlineState.mode = 'idle';
        }
      });

      els.btnRegister.addEventListener('click', function () {
        window.SFX.click();
        doAuth(true);
      });
      els.btnLogin.addEventListener('click', function () {
        window.SFX.click();
        doAuth(false);
      });
      els.authForm.addEventListener('submit', function (e) {
        e.preventDefault();
        doAuth(false);
      });

      els.btnCreateRoom.addEventListener('click', createRoom);
      els.btnJoinRoom.addEventListener('click', joinByCode);
      els.inputRoomCode.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') joinByCode();
      });

      window.Network.on('connect', handleConnect);
      window.Network.on('disconnect', handleDisconnect);
      window.Network.on('connectFailed', handleConnect);
      window.Network.on('roomCreated', handleRoomCreated);
      window.Network.on('roomList', handleRoomList);
      window.Network.on('roomSession', handleRoomSession);
      window.Network.on('roomRejoined', handleRoomRejoined);
      window.Network.on('opponentJoined', handleOpponentJoined);
      window.Network.on('opponentRejoined', handleOpponentRejoined);
      window.Network.on('gameStart', handleGameStart);
      window.Network.on('error', handleError);

      if (els.lobbyGrid) {
        els.lobbyGrid.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('button[data-code]') : null;
          if (btn && !btn.disabled) joinPublicRoom(btn.getAttribute('data-code'));
        });
      }

      els.btnLeaderboard.addEventListener('click', function () {
        window.SFX.click();
        hideAllPanels();
        setLeaderboardVisible(true);
      });
      els.btnLbClose.addEventListener('click', function () {
        window.SFX.click();
        setLeaderboardVisible(false);
      });
      els.btnLbRefresh.addEventListener('click', function () {
        window.SFX.click();
        lbCacheData = null;
        loadLeaderboard();
      });
      bindSeg(els.segLbTab, function (v) {
        lbTab = v;
        lbCacheData = null;
        renderLeaderboard();
        if (v === 'online') loadLeaderboard();
      }, true);

      els.btnSettings.addEventListener('click', function () {
        window.SFX.click();
        hideAllPanels();
        setSettingsVisible(true);
      });
      els.btnSettingsClose.addEventListener('click', function () {
        window.SFX.click();
        setSettingsVisible(false);
      });

      els.btnAiStart.addEventListener('click', function () {
        window.SFX.click();
        window.GC.saveSettings();
        closeDialog(els.aiConfig);
        callbacks.start({
          mode: 'ai',
          difficulty: selected.difficulty,
          humanSide: selected.humanSide,
          size: window.GC.settings.boardSize || window.GC.SIZE,
          rule: window.GC.settings.rule || 'free'
        });
      });

      bindSeg(els.segDifficulty, function (v) { selected.difficulty = v; });
      bindSeg(els.segSide, function (v) { selected.humanSide = parseInt(v, 10); });
      bindSeg(els.segRoomPrivacy, function (v) { onlineState.isPublic = v === '1'; });

      bindSeg(els.segBoardSize, function (v) {
        window.GC.setBoardSize(parseInt(v, 10));
        syncSettingsUI();
      });
      bindSeg(els.segAiBoardSize, function (v) {
        window.GC.setBoardSize(parseInt(v, 10));
        syncSettingsUI();
      });
      bindSeg(els.segRule, function (v) {
        window.GC.settings.rule = v;
        window.GC.saveSettings();
        syncSettingsUI();
      });
      bindSeg(els.segAiRule, function (v) {
        window.GC.settings.rule = v;
        window.GC.saveSettings();
        updateRuleHint(v);
        syncSeg(els.segRule, v);
      });
      bindSeg(els.segUiTheme, function (v) {
        window.GC.settings.uiTheme = v;
        window.GC.saveSettings();
        window.GC.applyUiTheme();
      });
      bindSeg(els.segAuto, function (v) {
        window.GC.settings.auto = v === '1';
        window.GC.saveSettings();
        if (window.Gomoku && window.Gomoku.refreshAutoChip) window.Gomoku.refreshAutoChip();
      });
      bindSeg(els.segFx, function (v) {
        window.GC.settings.fx = v;
        window.GC.saveSettings();
        window.FX.syncIntensity();
        if (window.PS && window.PS.syncBudget) window.PS.syncBudget();
      });
      bindSeg(els.segMute, function (v) {
        window.SFX.setMuted(v === '1');
        if (window.Gomoku && window.Gomoku.updateMuteIcons) window.Gomoku.updateMuteIcons();
      });

      els.sliderInterval.addEventListener('input', function () {
        window.GC.settings.interval = parseInt(els.sliderInterval.value, 10);
        els.intervalVal.textContent = window.GC.settings.interval + ' 秒';
        window.GC.saveSettings();
      });
      els.sliderDuration.addEventListener('input', function () {
        window.GC.settings.duration = parseFloat(els.sliderDuration.value);
        els.durationVal.textContent = window.GC.settings.duration.toFixed(1) + ' 秒';
        window.GC.saveSettings();
      });
      els.sliderSfx.addEventListener('input', function () {
        window.GC.settings.sfx = parseInt(els.sliderSfx.value, 10) / 100;
        els.sfxVal.textContent = els.sliderSfx.value + '%';
        window.GC.saveSettings();
        window.SFX.syncVolumes();
        window.SFX.click();
      });
      els.sliderMusic.addEventListener('input', function () {
        window.GC.settings.music = parseInt(els.sliderMusic.value, 10) / 100;
        els.musicVal.textContent = els.sliderMusic.value + '%';
        window.GC.saveSettings();
        window.SFX.syncVolumes();
      });

      // 任何 [data-close] 按钮关闭对应对话框
      document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-close]') : null;
        if (!btn) return;
        closeDialog(document.getElementById(btn.getAttribute('data-close')));
      });

      // 设置对话框关闭时刷新显示值
      els.settingsPanel.addEventListener('close', syncSettingsUI);

      syncSettingsUI();
      updateConnectHint();
    },

    show: function () {
      hideAllPanels();
      syncSettingsUI();
      refreshAuthUI();
      els.cover.classList.remove('hidden');
    },

    hide: function () {
      els.cover.classList.add('hidden');
    },

    openOnline: function () {
      hideAllPanels();
      setOnlineConfigVisible(true);
    },

    getOnlineState: function () {
      return onlineState;
    },
    setOnlineState: function (state) {
      onlineState = state;
    }
  };
})();