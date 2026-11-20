(function () {
  'use strict';

  window.GC.applyUiTheme();

  window.Cover.init({
    start: function (settings) {
      window.Gomoku.startGame(settings);
    }
  });
  window.Gomoku.init({});

  // 刷新后恢复在线对局：有保存的房间会话就直接重连（Network 会自动 rejoinRoom）
  var session = window.Network && window.Network.getSession ? window.Network.getSession() : null;
  if (session && session.code && session.token && !window.Network.isConnected()) {
    window.Network.connect();
  }
})();