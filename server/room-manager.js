'use strict';

/*
 * 房间状态机（服务端）
 * ---------------------------------------------------------------
 * - 所有规则判断都交给 js/rules.js，禁止在服务端另写一套。
 * - 胜负/和棋/禁手/超时/掉线全部由服务端裁决，客户端只负责展示。
 */
var Rules = require('../js/rules.js');

var rooms = {};
var IDLE_TIMEOUT = 30 * 60 * 1000;
var REJOIN_GRACE = 60 * 1000;
var TURN_SECONDS = 30;
var idleTimer = null;

function makeToken() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var token = '';
  for (var i = 0; i < 18; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generateCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeSize(n) {
  n = parseInt(n, 10);
  return [9, 11, 13, 15, 19].indexOf(n) >= 0 ? n : 15;
}

function normalizeRule(r) {
  return ['free', 'renju', 'folk'].indexOf(r) >= 0 ? r : 'free';
}

function ensureBoard(room) {
  if (!room.board) room.board = Rules.makeBoard(room.boardSize);
  return room.board;
}

function startClock(room, now) {
  room.turnDeadline = (now || Date.now()) + TURN_SECONDS * 1000;
}

function remainingSeconds(room, now) {
  if (!room.turnDeadline) return TURN_SECONDS;
  var ms = room.turnDeadline - (now || Date.now());
  return Math.max(0, Math.ceil(ms / 1000));
}

function createRoom(socketId, nickname, token, opts) {
  var code = generateCode();
  while (rooms[code]) code = generateCode();
  var room = {
    code: code,
    boardSize: normalizeSize(opts && opts.boardSize),
    rule: normalizeRule(opts && opts.rule),
    isPublic: !!(opts && opts.isPublic),
    players: {
      1: { socketId: socketId, nickname: nickname, token: token || makeToken(), connected: true, disconnectedAt: null, tabId: (opts && opts.tabId) || '' },
      2: null
    },
    currentTurn: 1,
    board: null,
    moveCount: 0,
    lastMove: null,
    createdAt: Date.now(),
    gameOver: false,
    winner: 0,
    draw: false,
    reason: '',
    resultReported: false,
    turnDeadline: 0,
    rematch: { 1: false, 2: false }
  };
  rooms[code] = room;
  return { code: code, token: room.players[1].token, room: room };
}

/* 加入房间时以房主配置为准：不再因棋盘大小/规则不一致而拒绝。 */
function joinRoom(code, socketId, nickname, token, opts) {
  var room = rooms[code];
  if (!room) return { error: '房间不存在或已过期' };
  if (room.players[2] && room.players[2].socketId !== socketId) return { error: '房间已满' };
  if (room.gameOver && room.moveCount > 0) return { error: '本局已结束' };

  if (room.players[2] && room.players[2].socketId === socketId) {
    room.players[2].connected = true;
    room.players[2].disconnectedAt = null;
    return { room: room, color: 2, rejoin: true };
  }

  room.players[2] = {
    socketId: socketId,
    nickname: nickname,
    token: token || makeToken(),
    connected: true,
    disconnectedAt: null,
    tabId: (opts && opts.tabId) || ''
  };
  if (!room.turnDeadline) startClock(room);
  return { room: room, color: 2, rejoin: false };
}

function getRoom(code) {
  return rooms[code] || null;
}

function getPlayerColor(socketId, room) {
  if (room.players[1] && room.players[1].socketId === socketId) return 1;
  if (room.players[2] && room.players[2].socketId === socketId) return 2;
  return 0;
}

function getPlayerNickname(socketId, room) {
  var color = getPlayerColor(socketId, room);
  return color === 0 ? null : room.players[color].nickname;
}

function bothPresent(room) {
  return !!(room.players[1] && room.players[2] &&
    room.players[1].connected && room.players[2].connected);
}

function finishGame(room, winner, reason, extra) {
  if (room.gameOver) return null;
  room.gameOver = true;
  room.winner = winner || 0;
  room.draw = reason === 'draw';
  room.reason = reason || '';
  room.turnDeadline = 0;
  var out = {
    code: room.code,
    winner: room.winner,
    draw: room.draw,
    reason: room.reason,
    winLine: (extra && extra.winLine) || null,
    lastMove: room.lastMove ? { r: room.lastMove.r, c: room.lastMove.c } : null,
    players: {
      1: room.players[1] ? room.players[1].nickname : null,
      2: room.players[2] ? room.players[2].nickname : null
    }
  };
  if (!room.draw && room.winner) {
    var lose = room.winner === 1 ? 2 : 1;
    out.winnerNickname = room.players[room.winner] ? room.players[room.winner].nickname : null;
    out.loserNickname = room.players[lose] ? room.players[lose].nickname : null;
  } else if (room.draw) {
    out.winnerNickname = null;
    out.loserNickname = null;
  }
  return out;
}

function submitMove(socketId, code, r, c) {
  var room = rooms[code];
  if (!room) return { error: '房间不存在' };
  if (room.gameOver) return { error: '本局已结束' };
  var color = getPlayerColor(socketId, room);
  if (color === 0) return { error: '不在房间中' };
  if (!room.players[1] || !room.players[2]) return { error: '对手还未加入' };
  if (room.currentTurn !== color) return { error: '不是你的回合' };

  var board = ensureBoard(room);
  var size = room.boardSize;

  if (typeof r !== 'number' || typeof c !== 'number') return { error: '坐标无效' };
  r = Math.floor(r);
  c = Math.floor(c);
  if (!Rules.inB(size, r, c)) return { error: '坐标越界' };
  if (board[r][c] !== 0) return { error: '位置已被占据' };

  var verdict = Rules.judge(board, size, room.rule, r, c, color);
  if (!verdict.ok) {
    if (verdict.forbidden) {
      room.lastMove = { r: r, c: c };
      var forbiddenResult = finishGame(room, 2, 'forbidden', { winLine: null });
      return { room: room, color: color, forbidden: true, result: forbiddenResult };
    }
    return { error: verdict.error || '落子失败' };
  }

  room.moveCount++;
  room.lastMove = { r: r, c: c };

  if (verdict.win) {
    var winResult = finishGame(room, color, 'five', { winLine: verdict.winLine });
    return { room: room, color: color, result: winResult };
  }
  if (verdict.draw) {
    var drawResult = finishGame(room, 0, 'draw', {});
    return { room: room, color: color, result: drawResult };
  }

  room.currentTurn = color === 1 ? 2 : 1;
  startClock(room);
  return { room: room, color: color, result: null };
}

function markDisconnected(socketId) {
  for (var code in rooms) {
    var room = rooms[code];
    for (var color = 1; color <= 2; color++) {
      var p = room.players[color];
      if (p && p.socketId === socketId) {
        if (p.disconnectedAt) return null;
        p.connected = false;
        p.disconnectedAt = Date.now();
        return { room: room, code: code, leftNickname: p.nickname, color: color };
      }
    }
  }
  return null;
}

function rejoinRoom(code, token, socketId, tabId) {
  var room = rooms[code];
  if (!room) return { error: '房间不存在或已过期' };
  for (var color = 1; color <= 2; color++) {
    var p = room.players[color];
    if (p && p.token === token) {
      p.socketId = socketId;
      p.connected = true;
      p.disconnectedAt = null;
      if (tabId) p.tabId = tabId;
      return { room: room, color: color, nickname: p.nickname, state: getState(room) };
    }
  }
  return { error: '重新加入失败，令牌无效' };
}

function getState(room) {
  var size = room.boardSize || 15;
  var board = room.board ? Rules.cloneBoard(room.board) : Rules.makeBoard(size);
  return {
    board: board,
    size: size,
    rule: room.rule || 'free',
    renju: !!(room.rule && room.rule !== 'free'),
    currentTurn: room.currentTurn,
    winner: room.winner,
    draw: !!room.draw,
    reason: room.reason || '',
    gameOver: room.gameOver,
    moveCount: room.moveCount,
    lastMove: room.lastMove ? { r: room.lastMove.r, c: room.lastMove.c } : null,
    remaining: remainingSeconds(room),
    turnSeconds: TURN_SECONDS,
    players: {
      1: room.players[1] ? room.players[1].nickname : null,
      2: room.players[2] ? room.players[2].nickname : null
    }
  };
}

function removePlayerByColor(room, color) {
  var code = room.code;
  var started = room.moveCount > 0 || room.board !== null;
  var p = room.players[color];
  if (!p) return null;

  if (!room.gameOver && started) {
    var result = finishGame(room, color === 1 ? 2 : 1, 'leave', {});
    return {
      room: room, code: code, leftNickname: p.nickname, winnerColor: room.winner,
      result: result, forfeit: true, hostLeft: color === 1
    };
  }

  if (color === 2) {
    room.players[2] = null;
    return { room: room, code: code, leftNickname: p.nickname, forfeit: false };
  }

  // 房主离开：房间直接关闭
  var guest = room.players[2] ? room.players[2].nickname : null;
  delete rooms[code];
  return { room: room, code: code, leftNickname: p.nickname, guestNickname: guest, closed: true, forfeit: false };
}

function removePlayer(socketId) {
  for (var code in rooms) {
    var room = rooms[code];
    for (var color = 1; color <= 2; color++) {
      if (room.players[color] && room.players[color].socketId === socketId) {
        return removePlayerByColor(room, color);
      }
    }
  }
  return null;
}

/* 掉线宽限期结束：判定离开者负，并返回需要记账的结果。 */
function checkRejoinTimeouts(now) {
  var expired = [];
  for (var code in rooms) {
    var room = rooms[code];
    for (var color = 1; color <= 2; color++) {
      var p = room.players[color];
      if (!p || !p.disconnectedAt) continue;
      if (now - p.disconnectedAt < REJOIN_GRACE) continue;

      var other = color === 1 ? 2 : 1;
      if (!room.players[other] || room.players[other].disconnectedAt) {
        delete rooms[code];
        break;
      }
      if (room.gameOver) {
        room.players[color] = null;
        if (!room.players[1] && !room.players[2]) delete rooms[code];
        break;
      }
      var started = room.moveCount > 0 || room.board !== null;
      if (started) {
        var result = finishGame(room, other, 'disconnect', {});
        room.players[color] = null;
        expired.push({ room: room, code: code, leftNickname: p.nickname, winnerColor: room.winner, result: result });
      } else {
        room.players[color] = null;
        if (!room.players[1]) delete rooms[code];
      }
      break;
    }
  }
  return expired;
}

/* 每步 30 秒：超时方判负。 */
function checkClocks(now) {
  var expired = [];
  for (var code in rooms) {
    var room = rooms[code];
    if (!room || room.gameOver || !room.turnDeadline) continue;
    if (!bothPresent(room)) continue;
    if (now < room.turnDeadline) continue;
    var loser = room.currentTurn;
    var winner = loser === 1 ? 2 : 1;
    var result = finishGame(room, winner, 'timeout', {});
    expired.push({ room: room, code: code, loserColor: loser, winnerColor: winner, result: result });
  }
  return expired;
}

function tickClocks() {
  var now = Date.now();
  var snapshots = [];
  for (var code in rooms) {
    var room = rooms[code];
    if (!room || room.gameOver || !bothPresent(room)) continue;
    room.remaining = remainingSeconds(room, now);
    snapshots.push({ code: code, remaining: room.remaining, currentTurn: room.currentTurn });
  }
  return snapshots;
}

function closeRoom(code) {
  var room = rooms[code];
  if (!room) return null;
  delete rooms[code];
  return room;
}

function submitRematchVote(socketId, code) {
  var room = rooms[code];
  if (!room) return { error: '房间不存在' };
  var color = getPlayerColor(socketId, room);
  if (color === 0) return { error: '不在房间中' };
  if (!room.gameOver) return { error: '对局尚未结束' };
  if (!bothPresent(room)) return { error: '对手不在线，无法再战' };
  room.rematch[color] = true;
  var both = room.rematch[1] && room.rematch[2];
  if (!both) return { room: room, waiting: true, color: color };

  // 双方同意：交换黑白，重置棋盘
  room.gameOver = false;
  room.winner = 0;
  room.draw = false;
  room.reason = '';
  room.resultReported = false;
  room.board = null;
  room.moveCount = 0;
  room.lastMove = null;
  room.currentTurn = 1;
  room.rematch = { 1: false, 2: false };

  var oldBlack = room.players[1];
  var oldWhite = room.players[2];
  room.players[1] = oldWhite;
  room.players[2] = oldBlack;
  startClock(room);
  return { room: room, started: true };
}

function declineRematch(socketId, code) {
  var room = rooms[code];
  if (!room) return null;
  var color = getPlayerColor(socketId, room);
  if (color) room.rematch[color] = false;
  return { room: room, color: color };
}

function cleanupIdle() {
  var now = Date.now();
  for (var code in rooms) {
    var room = rooms[code];
    var stale = now - room.createdAt > IDLE_TIMEOUT;
    var empty = !room.players[1] && !room.players[2];
    if (stale || empty) delete rooms[code];
  }
}

function listPublicRooms() {
  var list = [];
  for (var code in rooms) {
    var room = rooms[code];
    if (!room.isPublic || room.gameOver) continue;
    list.push({
      code: code,
      creator: room.players[1] ? room.players[1].nickname : '?',
      size: room.boardSize,
      rule: room.rule || 'free',
      players: room.players[2] ? 2 : 1
    });
  }
  return list;
}

function startIdleCleanup() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(cleanupIdle, 60000);
  if (idleTimer.unref) idleTimer.unref();
}

startIdleCleanup();

module.exports = {
  TURN_SECONDS: TURN_SECONDS,
  createRoom: createRoom,
  joinRoom: joinRoom,
  getRoom: getRoom,
  getState: getState,
  getPlayerColor: getPlayerColor,
  getPlayerNickname: getPlayerNickname,
  submitMove: submitMove,
  markDisconnected: markDisconnected,
  rejoinRoom: rejoinRoom,
  checkRejoinTimeouts: checkRejoinTimeouts,
  checkClocks: checkClocks,
  tickClocks: tickClocks,
  remainingSeconds: remainingSeconds,
  removePlayer: removePlayer,
  closeRoom: closeRoom,
  submitRematchVote: submitRematchVote,
  declineRematch: declineRematch,
  listPublicRooms: listPublicRooms
};