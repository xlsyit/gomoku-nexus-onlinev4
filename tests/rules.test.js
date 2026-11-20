'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Rules = require('../js/rules.js');

function board(size) {
  return Rules.makeBoard(size || 15);
}

test('成五优先于禁手：黑方同时形成五连与另一方向冲四时仍然获胜', () => {
  const b = board(15);
  // 横向四子
  b[7][3] = 1; b[7][4] = 1; b[7][5] = 1; b[7][6] = 1;
  // 纵向三子，落子后成为冲四
  b[4][7] = 1; b[5][7] = 1; b[6][7] = 1;

  assert.strictEqual(Rules.isForbidden(b, 15, 7, 7, 'renju'), false);

  const res = Rules.judge(b, 15, 'renju', 7, 7, 1);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.win, true);
  assert.strictEqual(res.winner, 1);
  assert.strictEqual(res.forbidden, false);
  assert.ok(res.winLine);
  assert.strictEqual(res.winLine.len, 5);
});

test('职业禁手：双活三判负', () => {
  const b = board(15);
  b[7][5] = 1; b[7][6] = 1;      // 横向两子
  b[5][7] = 1; b[6][7] = 1;      // 纵向两子

  assert.strictEqual(Rules.isForbidden(b, 15, 7, 7, 'renju'), true);
  assert.strictEqual(Rules.isForbidden(b, 15, 7, 7, 'folk'), false);

  const res = Rules.judge(b, 15, 'renju', 7, 7, 1);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.forbidden, true);
  assert.strictEqual(res.winner, 2);
});

test('长连：黑方六连在职业/民间规则下都是禁手，自由规则下是胜利', () => {
  const b = board(15);
  b[7][2] = 1; b[7][3] = 1; b[7][4] = 1; b[7][5] = 1; b[7][7] = 1;

  assert.strictEqual(Rules.isForbidden(b, 15, 7, 6, 'renju'), true);
  assert.strictEqual(Rules.isForbidden(b, 15, 7, 6, 'folk'), true);
  assert.strictEqual(Rules.isForbidden(b, 15, 7, 6, 'free'), false);

  const res = Rules.judge(b, 15, 'free', 7, 6, 1);
  assert.strictEqual(res.win, true);
  assert.strictEqual(res.winLine.overline, true);
});

test('白方长连算胜（白方无禁手）', () => {
  const b = board(15);
  b[7][2] = 2; b[7][3] = 2; b[7][4] = 2; b[7][5] = 2; b[7][6] = 2;

  const res = Rules.judge(b, 15, 'renju', 7, 7, 2);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.win, true);
  assert.strictEqual(res.winner, 2);
  assert.strictEqual(res.winLine.overline, true);
});

test('单个活四不构成双四禁手', () => {
  const b = board(15);
  b[7][3] = 1; b[7][4] = 1; b[7][5] = 1; b[7][6] = 1;

  assert.strictEqual(Rules.isForbidden(b, 15, 7, 7, 'renju'), false);
  assert.strictEqual(Rules.isForbidden(b, 15, 7, 2, 'renju'), false);
});

test('普通落子不受规则限制', () => {
  const b = board(15);
  assert.strictEqual(Rules.isForbidden(b, 15, 7, 7, 'renju'), false);
  const res = Rules.judge(b, 15, 'renju', 7, 7, 1);
  assert.strictEqual(res.win, false);
  assert.strictEqual(res.draw, false);
  assert.strictEqual(b[7][7], 1);
});

test('非法落子被拒绝且不改变棋盘', () => {
  const b = board(15);
  b[3][3] = 1;
  const res = Rules.judge(b, 15, 'free', 3, 3, 2);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(b[3][3], 1);

  const out = Rules.judge(b, 15, 'free', -1, 3, 2);
  assert.strictEqual(out.ok, false);
});

test('满盘无五连判和棋', () => {
  const b = board(3);
  let color = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 1) continue;
      b[r][c] = color;
      color = 3 - color;
    }
  }
  const res = Rules.judge(b, 3, 'free', 1, 1, 1);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.win, false);
  assert.strictEqual(res.draw, true);
  assert.strictEqual(res.winner, 0);
});

test('isFull 只在整个棋盘没有空位时返回 true', () => {
  const b = board(9);
  assert.strictEqual(Rules.isFull(b, 9), false);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) b[r][c] = (r + c) % 2 ? 2 : 1;
  }
  assert.strictEqual(Rules.isFull(b, 9), true);
});

test('禁手判定不会破坏棋盘', () => {
  const b = board(15);
  b[7][5] = 1; b[7][6] = 1;
  b[5][7] = 1; b[6][7] = 1;
  const before = JSON.stringify(b);
  Rules.isForbidden(b, 15, 7, 7, 'renju');
  assert.strictEqual(JSON.stringify(b), before);
});