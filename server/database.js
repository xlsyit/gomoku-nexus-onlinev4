'use strict';

var crypto = require('crypto');
var path = require('path');

var Database;
try {
  Database = require('node:sqlite').DatabaseSync;
} catch (e) {
  // 旧版本 Node 的回退方案（需自行安装 better-sqlite3）
  Database = require('better-sqlite3');
}

var dbPath = process.env.GOMOKU_DB || path.join(__dirname, 'gomoku.db');
var db = new Database(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec([
  'CREATE TABLE IF NOT EXISTS users (',
  '  nickname TEXT PRIMARY KEY,',
  '  password_hash TEXT NOT NULL,',
  '  salt TEXT NOT NULL,',
  '  wins    INTEGER NOT NULL DEFAULT 0,',
  '  losses  INTEGER NOT NULL DEFAULT 0,',
  '  draws   INTEGER NOT NULL DEFAULT 0,',
  '  rating  INTEGER NOT NULL DEFAULT 1000,',
  '  last_active TEXT NOT NULL DEFAULT (datetime(\'now\'))',
  ')'
].join('\n'));

// 轻量迁移：老库补列
(function migrate() {
  var cols = db.prepare('PRAGMA table_info(users)').all().map(function (c) { return c.name; });
  [
    ['games', 'INTEGER NOT NULL DEFAULT 0'],
    ['current_streak', 'INTEGER NOT NULL DEFAULT 0'],
    ['best_streak', 'INTEGER NOT NULL DEFAULT 0']
  ].forEach(function (item) {
    if (cols.indexOf(item[0]) < 0) {
      db.exec('ALTER TABLE users ADD COLUMN ' + item[0] + ' ' + item[1]);
    }
  });
  db.exec('UPDATE users SET games = wins + losses + draws WHERE games = 0 AND (wins + losses + draws) > 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC)');
})();

var TIERS = [
  { min: 2100, name: '王者', key: 'king' },
  { min: 1900, name: '大师', key: 'master' },
  { min: 1700, name: '钻石', key: 'diamond' },
  { min: 1500, name: '铂金', key: 'platinum' },
  { min: 1300, name: '黄金', key: 'gold' },
  { min: 1100, name: '白银', key: 'silver' },
  { min: 0, name: '青铜', key: 'bronze' }
];

function tierFor(rating) {
  for (var i = 0; i < TIERS.length; i++) {
    if (rating >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[TIERS.length - 1];
}

var stmtGetUser = db.prepare('SELECT * FROM users WHERE nickname = ? COLLATE NOCASE');
var stmtInsertUser = db.prepare([
  'INSERT INTO users (nickname, password_hash, salt, wins, losses, draws, rating, games, last_active)',
  'VALUES (?, ?, ?, 0, 0, 0, 1000, 0, datetime(\'now\'))'
].join('\n'));
var stmtTouch = db.prepare('UPDATE users SET last_active = datetime(\'now\') WHERE nickname = ? COLLATE NOCASE');
var stmtApplyResult = db.prepare([
  'UPDATE users SET',
  '  wins = wins + ?,',
  '  losses = losses + ?,',
  '  draws = draws + ?,',
  '  games = games + 1,',
  '  rating = MAX(100, rating + ?),',
  '  current_streak = ?,',
  '  best_streak = MAX(best_streak, ?),',
  '  last_active = datetime(\'now\')',
  'WHERE nickname = ? COLLATE NOCASE'
].join('\n'));
var stmtLeaderboard = db.prepare([
  'SELECT nickname, wins, losses, draws, games, rating, current_streak, best_streak',
  'FROM users',
  'ORDER BY rating DESC, wins DESC, games ASC',
  'LIMIT ?'
].join('\n'));

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function safeEqual(a, b) {
  var ba = Buffer.from(a, 'hex');
  var bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/* node:sqlite 没有 better-sqlite3 的 db.transaction()，手写事务。 */
function transact(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* ignore */ }
    throw e;
  }
}

function publicUser(row) {
  if (!row) return null;
  var games = row.games || (row.wins + row.losses + row.draws);
  var tier = tierFor(row.rating);
  return {
    nickname: row.nickname,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    games: games,
    rating: row.rating,
    winrate: games > 0 ? Math.round((row.wins / games) * 100) : 0,
    streak: row.current_streak || 0,
    bestStreak: row.best_streak || 0,
    tier: tier.name,
    tierKey: tier.key,
    last_active: row.last_active
  };
}

function registerUser(nickname, password) {
  var nick = String(nickname || '').trim().slice(0, 12);
  var pass = String(password || '');
  if (!nick || pass.length < 4) {
    return { ok: false, error: '昵称不能为空，密码至少 4 位' };
  }
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(nick)) {
    return { ok: false, error: '昵称只能包含中文、字母、数字、下划线或短横线' };
  }
  if (stmtGetUser.get(nick)) {
    return { ok: false, error: '昵称已存在，请直接登录' };
  }
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = hashPassword(pass, salt);
  stmtInsertUser.run(nick, hash, salt);
  return { ok: true, token: crypto.randomBytes(24).toString('hex'), data: publicUser(stmtGetUser.get(nick)) };
}

function loginUser(nickname, password) {
  var nick = String(nickname || '').trim().slice(0, 12);
  var pass = String(password || '');
  var row = stmtGetUser.get(nick);
  if (!row || !safeEqual(row.password_hash, hashPassword(pass, row.salt))) {
    return { ok: false, error: '昵称或密码错误' };
  }
  stmtTouch.run(nick);
  return { ok: true, token: crypto.randomBytes(24).toString('hex'), data: publicUser(row) };
}

/* winner / loser 都是昵称；由服务端根据棋盘结果调用。 */
function updateResult(winner, loser) {
  if (!winner || !loser) return null;
  var w = stmtGetUser.get(winner);
  var l = stmtGetUser.get(loser);
  if (!w || !l) return null;

  var ew = expectedScore(w.rating, l.rating);
  var delta = Math.max(1, Math.round(24 * (1 - ew)));
  var apply = function () {
    stmtApplyResult.run(1, 0, 0, delta, (w.current_streak || 0) + 1, (w.current_streak || 0) + 1, winner);
    stmtApplyResult.run(0, 1, 0, -delta, 0, 0, loser);
  };
  transact(apply);
  return { delta: delta };
}

function updateDraw(nick1, nick2) {
  if (!nick1) return null;
  var p1 = stmtGetUser.get(nick1);
  if (!p1) return null;
  var delta1 = 0;
  if (nick2 && nick2 !== nick1) {
    var p2 = stmtGetUser.get(nick2);
    if (p2) {
      var e = expectedScore(p1.rating, p2.rating);
      delta1 = Math.round(24 * (0.5 - e));
      var delta2 = -delta1;
      var apply = function () {
        stmtApplyResult.run(0, 0, 1, delta1, 0, 0, nick1);
        stmtApplyResult.run(0, 0, 1, delta2, 0, 0, nick2);
      };
      transact(apply);
      return { delta: delta1 };
    }
  }
  stmtApplyResult.run(0, 0, 1, 0, 0, 0, nick1);
  return { delta: 0 };
}

function getLeaderboard(limit) {
  var max = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  return stmtLeaderboard.all(max).map(publicUser);
}

function getPlayer(nickname) {
  return publicUser(stmtGetUser.get(String(nickname || '').trim()));
}

module.exports = {
  TIERS: TIERS,
  tierFor: tierFor,
  registerUser: registerUser,
  loginUser: loginUser,
  updateResult: updateResult,
  updateDraw: updateDraw,
  getLeaderboard: getLeaderboard,
  getPlayer: getPlayer,
  close: function () {
    try { db.close(); } catch (e) { /* ignore */ }
  }
};