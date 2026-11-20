/*
 * 星穹连珠 · 规则内核
 * ---------------------------------------------------------------
 * 浏览器与 Node 共用的唯一规则实现（UMD）。
 * 客户端（game.js / ai-core.js）与服务端（server/room-manager.js）
 * 都只能通过这里判断：落子是否合法、是否成五、是否禁手、是否和棋。
 *
 * 约定：
 *   - 棋盘为二维数组，0 空，1 黑，2 白。
 *   - rule: 'free' 自由 / 'renju' 职业禁手 / 'folk' 民间禁手。
 *   - 禁手只约束黑方（1）。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Rules = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  /* 6 格窗口内的活三掩码（与 ai-core 的约定一致）。
     14 = __XXX_   22 = _X_XX_   26 = _XX_X_   28 = _XXX__ */
  var LIVE3_MASKS = [14, 22, 26, 28];

  function inB(size, r, c) {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  function makeBoard(size) {
    var board = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(0);
      board.push(row);
    }
    return board;
  }

  function cloneBoard(board) {
    var out = [];
    for (var r = 0; r < board.length; r++) out.push(board[r].slice());
    return out;
  }

  function isFull(board, size) {
    var n = size || board.length;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (board[r][c] === 0) return false;
      }
    }
    return true;
  }

  function countStones(board) {
    var n = 0;
    for (var r = 0; r < board.length; r++) {
      for (var c = 0; c < board[r].length; c++) {
        if (board[r][c] !== 0) n++;
      }
    }
    return n;
  }

  /* 以 (r,c) 为中心，沿 (dr,dc) 取出半径 radius 的线段。
     棋盘外记为 -1（等价于“被堵住”）。 */
  function lineThrough(board, size, r, c, dr, dc, radius) {
    var rad = radius == null ? 5 : radius;
    var line = [];
    for (var k = -rad; k <= rad; k++) {
      var rr = r + dr * k;
      var cc = c + dc * k;
      line.push(inB(size, rr, cc) ? board[rr][cc] : -1);
    }
    return line;
  }

  /* 线段上经过 idx 的连续同色长度。 */
  function runAt(line, idx, color) {
    var a = idx;
    while (a - 1 >= 0 && line[a - 1] === color) a--;
    var b = idx;
    while (b + 1 < line.length && line[b + 1] === color) b++;
    return { start: a, end: b, len: b - a + 1 };
  }

  /* 返回落子后经过 (r,c) 的最长五连信息；长连时 overline 为 true。 */
  function winLine(board, size, r, c, color) {
    var n = size || board.length;
    for (var d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var len = 1;
      var rr;
      var cc;
      for (rr = r + dr, cc = c + dc; inB(n, rr, cc) && board[rr][cc] === color; rr += dr, cc += dc) len++;
      for (rr = r - dr, cc = c - dc; inB(n, rr, cc) && board[rr][cc] === color; rr -= dr, cc -= dc) len++;
      if (len >= 5) {
        var r1 = r;
        var c1 = c;
        var r2 = r;
        var c2 = c;
        while (inB(n, r1 - dr, c1 - dc) && board[r1 - dr][c1 - dc] === color) { r1 -= dr; c1 -= dc; }
        while (inB(n, r2 + dr, c2 + dc) && board[r2 + dr][c2 + dc] === color) { r2 += dr; c2 += dc; }
        return { r1: r1, c1: c1, r2: r2, c2: c2, len: len, dir: d, overline: len > 5 };
      }
    }
    return null;
  }

  /* 是否存在“再下一子即成五”的形状（冲四/活四）。窗口必须覆盖 idx。 */
  function hasFour(line, idx) {
    for (var s = Math.max(0, idx - 5); s <= idx; s++) {
      if (s + 6 > line.length) break;
      var own = 0;
      var blocked = false;
      for (var k = 0; k < 6; k++) {
        var v = line[s + k];
        if (v === 1) own++;
        else if (v !== 0) { blocked = true; break; }
      }
      if (!blocked && own === 4) return true;
    }
    return false;
  }

  /* 是否形成活三（可一手变活四）。窗口必须覆盖 idx。 */
  function hasLive3(line, idx) {
    for (var s = Math.max(0, idx - 5); s <= idx; s++) {
      if (s + 6 > line.length) break;
      var mask = 0;
      var own = 0;
      var blocked = false;
      for (var k = 0; k < 6; k++) {
        var v = line[s + k];
        if (v === 1) {
          own++;
          mask |= (1 << (5 - k));
        } else if (v !== 0) {
          blocked = true;
          break;
        }
      }
      if (blocked || own !== 3) continue;
      if (LIVE3_MASKS.indexOf(mask) >= 0) return true;
    }
    return false;
  }

  /* 判断黑方在 (r,c) 落子是否构成禁手。
     关键规则：成五优先于禁手 —— 只要该手形成恰好五连，就不算禁手。 */
  function isForbidden(board, size, r, c, rule) {
    if (!rule || rule === 'free') return false;
    if (board[r][c] !== 0) return false;
    var n = size || board.length;
    board[r][c] = 1;

    var five = false;
    var overline = false;
    var fours = 0;
    var live3s = 0;

    for (var d = 0; d < DIRS.length; d++) {
      var line = lineThrough(board, n, r, c, DIRS[d][0], DIRS[d][1], 5);
      var idx = 5;
      var run = runAt(line, idx, 1);
      if (run.len === 5) {
        five = true;
      } else if (run.len >= 6) {
        overline = true;
      } else {
        if (hasFour(line, idx)) fours++;
        else if (hasLive3(line, idx)) live3s++;
      }
    }

    board[r][c] = 0;

    if (five) return false;          // 成五直接获胜，不再讨论禁手
    if (overline) return true;       // 长连在职业/民间禁手中都禁止
    if (rule === 'folk') return false;
    return fours >= 2 || live3s >= 2;
  }

  /* 只校验、不落子。 */
  function canPlace(board, size, rule, r, c, color) {
    var n = size || board.length;
    if (!inB(n, r, c)) return { ok: false, error: '坐标越界' };
    if (board[r][c] !== 0) return { ok: false, error: '位置已被占据' };
    if (rule && rule !== 'free' && color === 1 && isForbidden(board, n, r, c, rule)) {
      return { ok: false, error: '黑方禁手', forbidden: true };
    }
    return { ok: true };
  }

  /* 落子并给出权威结果。会修改 board。
     返回 { ok, forbidden, win, winner, draw, winLine } */
  function judge(board, size, rule, r, c, color) {
    var n = size || board.length;
    if (!inB(n, r, c)) return { ok: false, error: '坐标越界' };
    if (board[r][c] !== 0) return { ok: false, error: '位置已被占据' };

    if (rule && rule !== 'free' && color === 1 && isForbidden(board, n, r, c, rule)) {
      return { ok: false, forbidden: true, win: false, winner: 2, draw: false, winLine: null };
    }

    board[r][c] = color;
    var wl = winLine(board, n, r, c, color);
    var draw = !wl && isFull(board, n);
    return {
      ok: true,
      forbidden: false,
      win: !!wl,
      winner: wl ? color : 0,
      draw: draw,
      winLine: wl
    };
  }

  function ruleLabel(rule) {
    if (rule === 'renju') return '职业禁手';
    if (rule === 'folk') return '民间禁手';
    return '自由';
  }

  return {
    DIRS: DIRS,
    LIVE3_MASKS: LIVE3_MASKS,
    inB: inB,
    makeBoard: makeBoard,
    cloneBoard: cloneBoard,
    isFull: isFull,
    countStones: countStones,
    lineThrough: lineThrough,
    runAt: runAt,
    winLine: winLine,
    isForbidden: isForbidden,
    canPlace: canPlace,
    judge: judge,
    ruleLabel: ruleLabel
  };
});