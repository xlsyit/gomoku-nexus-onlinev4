(function () {
  'use strict';

  var core = window.AI;
  var worker = null;
  var workerBroken = false;
  var seq = 0;
  var pending = {};

  function currentRule(rule) {
    if (rule !== undefined) return rule;
    if (window.GC && window.GC.settings) return window.GC.settings.rule || 'free';
    return 'free';
  }

  function engine() {
    var size = window.GC ? window.GC.SIZE : 15;
    return core.getEngine(size);
  }

  function chooseMove(board, ai, difficulty, rule) {
    return engine().chooseMove(board, ai, difficulty, currentRule(rule));
  }

  /* 轻量兜底：绝不阻塞主线程做全量搜索。 */
  function chooseMoveQuick(board, ai, rule) {
    return engine().chooseMoveQuick(board, ai, currentRule(rule));
  }

  function resolveAll(pick) {
    Object.keys(pending).forEach(function (id) {
      var item = pending[id];
      if (!item) return;
      if (item.timer) clearTimeout(item.timer);
      try { item.resolve(pick(item)); } catch (e) { item.resolve(null); }
    });
    pending = {};
  }

  function createWorker() {
    try {
      worker = new Worker('js/ai-worker.js?v=4.2');
      worker.onmessage = function (e) {
        var d = e.data || {};
        var item = pending[d.id];
        if (!item) return;
        delete pending[d.id];
        if (item.timer) clearTimeout(item.timer);
        item.resolve(d.move || null);
      };
      worker.onerror = function () {
        workerBroken = true;
        worker = null;
        resolveAll(function (item) {
          return engine().chooseMoveQuick(item.board, item.ai, item.rule);
        });
      };
    } catch (e) {
      worker = null;
      workerBroken = true;
    }
  }

  function chooseMoveAsync(board, ai, difficulty, rule) {
    var size = window.GC ? window.GC.SIZE : 15;
    var ruleOn = currentRule(rule);
    var diff = difficulty || 'normal';
    return new Promise(function (resolve) {
      if (workerBroken || typeof Worker === 'undefined' || window.location.protocol === 'file:') {
        setTimeout(function () {
          resolve(engine().chooseMoveQuick(board, ai, ruleOn));
        }, 0);
        return;
      }
      if (!worker) createWorker();
      if (!worker) {
        setTimeout(function () { resolve(engine().chooseMoveQuick(board, ai, ruleOn)); }, 0);
        return;
      }
      var id = ++seq;
      var copy = [];
      for (var r = 0; r < board.length; r++) copy.push(board[r].slice());
      pending[id] = {
        resolve: resolve,
        board: copy,
        ai: ai,
        rule: ruleOn,
        timer: setTimeout(function () {
          var item = pending[id];
          if (!item) return;
          delete pending[id];
          // 超时只走快速启发式，避免主线程长时间卡死
          item.resolve(engine().chooseMoveQuick(item.board, item.ai, item.rule));
        }, 3200)
      };
      worker.postMessage({
        id: id,
        board: copy,
        ai: ai,
        difficulty: diff,
        rule: ruleOn,
        size: size
      });
    });
  }

  window.AI = {
    chooseMove: chooseMove,
    chooseMoveQuick: chooseMoveQuick,
    chooseMoveAsync: chooseMoveAsync,
    getEngine: core.getEngine,
    create: core.create,
    hasWinScore: function (board, p) {
      return engine().hasWinScore(board, p);
    },
    evalCell: function (board, r, c, p) {
      return engine().evalCell(board, r, c, p);
    },
    isForbiddenAfter: function (board, r, c, p, rule) {
      return engine().isForbiddenAfter(board, r, c, p, currentRule(rule));
    },
    SC: core.SC
  };
})();