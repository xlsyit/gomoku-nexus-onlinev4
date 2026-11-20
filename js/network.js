(function () {
  'use strict';

  var socket = null;
  var connected = false;
  var connecting = false;
  var connectFailed = false;
  var listeners = {};
  var activeSession = null;
  var SESSION_KEY = 'gmx_room_session_v4';
  var AUTH_KEY = 'gmx_auth';
  var TAB_ID = (function () {
    try {
      var id = window.sessionStorage.getItem('gmx_tab_id');
      if (!id) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        window.sessionStorage.setItem('gmx_tab_id', id);
      }
      return id;
    } catch (e) {
      return 'tab-' + Math.random().toString(36).slice(2);
    }
  })();
  var EVENTS = [
    'roomCreated', 'roomList', 'roomSession', 'roomRejoined',
    'opponentJoined', 'opponentRejoined', 'gameStart',
    'opponentMove', 'opponentLeft', 'chat', 'error',
    'rematchRequested', 'rematchAccepted', 'rematchDeclined',
    'gameOver', 'clock', 'moveRejected'
  ];

  function ensureStore() {
    EVENTS.forEach(function (evt) {
      if (!listeners[evt]) listeners[evt] = [];
    });
    ['connect', 'disconnect', 'connectFailed'].forEach(function (evt) {
      if (!listeners[evt]) listeners[evt] = [];
    });
  }
  ensureStore();

  function getServerUrl() {
    if (window.GC && window.GC.SERVER_URL) return window.GC.SERVER_URL;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000';
    return window.location.origin;
  }

  function getApiUrl() {
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000';
    return window.location.origin;
  }

  function loadActiveSession() {
    if (activeSession) return activeSession;
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) activeSession = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return activeSession;
  }

  function saveActiveSession(data) {
    activeSession = {
      code: data.code,
      color: data.color,
      token: data.token,
      nickname: data.nickname || (activeSession && activeSession.nickname) || ''
    };
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
    } catch (e) { /* ignore */ }
  }

  function clearActiveSession() {
    activeSession = null;
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return function () { off(event, fn); };
  }

  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (f) { return f !== fn; });
  }

  function fire(event, args) {
    var list = listeners[event];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(null, args || []); } catch (e) { console.error('Network handler error:', e); }
    }
  }

  function emit(event, data) {
    if (!socket || !connected) return false;
    socket.emit(event, data);
    return true;
  }

  function connect() {
    if (connected) { fire('connect', []); return true; }
    if (connecting) return true;

    if (typeof window.io !== 'function') {
      connectFailed = true;
      fire('connectFailed', ['通信组件未能加载']);
      return false;
    }

    connecting = true;
    connectFailed = false;
    var url = getServerUrl();
    try {
      if (socket) socket.disconnect();
      socket = window.io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        reconnectionAttempts: Infinity,
        timeout: 10000
      });
    } catch (e) {
      connecting = false;
      connectFailed = true;
      socket = null;
      fire('connectFailed', ['无法初始化连接']);
      return false;
    }

    bindSocketEvents();
    return true;
  }

  function bindSocketEvents() {
    if (!socket) return;

    socket.on('connect', function () {
      connected = true;
      connecting = false;
      connectFailed = false;
      fire('connect', []);
      var session = loadActiveSession();
      if (session && session.code && session.token) {
        socket.emit('rejoinRoom', { code: session.code, token: session.token, tabId: TAB_ID });
      }
    });

    socket.on('disconnect', function () {
      connected = false;
      connecting = false;
      fire('disconnect', []);
    });

    socket.on('connect_error', function (err) {
      connected = false;
      connecting = false;
      connectFailed = true;
      fire('connectFailed', [err && err.message ? err.message : '连接失败']);
    });

    EVENTS.forEach(function (evt) {
      socket.on(evt, function (data) {
        if (evt === 'roomSession' && data && data.code && data.token) saveActiveSession(data);
        if (evt === 'gameStart' && data && data.myNickname) {
          var session = loadActiveSession();
          if (session) {
            session.nickname = data.myNickname;
            if (data.youColor) session.color = data.youColor;
            saveActiveSession(session);
          }
        }
        fire(evt, [data]);
      });
    });
  }

  function disconnect() {
    clearActiveSession();
    if (socket) {
      try { socket.disconnect(); } catch (e) { /* ignore */ }
      socket = null;
    }
    connected = false;
    connecting = false;
  }

  function isConnected() { return connected; }
  function hasFailed() { return connectFailed; }

  function apiPost(path, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', getApiUrl() + path, true);
    xhr.timeout = 8000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var res = null;
      try { res = JSON.parse(xhr.responseText); } catch (e) { res = null; }
      if (res && typeof res.ok === 'boolean') cb(res);
      else if (xhr.status === 429) cb({ ok: false, error: '尝试次数过多，请稍后再试' });
      else if (xhr.status === 0) cb({ ok: false, error: '无法连接服务器' });
      else cb({ ok: false, error: '服务器响应异常' });
    };
    xhr.onerror = function () { cb({ ok: false, error: '无法连接服务器' }); };
    xhr.ontimeout = function () { cb({ ok: false, error: '请求超时' }); };
    xhr.send(JSON.stringify(body || {}));
  }

  function getLeaderboard(limit, cb) {
    if (typeof limit === 'function') { cb = limit; limit = 50; }
    var url = getApiUrl() + '/api/leaderboard?limit=' + encodeURIComponent(limit || 50);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var res = JSON.parse(xhr.responseText);
          cb(res && res.ok ? res.data : null);
        } catch (e) { cb(null); }
      } else {
        cb(null);
      }
    };
    xhr.onerror = function () { cb(null); };
    xhr.ontimeout = function () { cb(null); };
    xhr.send();
  }

  function getAuth() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(AUTH_KEY) || 'null');
      if (saved && saved.token) return saved;
    } catch (e) { /* ignore */ }
    return null;
  }

  function setAuth(token, nickname) {
    try {
      if (token) window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token: token, nickname: nickname }));
      else window.localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* ignore */ }
  }

  window.Network = {
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    hasFailed: hasFailed,
    on: on,
    off: off,
    getAuth: getAuth,
    setAuth: setAuth,
    register: function (nickname, password, cb) {
      apiPost('/api/register', { nickname: nickname, password: password }, cb);
    },
    login: function (nickname, password, cb) {
      apiPost('/api/login', { nickname: nickname, password: password }, cb);
    },
    logout: function (token, cb) {
      apiPost('/api/logout', { token: token }, cb || function () {});
    },
    createRoom: function (data) { data = data || {}; data.tabId = TAB_ID; return emit('createRoom', data); },
    joinRoom: function (data) { data = data || {}; data.tabId = TAB_ID; return emit('joinRoom', data); },
    rejoinRoom: function (code, token) { return emit('rejoinRoom', { code: code, token: token, tabId: TAB_ID }); },
    sendMove: function (r, c) { return emit('move', { r: r, c: c }); },
    sendAbort: function () { return emit('gameEnd', { winner: 'abort' }); },
    sendChat: function (message) { return emit('chat', message); },
    leaveRoom: function () {
      emit('leaveRoom');
      clearActiveSession();
    },
    requestRematch: function () { return emit('rematchRequest'); },
    acceptRematch: function () { return emit('rematchAccept'); },
    declineRematch: function () { return emit('rematchDecline'); },
    getSession: loadActiveSession,
    clearSession: clearActiveSession,
    saveSession: saveActiveSession,
    getLeaderboard: getLeaderboard
  };
})();