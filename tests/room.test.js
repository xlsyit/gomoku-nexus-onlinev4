'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rm = require('../server/room-manager.js');

let seq = 0;

function setup(opts) {
  seq += 1;
  const black = 's-black-' + seq;
  const white = 's-white-' + seq;
  const created = rm.createRoom(black, 'alice', 'tok-black-' + seq, opts || { boardSize: 15, rule: 'free', isPublic: true });
  const joined = rm.joinRoom(created.code, white, 'bob', 'tok-white-' + seq);
  assert.strictEqual(joined.color, 2);
  return { code: created.code, room: joined.room, black, white };
}

function play(moves) {
  for (const m of moves) {
    const res = rm.submitMove(m[0], m[1], m[2], m[3]);
    assert.ok(!res.error, res.error);
  }
}

test('加入房间时以房主配置为准，不因棋盘/规则不一致拒绝', () => {
  seq += 1;
  const created = rm.createRoom('s1-' + seq, 'alice', 't1-' + seq, { boardSize: 19, rule: 'renju', isPublic: false });
  const joined = rm.joinRoom(created.code, 's2-' + seq, 'bob', 't2-' + seq, { boardSize: 9, rule: 'free' });
  assert.ok(!joined.error);
  assert.strictEqual(joined.room.boardSize, 19);
  assert.strictEqual(joined.room.rule, 'renju');
});

test('黑白轮流落子，服务端回报胜负', () => {
  const { code, black, white } = setup({ boardSize: 15, rule: 'free', isPublic: true });

  play([
    [black, code, 7, 3], [white, code, 0, 0],
    [black, code, 7, 4], [white, code, 0, 1],
    [black, code, 7, 5], [white, code, 0, 2],
    [black, code, 7, 6], [white, code, 0, 3]
  ]);

  const win = rm.submitMove(black, code, 7, 7);
  assert.ok(!win.error);
  assert.ok(win.result);
  assert.strictEqual(win.result.winner, 1);
  assert.strictEqual(win.result.reason, 'five');
  assert.strictEqual(win.result.winnerNickname, 'alice');
  assert.strictEqual(win.result.loserNickname, 'bob');

  const after = rm.submitMove(white, code, 1, 1);
  assert.strictEqual(after.error, '本局已结束');
});

test('不是自己的回合会被拒绝', () => {
  const { code, white } = setup();
  const res = rm.submitMove(white, code, 7, 7);
  assert.strictEqual(res.error, '不是你的回合');
});

test('重复落子会被拒绝', () => {
  const { code, black, white } = setup();
  rm.submitMove(black, code, 7, 7);
  const res = rm.submitMove(white, code, 7, 7);
  assert.strictEqual(res.error, '位置已被占据');
});

test('职业禁手由服务端判定为白方胜', () => {
  const { code, black, white } = setup({ boardSize: 15, rule: 'renju', isPublic: true });
  play([
    [black, code, 7, 5], [white, code, 0, 1],
    [black, code, 7, 6], [white, code, 0, 2],
    [black, code, 5, 7], [white, code, 0, 3],
    [black, code, 6, 7], [white, code, 0, 4]
  ]);
  const res = rm.submitMove(black, code, 7, 7);
  assert.ok(res.forbidden);
  assert.strictEqual(res.result.winner, 2);
  assert.strictEqual(res.result.reason, 'forbidden');
  assert.strictEqual(res.result.winnerNickname, 'bob');
});

test('每步超时由服务端判负', () => {
  const { code, room, black } = setup();
  rm.submitMove(black, code, 7, 7);
  assert.strictEqual(room.currentTurn, 2);
  room.turnDeadline = Date.now() - 2000;
  const expired = rm.checkClocks(Date.now());
  const mine = expired.filter(e => e.code === code);
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].loserColor, 2);
  assert.strictEqual(mine[0].result.winner, 1);
  assert.strictEqual(mine[0].result.reason, 'timeout');
  assert.strictEqual(rm.checkClocks(Date.now()).filter(e => e.code === code).length, 0, '只结算一次');
});

test('续盘投票：双方同意后交换黑白并重置棋盘', () => {
  const { code, room, black, white } = setup({ boardSize: 15, rule: 'free', isPublic: true });
  play([
    [black, code, 7, 3], [white, code, 0, 0],
    [black, code, 7, 4], [white, code, 0, 1],
    [black, code, 7, 5], [white, code, 0, 2],
    [black, code, 7, 6], [white, code, 0, 3],
    [black, code, 7, 7]
  ]);
  assert.strictEqual(room.gameOver, true);

  const vote = rm.submitRematchVote(black, code);
  assert.ok(vote.waiting);
  const start = rm.submitRematchVote(white, code);
  assert.ok(start.started);
  assert.strictEqual(room.gameOver, false);
  assert.strictEqual(room.moveCount, 0);
  assert.strictEqual(room.board, null);
  assert.strictEqual(room.currentTurn, 1);
  assert.strictEqual(room.players[1].nickname, 'bob');
  assert.strictEqual(room.players[2].nickname, 'alice');
  assert.ok(room.turnDeadline > Date.now());
});

test('对局中离开判负，等待中离开不算负', () => {
  seq += 1;
  const waiting = rm.createRoom('s-wait-' + seq, 'alice', 't-wait-' + seq, { boardSize: 15, rule: 'free', isPublic: true });
  const leftWaiting = rm.removePlayer('s-wait-' + seq);
  assert.strictEqual(leftWaiting.forfeit, false);
  assert.strictEqual(rm.getRoom(waiting.code), null);

  const { code, black, white } = setup();
  rm.submitMove(black, code, 7, 7);
  const res = rm.removePlayer(white);
  assert.strictEqual(res.forfeit, true);
  assert.strictEqual(res.result.winner, 1);
  assert.strictEqual(res.result.reason, 'leave');
});

test('房间列表只返回公开且未结束的房间', () => {
  const { code, room } = setup({ boardSize: 15, rule: 'free', isPublic: true });
  assert.ok(rm.listPublicRooms().some(r => r.code === code));
  room.gameOver = true;
  assert.ok(!rm.listPublicRooms().some(r => r.code === code));
});