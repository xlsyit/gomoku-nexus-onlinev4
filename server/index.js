'use strict';

var crypto = require('crypto');
var path = require('path');
var express = require('express');
var http = require('http');
var socketIO = require('socket.io');
var db = require('./database');
var RoomManager = require('./room-manager');

var PORT = process.env.PORT || 3000;
var ROOT = path.join(__dirname, '..');
var SESSION_TTL = 12 * 60 * 60 * 1000;
var LEADERBOARD_TTL = 10 * 1000;

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

var sessions = new Map();       // token -> { nickname, expiresAt }
var authBuckets = new Map();    // ip -> { count, resetAt }

function issueSession(nickname) {
  var token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { nickname: nickname, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  var s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function revokeSession(token) {
  if (token) sessions.delete(token);
}

function rateLimited(key, max, windowMs) {
  var now = Date.now();
  var b = authBuckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    authBuckets.set(key, b);
  }
  b.count++;
  return b.count > max;
}

setInterval(function () {
  var now = Date.now();
  sessions.forEach(function (s, token) {
    if (now > s.expiresAt) sessions.delete(token);
  });
  authBuckets.forEach(function (b, key) {
    if (now > b.resetAt) authBuckets.delete(key);
  });
}, 5 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

var app = express();
var server = http.createServer(app);
var io = socketIO(server, {
  pingTimeout: 20000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e5
});

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; '));
  next();
});

/* 只暴露白名单内的静态资源，server/、数据库与日志一律 404。 */
function isPublicAsset(p) {
  if (p === '/' || p === '/index.html' || p === '/online.html' ||
      p === '/styles.css' || p === '/manifest.webmanifest' || p === '/favicon.ico') return true;
  if (/^\/js\/[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-.]+\.js$/.test(p)) return true;
  if (/^\/js\/[A-Za-z0-9_\-]+\.js$/.test(p)) return true;
  if (/^\/preview\/[^/]+\.(png|jpe?g|webp)$/i.test(p)) return true;
  return false;
}

app.use(function (req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.indexOf('/api/') === 0 || req.path.indexOf('/socket.io') === 0) return next();
  if (!isPublicAsset(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

app.use(express.static(ROOT, { index: false, dotfiles: 'deny', maxAge: 0 }));

app.get('/', function (req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
});

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

var lbCache = { at: 0, data: null };

app.get('/api/health', function (req, res) {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/api/leaderboard', function (req, res) {
  var now = Date.now();
  var limit = parseInt(req.query.limit, 10) || 50;
  if (lbCache.data && now - lbCache.at < LEADERBOARD_TTL && limit <= 50) {
    return res.json({ ok: true, data: lbCache.data, cached: true });
  }
  try {
    var list = db.getLeaderboard(limit);
    if (limit <= 50) {
      lbCache = { at: now, data: list };
    }
    res.json({ ok: true, data: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: '排行榜暂时不可用' });
  }
});

app.get('/api/player/:nickname', function (req, res) {
  if (rateLimited('player:' + clientIp(req), 60, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: '请求过于频繁' });
  }
  try {
    var player = db.getPlayer(req.params.nickname);
    if (!player) return res.status(404).json({ ok: false, error: '玩家不存在' });
    res.json({ ok: true, data: player });
  } catch (e) {
    res.status(500).json({ ok: false, error: '查询失败' });
  }
});

function handleAuth(req, res, register) {
  if (rateLimited('auth:' + clientIp(req), 12, 60 * 1000)) {
    return res.status(429).json({ ok: false, error: '尝试次数过多，请稍后再试' });
  }
  try {
    var result = register
      ? db.registerUser(req.body && req.body.nickname, req.body && req.body.password)
      : db.loginUser(req.body && req.body.nickname, req.body && req.body.password);
    if (!result.ok) return res.status(400).json(result);
    var nickname = result.data.nickname;
    var token = issueSession(nickname);
    res.json({ ok: true, token: token, data: result.data });
  } catch (e) {
    console.error('[auth]', e && e.message ? e.message : e);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
}

app.post('/api/register', function (req, res) { handleAuth(req, res, true); });
app.post('/api/login', function (req, res) { handleAuth(req, res, false); });

app.post('/api/logout', function (req, res) {
  var token = req.body && req.body.token;
  revokeSession(token);
  res.json({ ok: true });
});

app.get('*', function (req, res) {
  res.status(404).type('text/plain').send('Not found');
});

/* ------------------------------------------------------------------ */
/* Socket.IO                                                          */
/* ------------------------------------------------------------------ */

function broadcastRooms() {
  io.emit('roomList', RoomManager.listPublicRooms());
}

function playerBrief(room) {
  return {
    1: room.players[1] ? { nickname: room.players[1].nickname, color: 1 } : null,
    2: room.players[2] ? { nickname: room.players[2].nickname, color: 2 } : null
  };
}

function emitGameStart(room) {
  var start = {
    size: room.boardSize,
    rule: room.rule || 'free',
    renju: !!(room.rule && room.rule !== 'free'),
    turnSeconds: RoomManager.TURN_SECONDS
  };
  [1, 2].forEach(function (color) {
    var p = room.players[color];
    if (!p || !p.connected) return;
    io.to(p.socketId).emit('gameStart', {
      black: { nickname: room.players[1].nickname, color: 1 },
      white: { nickname: room.players[2].nickname, color: 2 },
      size: start.size,
      rule: start.rule,
      renju: start.renju,
      turnSeconds: start.turnSeconds,
      youColor: color,
      myNickname: p.nickname
    });
  });
}

function reportResult(result) {
  if (!result) return;
  if (result.draw) {
    var a = result.players && result.players[1];
    var b = result.players && result.players[2];
    if (a && b) db.updateDraw(a, b);
    return;
  }
  if (result.winnerNickname && result.loserNickname) {
    db.updateResult(result.winnerNickname, result.loserNickname);
  }
}

function emitGameOver(room, result) {
  if (!result) return;
  try {
    reportResult(result);
  } catch (e) {
    console.error('[db] result failed:', e && e.message ? e.message : e);
  }
  var payload = {
    winner: result.winner,
    draw: !!result.draw,
    reason: result.reason,
    winLine: result.winLine || null,
    lastMove: result.lastMove || null,
    players: result.players || null,
    board: room.board ? require('../js/rules.js').cloneBoard(room.board) : null
  };
  io.to(room.code).emit('gameOver', payload);
}

function authNickname(socket, data) {
  var token = data && data.token;
  var nickname = data && data.nickname != null ? String(data.nickname).trim().slice(0, 12) : '';
  var session = getSession(token);
  if (!session) return null;
  if (session.nickname.toLowerCase() !== nickname.toLowerCase()) return null;
  return session.nickname;
}

io.on('connection', function (socket) {
  var myNickname = '';
  var myRoomCode = null;

  socket.emit('roomList', RoomManager.listPublicRooms());

  socket.on('createRoom', function (data) {
    var nickname = authNickname(socket, data);
    if (!nickname) {
      socket.emit('error', '登录已过期，请重新登录');
      return;
    }
    if (myRoomCode) RoomManager.removePlayer(socket.id);
    myNickname = nickname;
    var created = RoomManager.createRoom(socket.id, nickname, data.token, {
      boardSize: data.size,
      rule: data.rule,
      isPublic: data.isPublic,
      tabId: data.tabId
    });
    myRoomCode = created.code;
    socket.join(created.code);
    socket.emit('roomSession', { code: created.code, color: 1, token: created.token, nickname: nickname });
    socket.emit('roomCreated', { code: created.code, color: 1, isPublic: !!data.isPublic });
    broadcastRooms();
  });

  socket.on('joinRoom', function (data) {
    var nickname = authNickname(socket, data);
    if (!nickname) {
      socket.emit('error', '登录已过期，请重新登录');
      return;
    }
    var code = String((data && data.code) || '').toUpperCase().trim();
    if (!code) {
      socket.emit('error', '请输入房间码');
      return;
    }
    if (myRoomCode && myRoomCode !== code) RoomManager.removePlayer(socket.id);
    var result = RoomManager.joinRoom(code, socket.id, nickname, data.token, {
      boardSize: data.size,
      rule: data.rule,
      tabId: data.tabId
    });
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    var room = result.room;
    myNickname = nickname;
    myRoomCode = code;
    socket.join(code);
    socket.emit('roomSession', {
      code: code, color: 2, token: room.players[2].token, nickname: nickname
    });
    socket.to(code).emit('opponentJoined', { nickname: nickname });
    if (room.players[1] && room.players[2]) {
      emitGameStart(room);
      broadcastRooms();
    }
  });

  socket.on('rejoinRoom', function (data) {
    var code = String((data && data.code) || '').toUpperCase().trim();
    var token = (data && data.token) || '';
    if (!code || !token) {
      socket.emit('error', '重连信息不完整');
      return;
    }
    // 防跨标签顶号：不同标签页且旧连接仍在线时，拒绝抢占；同标签刷新放行
    var existing = RoomManager.getRoom(code);
    var tabId = (data && data.tabId) || '';
    if (existing) {
      for (var seat = 1; seat <= 2; seat++) {
        var p = existing.players[seat];
        if (p && p.token === token && p.socketId !== socket.id) {
          var oldSocket = io.sockets.sockets.get(p.socketId);
          var sameTab = !!p.tabId && !!tabId && p.tabId === tabId;
          var legacySeat = !p.tabId;
          if (!sameTab && !legacySeat && oldSocket && oldSocket.connected) {
            socket.emit('error', '该房间座位正在另一个窗口中使用');
            return;
          }
        }
      }
    }
    var result = RoomManager.rejoinRoom(code, token, socket.id, tabId);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    myNickname = result.nickname;
    myRoomCode = code;
    socket.join(code);
    socket.emit('roomRejoined', {
      color: result.color,
      state: result.state,
      code: code,
      token: token,
      nickname: result.nickname
    });
    socket.to(code).emit('opponentRejoined', { nickname: myNickname });
  });

  socket.on('move', function (data) {
    if (!myRoomCode) return;
    var r = data ? data.r : -1;
    var c = data ? data.c : -1;
    if (typeof r !== 'number' || typeof c !== 'number') return;

    var result = RoomManager.submitMove(socket.id, myRoomCode, r, c);
    if (result.error) {
      socket.emit('error', result.error);
      socket.emit('moveRejected', { r: r, c: c, reason: result.error });
      return;
    }

    var room = result.room;
    if (!result.forbidden) {
      socket.to(myRoomCode).emit('opponentMove', { r: r, c: c, color: result.color });
    }
    if (result.result) {
      emitGameOver(room, result.result);
      broadcastRooms();
    } else {
      io.to(myRoomCode).emit('clock', {
        remaining: RoomManager.remainingSeconds(room),
        currentTurn: room.currentTurn
      });
    }
  });

  socket.on('chat', function (message) {
    if (!myRoomCode || !myNickname) return;
    if (!message || String(message).trim().length === 0) return;
    var text = myNickname.slice(0, 12) + ': ' + String(message).trim().slice(0, 100);
    socket.to(myRoomCode).emit('chat', { text: text });
  });

  socket.on('rematchRequest', function () {
    if (!myRoomCode || !myNickname) return;
    var room = RoomManager.getRoom(myRoomCode);
    if (!room || !room.gameOver) return;
    socket.to(myRoomCode).emit('rematchRequested', { nickname: myNickname });
  });

  socket.on('rematchAccept', function () {
    if (!myRoomCode || !myNickname) return;
    var vote = RoomManager.submitRematchVote(socket.id, myRoomCode);
    if (vote.error) {
      socket.emit('error', vote.error);
      return;
    }
    if (vote.waiting) {
      socket.to(myRoomCode).emit('rematchAccepted', { nickname: myNickname });
      return;
    }
    var room = vote.room;
    [1, 2].forEach(function (color) {
      var p = room.players[color];
      if (p && p.connected) {
        io.to(p.socketId).emit('roomSession', { code: room.code, color: color, token: p.token, nickname: p.nickname });
      }
    });
    emitGameStart(room);
    io.to(room.code).emit('clock', { remaining: RoomManager.TURN_SECONDS, currentTurn: room.currentTurn });
  });

  socket.on('rematchDecline', function () {
    if (!myRoomCode || !myNickname) return;
    RoomManager.declineRematch(socket.id, myRoomCode);
    socket.to(myRoomCode).emit('rematchDeclined', { nickname: myNickname });
  });

  socket.on('disconnect', function () {
    var result = RoomManager.markDisconnected(socket.id);
    if (result && result.room) {
      socket.to(result.code).emit('opponentLeft', {
        nickname: result.leftNickname,
        youWin: false,
        reconnecting: true
      });
    }
  });

  socket.on('leaveRoom', function () {
    var result = RoomManager.removePlayer(socket.id);
    if (!result) { myRoomCode = null; return; }
    var room = result.room;
    if (result.result) {
      emitGameOver(room, result.result);
    } else if (!result.closed) {
      socket.to(room.code).emit('opponentLeft', {
        nickname: result.leftNickname,
        youWin: false,
        reconnecting: false
      });
    }
    if (result.closed) {
      socket.to(room.code).emit('opponentLeft', {
        nickname: result.leftNickname,
        youWin: false,
        reconnecting: false,
        closed: true
      });
    }
    if (result.hostLeft) RoomManager.closeRoom(room.code);
    socket.leave(room.code);
    myRoomCode = null;
    broadcastRooms();
  });
});

/* 每步时钟 + 掉线宽限 */
setInterval(function () {
  var now = Date.now();

  var snapshots = RoomManager.tickClocks();
  for (var i = 0; i < snapshots.length; i++) {
    io.to(snapshots[i].code).emit('clock', {
      remaining: snapshots[i].remaining,
      currentTurn: snapshots[i].currentTurn
    });
  }

  var timedOut = RoomManager.checkClocks(now);
  for (var t = 0; t < timedOut.length; t++) {
    emitGameOver(timedOut[t].room, timedOut[t].result);
  }

  var expired = RoomManager.checkRejoinTimeouts(now);
  for (var e = 0; e < expired.length; e++) {
    var item = expired[e];
    if (item.result) emitGameOver(item.room, item.result);
    io.to(item.code).emit('opponentLeft', {
      nickname: item.leftNickname,
      youWin: false,
      reconnecting: false
    });
  }

  if (timedOut.length || expired.length) broadcastRooms();
}, 1000);

process.on('uncaughtException', function (err) {
  console.error('[server] uncaught exception:', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', function (reason) {
  console.error('[server] unhandled rejection:', reason);
});

function shutdown(signal) {
  console.log('[server] shutting down (' + signal + ')');
  io.close();
  server.close(function () {
    db.close();
    process.exit(0);
  });
  setTimeout(function () { process.exit(0); }, 3000).unref();
}

process.on('SIGINT', function () { shutdown('SIGINT'); });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });

server.listen(PORT, function () {
  console.log('Gomoku Nexus v4 server running on http://localhost:' + PORT);
});