# 星穹连珠 · Gomoku Nexus Online v4.2

炫酷特效五子棋 + 实时在线对战。保留本地人机/双人玩法，并提供账号、房间、排行榜、断线重连、职业禁手与自定义棋盘。

A stylish browser Gomoku with local AI and real-time online play: accounts, rooms, Elo leaderboard, reconnect, renju rules, custom board sizes.

## 快速开始 / Quick Start

环境要求：Node.js **22+**（使用内置 `node:sqlite`）。

```bash
npm install --prefix server
node server/index.js
```

打开 <http://localhost:3000>。

- 根目录 `npm test` 运行规则与房间状态机测试（无需先启动服务器）。
- 仅玩本地模式时，也可以直接双击 `index.html`（在线功能需要服务器）。

## 玩法 / Gameplay

### 本地对战

- 点击棋盘交叉点落子，五连获胜；满盘无五连判和棋。
- 封面可选 **玩家对战** / **人机对战**。
- 人机四档：**简单 / 普通 / 困难 / 大师**，可选先后手。
- 对局中：**悔棋**、**提示**、**空格**切换场景、**R** 重开、**Esc** 返回菜单。
- 键盘落子：方向键移动光标，**Enter** 落子。
- 棋盘 **9 / 13 / 15 / 19** 路（切换后下一局生效，无需刷新）。
- 规则：**自由 / 职业禁手 / 民间禁手**，本地、AI、在线共用同一套判定。
- UI 主题：星云 / 纸墨 / 终端。

### 在线对战

1. 封面点 **在线对战**，大厅在主页内打开（不再跳转 `online.html`）。
2. 输入昵称、密码，**注册** 或 **登录**。
3. 创建 **公开房间**（大厅可见）或 **私密房间**（凭 6 位房间码）。
4. 双方就绪后立即开局，创建者执黑；**每步 30 秒**，超时判负。
5. 落子先本地显示，结果由服务端裁决；被拒绝会自动回滚。
6. 结束可 **请求再战**，双方同意后交换黑白重开。
7. 掉线 60 秒内重连可恢复棋盘；刷新页面会自动续局（同一标签页）。

### 排行榜

- Elo 积分（K=24，下限 100），段位：青铜 → 白银 → 黄金 → 铂金 → 钻石 → 大师 → 王者。
- 显示胜率、场次、连胜、最高连胜，并高亮自己。
- **本机战绩** 单独统计人机对局的胜负、胜率、最高连击、最快取胜。

## v4.2 主要变更 / What's new

### 正确性与安全

- **规则内核统一**：`js/rules.js` 由前端、AI Worker、服务端共用，消灭三套实现。
- 修正 **“成五优先于禁手”**：黑方同时形成五连与另一方向冲四时判胜，不再误判禁手。
- 新增 **和棋**（满盘）、**每步 30 秒计时**、**超时/离场/掉线判负**。
- **服务端权威**：胜负、禁手、和棋、超时都由服务端棋盘状态判定；客户端只展示，不再上报胜负。
- **静态目录白名单**：`server/gomoku.db`、`server/*.js`、`package.json` 等一律 404。
- 登录 **限流**、会话 **12 小时过期**、`/api/logout`、安全响应头（CSP、nosniff、frame 等）。
- **socket.io 客户端本地化**（`js/vendor/`），CDN 不可用也不影响本地模式。
- 防跨标签顶号：同一座位被另一个窗口占用时拒绝重连；同标签刷新放行。

### 体验与界面

- 在线大厅合并进主页，**单页开局**，不再 `online.html → index.html?room=` 两次重载导致假掉线。
- 设置 / 排行榜 / 在线大厅 / 结算改为原生 `<dialog>`：焦点管理、Esc、背景 inert。
- 完整的 `<label>`、`autocomplete`、`aria-live`、键盘焦点环、触屏 44px 点击区。
- 排行榜语义化表格；窄屏自动堆叠为卡片。
- 音效与音乐分轨、独立音量、静音持久化、页面隐藏暂停；“你的回合”、落子、非法、加入/离开、再战、倒计时提示音。
- 特效强度三档（完整/精简/关闭），尊重 `prefers-reduced-motion`；棋子与棋盘几何缓存，减少每帧开销。
- 人机新增 **大师** 难度、双威胁（四三/双四）检测；Worker 超时改为轻量兜底，不再阻塞主线程。

### 数据库

- Elo 积分、段位、连胜、最高连胜、胜率、场次。
- 昵称 `COLLATE NOCASE`，`rating` 索引，排行榜 10 秒缓存，最多 100 条。
- 老库自动迁移补列，无需手动改表。

## 技术架构 / Architecture

```text
浏览器
  ├── Canvas 2D + WebAudio + Web Worker（AI）
  └── Socket.IO 客户端（js/vendor/）
        │
Node.js :3000
  ├── Express：静态白名单 + 注册/登录/排行榜 API
  ├── Socket.IO：房间、落子、计时、重连、再战
  ├── js/rules.js：与前端共用的规则内核
  └── SQLite（node:sqlite）：账号与排行榜
```

### 目录结构

```text
gomoku-nexus-onlinev4/
├── index.html                游戏主页（封面、HUD、全部弹窗）
├── online.html               旧在线入口，仅自动跳回 index.html
├── styles.css                设计 token + 组件 + 三套 UI 主题
├── package.json              根脚本：start / dev / test
├── tests/
│   ├── rules.test.js         规则边界（成五优先、双三、长连、和棋）
│   └── room.test.js          房间状态机（判胜、禁手、超时、再战、离开）
├── js/
│   ├── rules.js              唯一规则内核（浏览器 + Node）
│   ├── config.js             设置、主题、音量、特效、本机战绩
│   ├── network.js            Socket.IO 客户端、会话、自动重连
│   ├── game.js               对局、渲染、输入、在线同步、悔棋/提示
│   ├── cover.js              封面、账号、大厅、设置、排行榜
│   ├── ai-core.js            AI 引擎（搜索、双威胁、禁手）
│   ├── ai-worker.js          Worker 入口（导入规则 + 引擎）
│   ├── ai.js                 异步调度与超时兜底
│   ├── audio.js              程序化音效 + 环境音乐
│   ├── effects.js            视觉特效与强度分级
│   ├── particles.js          粒子系统
│   ├── themes.js             10 套程序生成主题
│   ├── main.js               启动入口
│   └── vendor/socket.io.min.js
├── server/
│   ├── index.js              HTTP + Socket.IO + 静态白名单
│   ├── room-manager.js       房间状态机（服务端权威）
│   ├── database.js           SQLite、scrypt、Elo
│   └── package.json
└── preview/                  截图
```

## 测试 / Tests

```bash
npm test
```

覆盖：成五优先于禁手、双活三、长连、白方长连获胜、单活四不误判、满盘和棋；房间加入、轮流落子、禁手判负、超时判负、再战换边、离开判负、房间列表。

在线端到端联调（可选，需要 `socket.io-client`）：

```bash
cd server && npm install --no-save socket.io-client
# 启动临时服务器后，用两个客户端跑 注册→建房→加入→九手→判胜→重连→禁手→排行榜
```

## 部署 / Deploy

- 在线模式必须运行 `server/`（Node 22+），推荐 PM2 + Nginx，并转发 WebSocket Upgrade。
- 仅静态托管（GitHub Pages / Netlify / Cloudflare Pages）时，只能玩本地模式。
- 生产建议通过环境变量设置 `PORT`、`GOMOKU_DB`（数据库路径）、`CORS_ORIGIN`（如需跨域）。

## 已知限制 / Known limits

- 同一浏览器多个标签共享 `localStorage`，不能当作两个在线玩家；请用两个浏览器或无痕窗口。
- 前端资源带 `?v=4.2` 版本号。更新前端后需同步修改 `index.html`、`js/ai.js`、`js/ai-worker.js` 中的版本号，避免旧缓存。
- 服务端已实现聊天事件，但前端暂未提供聊天 UI。
- 房间与登录会话保存在内存，服务重启后需重新登录；棋谱不做持久化。

## 许可 / License

[MIT](LICENSE)