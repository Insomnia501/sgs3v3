# 三国杀 3v3 — 项目开发文档

> 最后更新：2026-03-06

## 一、项目概览

本项目是一个 **三国杀统率三军 3v3** 网页版实现，支持两名玩家实时对战。

- **技术栈**：TypeScript + Node.js + Socket.IO（后端） / React + Vite + Zustand（前端）
- **Monorepo 结构**：`client/` `server/` `shared/` 三个 workspace
- **启动命令**：根目录 `npm run dev`（concurrently 启动前后端）
  - 前端：`http://localhost:5174/`
  - 后端：`http://localhost:3001`

---

## 二、目录结构

```
sgs3v3/
├── package.json              # Monorepo 根配置（workspaces: client, server, shared）
├── shared/                   # 共享类型定义包 (sgs3v3-shared)
│   └── src/index.ts          # 所有共享 interface、enum、类型（~538行）
├── server/                   # 后端服务
│   └── src/
│       ├── index.ts           # Express + Socket.IO 服务入口
│       ├── core/              # 核心游戏逻辑
│       │   ├── cards.ts       # 108张卡牌定义 + 牌堆工厂 createDeck()
│       │   ├── generals.ts    # 32个武将定义 + getGeneralPool/getGeneralById
│       │   ├── game-state.ts  # 状态管理（createGeneralInstance, toClientView, addLog, 距离计算等）
│       │   ├── game-actions.ts # 核心动作逻辑（使用卡牌/技能/响应/伤害 ~3600行）
│       │   └── turn-manager.ts # 回合管理（大回合/行动单元/武将回合/判定/弃牌 ~980行）
│       ├── rooms/
│       │   └── room-manager.ts # 房间管理（创建/加入/选将/部署/摸牌）
│       └── socket/
│           └── handlers.ts    # Socket.IO 事件注册 + broadcastGameState
└── client/                   # 前端 React 应用
    └── src/
        ├── App.tsx            # 路由（Lobby → Pick → Game → GameOver）
        ├── main.tsx           # React 入口
        ├── index.css          # 全局样式
        ├── socket/client.ts   # Socket.IO 客户端连接 + 事件监听/emit
        ├── store/gameStore.ts # Zustand 全局状态（playerId, gameState, selectedCards等）
        ├── data/generals.ts   # 前端武将头像/名称数据
        └── pages/
            ├── LobbyPage.tsx       # 创建/加入房间
            ├── GeneralPickPage.tsx  # 选将 + 部署
            ├── GamePage.tsx         # 核心对战页面（~1146行，包含所有交互UI）
            └── GameOverPage.tsx     # 游戏结束
```

---

## 三、共享类型（shared/src/index.ts）

### 3.1 核心枚举

| 枚举 | 说明 |
|------|------|
| `Faction` | WARM / COOL — 暖色/冷色阵营 |
| `SeatRole` | COMMANDER / FLANK_A / FLANK_B — 主帅/前锋A/前锋B |
| `GamePhase` | LOBBY → GENERAL_PICK → DEPLOY → PLAYING → GAME_OVER |
| `TurnPhase` | PREPARE → JUDGE → DRAW → ACTION → DISCARD |
| `CardSuit` | SPADE / HEART / CLUB / DIAMOND |
| `CardCategory` | BASIC / TRICK / EQUIPMENT |
| `BasicCardName` | ATTACK / DODGE / PEACH |
| `TrickCardName` | DRAW_TWO / DISMANTLE / STEAL / DUEL / BARBARIANS / ARROWS / NEGATE / PEACH_GARDEN / HARVEST / BORROW_SWORD / OVERINDULGENCE / SUPPLY_SHORTAGE |
| `EquipmentCardName` | CROSSBOW / DOUBLE_SWORDS / QINGGANG_SWORD / ICE_SWORD / ZHANGBA_SPEAR / GREEN_DRAGON / STONE_AXE / FANGTIAN_HALBERD / KYLIN_BOW / EIGHT_TRIGRAMS / NIOH_SHIELD / PLUS_HORSE / MINUS_HORSE |
| `TrickType` | INSTANT / DELAYED |
| `EquipSlot` | WEAPON / ARMOR / PLUS_HORSE / MINUS_HORSE |
| `SkillType` | ACTIVE / PASSIVE / LOCKED / LIMITED / AWAKENED |
| `ResponseType` | 约40种响应类型（见下方核心机制） |
| `ActionUnitType` | COMMANDER / FLANKS — 行动单元（主帅/前锋） |

### 3.2 核心数据结构

| 类型 | 重要字段 |
|------|---------|
| `Card` | id, suit, value, category, name, equipSlot?, trickType?, attackRange? |
| `GeneralDefinition` | id, name, maxHp, gender, kingdom, skills: SkillDefinition[] |
| `GeneralInstance` | generalId, playerId, faction, seatRole, hp, maxHp, hand: Card[], equip: EquipZone, judgeZone: Card[], alive, hasActed, skillsUsedThisTurn, acquiredSkills, loyaltyCard... |
| `GameState` | roomId, phase, players, generals[], deck[], discard[], turnPhase, activeGeneralIndex, pendingResponseQueue: PendingResponse[], negateWindow?, roundState, harvestPool?, log[] |
| `PendingResponse` | type: ResponseType, targetGeneralIndex, context?, validCardIds? |
| `GameStateClientView` | 脱敏版 GameState（对手手牌不可见，只有 handCount） |

---

## 四、服务端核心模块

### 4.1 room-manager.ts（房间管理）

**职责**：房间生命周期（创建/加入/选将/部署/摸牌）

| 函数 | 说明 |
|------|------|
| `createRoom(socketId, nickname)` | 创建房间，分配暖色方 |
| `joinRoom(socketId, roomCode, nickname)` | 加入房间，分配冷色方 |
| `startPickPhase(room)` | 开始选将（随机8个武将池） |
| `pickGeneral(room, playerId, generalId)` | 按 PICK_SEQUENCE 轮流选将 |
| `deployGenerals(room, playerId, ...)` | 部署3个武将到主帅+前锋位，按标准座次排列 |
| `drawCards(state, count)` | 从牌堆摸牌（牌堆空时洗入弃牌堆） |
| `sortGeneralsBySeat(generals)` | 6个武将按 3v3 座次排列：冷前A(0)→冷主(1)→冷前B(2)→暖前B(3)→暖主(4)→暖前A(5) |

### 4.2 handlers.ts（Socket 事件处理）

**职责**：注册所有 C2S 事件，调用业务函数，广播状态

| 关键函数 | 说明 |
|---------|------|
| `broadcastGameState(io, room)` | 先调 `processAutoExecutePending` + `checkAndOpenNegateWindow`，然后对每个 socket 发送脱敏后的 `GameStateClientView` |
| `scheduleNegateTimeout(io, room)` | 无懈可击超时（5秒自动跳过） |
| `checkAndBroadcastGameOver(io, room)` | 检查胜负 → emit `game_over` |

**注册的 C2S 事件**：create_room, join_room, start_game, pick_general, deploy_generals, yield_choice, choose_action_unit, use_card, use_skill, respond, negate_respond, end_turn, discard

### 4.3 cards.ts（卡牌系统）

- `createDeck()`: 生成 108 张标准牌（30杀、15闪、8桃、37锦囊、18装备）
- `shuffleDeck(deck)`: Fisher-Yates 洗牌

### 4.4 generals.ts（武将数据库）

32 个武将定义，按势力分组：

| 势力 | 武将 |
|------|------|
| 魏(9) | 司马懿、张辽、郭嘉、甄姬、徐晃、夏侯渊、许褚、夏侯惇、文聘 |
| 蜀(8) | 刘备、张飞、诸葛亮、赵云、马超、黄月英、姜维、庞德 |
| 吴(10) | 孙权、甘宁、吕蒙、大乔、孙尚香、孙坚、小乔、孙策、诸葛瑾、周瑜 |
| 群(5) | 华佗、吕布、貂蝉、贾诩、鲁肃 |

每个武将含 1-3 个技能（SkillDefinition），技能包含 id, name, description, type, trigger。

### 4.5 game-state.ts（状态管理与工具函数）

| 函数 | 说明 |
|------|------|
| `createGeneralInstance(def, playerId, faction, seatRole)` | 根据定义创建实例（初始化所有字段） |
| `toClientView(state, myPlayerId)` | 脱敏：己方武将可见手牌，对方只见 handCount |
| `getSeatDistance(from, to, allGenerals)` | 环形座位距离（死人不算） |
| `getAttackRange(attacker, target, allGenerals)` | 实际攻击范围（含坐骑/马术/镇卫） |
| `getEffectiveSuit(card, owner?)` | 有效花色（小乔红颜：♠→♥） |
| `checkGameOver(state)` | 主帅阵亡 → 游戏结束 |
| `addLog(state, text)` | 添加日志 |

### 4.6 turn-manager.ts（回合管理，~980行）

#### 4.6.1 大回合系统

3v3 特有的「大回合」机制：

```
大回合 N:
  1. 冷色方选择先手/让先 (handleYieldChoice)
  2. 先手方选择行动单元：主帅 or 前锋 (chooseActionUnit)
  3. 先手方第一行动单元执行 (executeCurrentStep → runTurnStart)
  4. 后手方选择行动单元
  5. 后手方第一行动单元执行
  6. 先手方剩余行动单元执行
  7. 后手方剩余行动单元执行
  8. → 进入大回合 N+1
```

| 函数 | 说明 |
|------|------|
| `handleYieldChoice` | 冷色方选择先手/让先 |
| `startNewRound` | 新一大回合 |
| `chooseActionUnit` | 选择行动单元（主帅/前锋） |
| `executeCurrentStep` | 按 step 执行行动 |
| `advanceStep` | 推进到下一步 |
| `getUnitCandidates` | 获取行动单元内候选武将（按顺序，排除已行动的） |

#### 4.6.2 武将回合

```
runTurnStart():
  准备阶段 → 洛神(甄姬) → 观星(诸葛亮) → 英魂(孙坚) → 英姿觉醒(孙策)
    → 神速一询问(夏侯渊)
  判定阶段 → runJudgePhase() 处理延时锦囊（后放先判）
  摸牌阶段 → 摸2张（英姿+1）/ 突袭(张辽) 替代
  出牌阶段 → 神速二询问(夏侯渊) → 等待玩家操作
  弃牌阶段 → handleDiscard()
  回合结束 → 闭月(甄姬) → finishTurn()
```

| 函数 | 说明 |
|------|------|
| `runTurnStart(state)` | 完整回合流程 |
| `continueTurnFromJudge(state, skipJudge, skipDraw, skipAction)` | 从判定阶段继续（神速等跳阶段用） |
| `runJudgePhase(state, general)` | 判定阶段：逐张处理延时锦囊 |
| `processNextJudge` | 处理单张延时锦囊判定（支持中断+继续） |
| `resolveJudge` | 结算延时锦囊判定效果 |
| `findJudgeIntervenor(state, general, excludeIndices)` | 从判定者逆时针查找鬼才/缓释介入者 |
| `continueJudgePhase` | JUDGE_INTERVENE 结束后继续判定 |
| `handleEndTurn` | 结束出牌 → 弃牌 |
| `handleDiscard` | 弃牌处理 |
| `finishTurn` | 回合结束 → 推进到下一武将或大回合 |

### 4.7 game-actions.ts（核心动作逻辑，~3600行）

这是最大的文件，包含所有游戏操作。

#### 4.7.1 无懈可击系统

```
使用锦囊 → pushNegateCheck() 打开无懈窗口
  → 有人出无懈 → handleNegateRespond() → 再次询问是否无懈之无懈
  → 5秒超时 / 所有人跳过 → resolveNegateWindow()
    → 未被无懈 → executeDeferredTrickEffect() 执行效果
    → 被无懈 → 效果取消
```

| 函数 | 说明 |
|------|------|
| `anyoneHasNegate(state)` | 检查是否有人持有无懈可击 |
| `pushNegateCheck(state, ...)` | 打开无懈窗口（DeferredTrickEffect 延迟） |
| `executeDeferredTrickEffect(state, effect)` | 执行延迟的锦囊效果 |
| `handleNegateRespond(state, playerId, data)` | 处理无懈可击出牌响应 |
| `resolveNegateWindow(state)` | 结算无懈窗口 |
| `checkAndOpenNegateWindow(state)` | 每次广播前检查 AOE 是否需要逐目标开窗 |
| `processAutoExecutePending(state)` | 自动执行不需要用户交互的 pending |

#### 4.7.2 技能判定系统（鬼才/缓释介入）

```
performSkillJudge(state, general, judgeType, name, ctx):
  翻牌 → discard → findJudgeIntervenor()
    → 有介入者 → unshift JUDGE_INTERVENE pending → return true
    → 无介入者 → resolveSkillJudge() → return false

JUDGE_INTERVENE handler:
  替换判定牌 → 将替换者加入 declinedIntervenors → findJudgeIntervenor(排除已替换者)
    → 还有人 → 入队新 JUDGE_INTERVENE
    → 无人 → resolveSkillJudge() 或 continueJudgePhase()
  跳过 → 加入 declinedIntervenors → findJudgeIntervenor(排除已拒绝者)
    → 还有人 → 修改 pending 指向下一个
    → 无人 → 结算
```

支持的 `SkillJudgeType`：ganglie(刚烈)、tieqi(铁骑)、luoshen(洛神)、eight_trigrams(八卦阵)

#### 4.7.3 伤害系统

```
dealDamage(state, attacker, target, amount, cardId?):
  扣血 → hp <= 0?
    → 是 → enterDyingState() → 逐人询问桃/急救
      → 被救 → triggerDamagePassiveSkills()（补触发被动）
      → 未救 → handleDeath()
    → 否 → 触发被动技能（反馈/遗计/刚烈/天香/奸雄）

loseHp(state, target, amount):
  失去体力（非伤害，不触发被动）→ 检查濒死
```

**被动技能触发**（dealDamage 中）：
- 反馈(司马懿)：受到伤害后从来源获取一张牌
- 遗计(郭嘉)：受到伤害后观看2张牌分别交给其他角色
- 刚烈(夏侯惇)：受到伤害后判定，非红桃则来源弃1牌或受1伤
- 天香(小乔)：受到伤害前，弃一张红桃/黑桃牌转移伤害
- 奸雄(曹操)：受到伤害后获得造成伤害的牌

#### 4.7.4 使用卡牌

`handleUseCard(state, playerId, data)`:
  1. 验证回合/阶段/手牌
  2. 根据 CardCategory 分发到 handleBasicCard / handleTrickCard / handleEquipCard

**handleBasicCard**（基本牌）：
- **杀**：距离检查、次数限制（咆哮无限）、武器特效、入队 DODGE pending
- **闪**：只能响应时使用
- **桃**：回血（非濒死只对自己用）

**handleTrickCard**（锦囊牌）：
- 统一入口先 splice 手牌 + discard + 触发集智（黄月英立即摸牌）
- 各锦囊分发到具体逻辑 + pushNegateCheck

**handleEquipCard**（装备牌）：
- 替换已有装备 → 旧装备入弃牌堆 → 触发枭姬

#### 4.7.5 使用技能

`handleUseSkill(state, playerId, data)`:

switch (data.skillId) 处理所有主动技能。已实现的技能：

| 技能ID | 武将 | 机制 |
|--------|------|------|
| `sunquan_zhiheng` | 孙权 | 弃任意张牌 → 摸等量牌 |
| `ganning_qixi` | 甘宁 | 黑色牌当过河拆桥 |
| `daqiao_guose` | 大乔 | 方块牌当乐不思蜀 |
| `lvmeng_keji` | 吕蒙 | 弃牌阶段不弃牌 |
| `zhouyu_fanjian` | 周瑜 | 选目标 → 对手猜花色 → 随机给一张牌 |
| `jiangwei_tiaoxin` | 姜维 | 挑衅目标出杀否则弃牌 |
| `liubei_rende` | 刘备 | 给牌（累计2张回1血） |
| `zhugeliang_kongcheng` | 诸葛亮 | 被动：手牌为0不能被杀/决斗 |
| `huatuo_jijiu` | 华佗 | 红色牌当桃（限濒死请求） |
| `huatuo_qingnang` | 华佗 | 弃1牌回1血 |
| `lvbu_wushuang` | 吕布 | 被动：杀需2闪、决斗出2杀 |
| `diaochan_lijian` | 貂蝉 | 弃1牌让两人决斗 |
| `pangde_mashu` | 庞德 | 被动：距离-1 |
| `jiaxu_luanwu` | 贾诩 | 所有人杀最近的人或失1血（限定技） |
| `lusu_haoshi` | 鲁肃 | 多摸2张，超5张给一半给最少手牌者 |
| `sunjian_yinghun` | 孙坚 | 损失的血量→摸X弃1 或 摸1弃X |
| `xuhuang_duanliang` | 徐晃 | 黑色牌当兵粮寸断 |
| `zhaoyun_longdan` | 赵云 | 被动：杀当闪/闪当杀 |
| `xiahoyuan_shensu_1` | 夏侯渊 | 跳过判定+摸牌 → 视为杀 |
| `xiahoyuan_shensu_2` | 夏侯渊 | 跳过出牌弃装备 → 视为杀 |
| `huanggai_kuru` | 黄盖 | 失1血摸2牌（先结算濒死） |
| `sunce_zhiba` | 孙策 | 觉醒：体力≤2且主帅→回血加技能 |

#### 4.7.6 响应处理

`handleRespond(state, playerId, data)`:

这是最大的 switch，处理所有 `ResponseType`。关键类型：

| ResponseType | 说明 |
|-------------|------|
| `DODGE` | 出闪（含龙胆/倾国/八卦阵触发） |
| `AOE_ATTACK` | 南蛮入侵出杀 |
| `AOE_DODGE` | 万箭齐发出闪 |
| `ATTACK_DUEL` | 决斗出杀 |
| `PEACH_SAVE` | 濒死出桃 |
| `PEACH_SAVE_ASK` | 逐人询问是否出桃 |
| `HARVEST_PICK` | 五谷丰登选牌 |
| `TRICK_TARGET_CARD_PICK` | 过河拆桥/顺手牵羊选目标牌 |
| `BORROW_SWORD_RESPONSE` | 借刀杀人出杀或交武器 |
| `SKILL_ACTIVATE_CONFIRM` | 通用技能确认（是否发动） |
| `SKILL_FANKUI_PICK` | 反馈选牌 |
| `SKILL_YIJI_GIVE` | 遗计分牌 |
| `SKILL_FANJIAN_SUIT` | 反间选花色 |
| `SKILL_TIAOXIN_RESPONSE` | 挑衅响应 |
| `SKILL_SHENSU_TARGET` | 神速选杀目标 |
| `SKILL_SHENSU_EQUIP` | 神速二弃装备 |
| `SKILL_GUANXING_ARRANGE` | 观星排牌 |
| `SKILL_HAOSHI_GIVE` | 好施给牌 |
| `SKILL_YINGHUN_CHOICE` | 英魂选模式 |
| `SKILL_TIANXIANG_TARGET` | 天香选目标 |
| `SKILL_LUANWU_RESPONSE` | 乱武出杀或失血 |
| `SKILL_RENDE_GIVE` | 仁德给牌 |
| `JUDGE_INTERVENE` | 鬼才/缓释改判定 |
| `SKILL_LIULI_TARGET` | 流离选目标 |

#### 4.7.7 杀的处理链

```
使用杀 → 入队 DODGE pending
  → handleDodgeResponse():
    出闪成功 → handleDodgeSucceeded() → 武器效果（青龙追杀/贯石斧强制命中）
    未出闪 → handleDodgeFailed() → 武器效果（寒冰剑选牌/麒麟弓弃马/雌雄选弃牌）→ dealDamage
```

---

## 五、前端核心模块

### 5.1 App.tsx（路由）

根据 `gameState.phase` 自动路由：
- LOBBY → `/`（LobbyPage）
- GENERAL_PICK / DEPLOY → `/pick`（GeneralPickPage）
- PLAYING → `/game`（GamePage）
- GAME_OVER → `/gameover`（GameOverPage）

### 5.2 gameStore.ts（Zustand 状态管理）

| 字段 | 说明 |
|------|------|
| `playerId` | 当前玩家 ID |
| `roomCode` | 房间号 |
| `myFaction` | 己方阵营 |
| `gameState` | 服务端推送的 GameStateClientView |
| `selectedCardIds` | 当前选中的卡牌 ID 列表 |
| `selectedTargets` | 当前选中的目标武将索引列表 |
| `error` | 错误信息 |

### 5.3 socket/client.ts（Socket 通信）

封装了所有 `emit` 操作（use_card, use_skill, respond 等）和 `registerSocketListeners` 注册服务端事件监听。

### 5.4 GamePage.tsx（~1146行，核心对战 UI）

这是最复杂的前端组件，包含：

1. **棋盘布局**：6个武将面板（HP/装备/判定区），中央信息区
2. **手牌区**：显示己方手牌，支持选中高亮
3. **操作栏**：
   - 普通出牌按钮（使用卡牌/技能/结束回合/弃牌）
   - 响应按钮（出闪/出桃/出杀/选目标/选花色等）
   - 技能确认面板（发动/不发动）
   - 各种专项 UI（观星排列、五谷丰登选牌、反馈选牌、遗计分牌等）
4. **状态显示**：当前回合提示、日志面板、无懈可击窗口

**关键逻辑**：
- `myPendingResponse`：判断当前 pending 是否指向己方武将
- `isViewingResponding`：是否正在查看需要响应的武将
- 自动决定显示哪种交互 UI

---

## 六、核心流程

### 6.1 Pending Response 队列机制

这是整个游戏最核心的异步机制。所有需要等待玩家输入的操作都通过 `pendingResponseQueue` 管理：

```
操作 → 入队 PendingResponse（unshift 到队首 / push 到队尾）
  → broadcastGameState() 将 queue[0] 发送给客户端
  → 客户端显示对应 UI
  → 玩家操作 → C2S respond 事件
  → handleRespond() 处理 → shift 出队
  → 可能产生新的 PendingResponse（链式响应）
  → broadcastGameState()
```

**队列操作**：
- `unshift`：插入到队首（立即处理）
- `push`：追加到队尾（延后处理）
- `shift`：移除队首（当前响应完成）

### 6.2 判定介入流程

```
翻判定牌 → findJudgeIntervenor(从判定者逆时针)
  → 找到介入者 → 入队 JUDGE_INTERVENE
    → 替换: 替换者加入 excludeList → 再找下一个介入者
    → 跳过: 跳过者加入 excludeList → 找下一个
    → 无更多介入者 → 结算
  → 无介入者 → 直接结算
```

注意事项：
- **鬼才**(司马懿): 可以改任何人的判定
- **缓释**(诸葛瑾): 只能改己方角色的判定
- 每个介入者在同一次判定中只能替换一次
- 询问顺序：从判定者开始逆时针

### 6.3 无懈可击流程

```
锦囊使用 → pushNegateCheck() 打开 negateWindow
  → 有人有无懈 → 广播 negateWindow 状态
    → 有人打出无懈 → 标记 isCurrentlyNegated = !prev → 继续询问
    → 5秒超时 / 所有人 pass → resolveNegateWindow()
  → 无人有无懈 → 直接执行效果
```

### 6.4 座位排列与距离

```
3v3 标准座次（环形）：
  冷前A(0) → 冷主帅(1) → 冷前B(2) → 暖前B(3) → 暖主帅(4) → 暖前A(5)

距离 = min(顺时针座位差, 逆时针座位差)
  - 出击方 -1马: 距离-1
  - 马术(马超/庞德): 距离-1
  - 防守方 +1马: 距离+1
  - 镇卫(文聘): 距离+1

攻击范围 = 武器攻击范围(默认1)
  杀可用条件: 有效距离 ≤ 攻击范围
```

---

## 七、已知未修复的 Bug

| 编号 | 描述 | 优先级 |
|------|------|--------|
| 1 | **司马懿鬼才**：同一个判定中，同一个人可以连续改多次（应该每人只能改一次） | 高 |
| 2 | **小乔天香**：天香触发的详细流程需要验证（选择红桃/黑桃牌，选角色，弃牌转移伤害并摸牌） | 中 |
| 3 | **甄姬洛神**：有鬼才介入时，点击放弃继续洛神后游戏卡死（turnPhase 停留在 JUDGE，不继续到 DRAW/ACTION） | 高 |
| 4 | **甄姬倾国**：黑色牌不能在自己回合内使用（倾国将所有黑色牌视为闪的 bug，需调查） | 中 |
| 5 | **大乔流离**：没有选择舍弃哪张牌的步骤（需要选择弃一张装备或手牌） | 中 |
| 6 | **错误信息不显示**：使用卡牌/技能失败时，错误未在前端展示 | 低 |

---

## 八、武将技能实现状态

### 已完整实现 ✅

| 武将 | 技能 | 说明 |
|------|------|------|
| 司马懿 | 鬼才、反馈 | 鬼才有重复改判定 bug |
| 张辽 | 突袭 | 摸牌阶段获取对方手牌 |
| 郭嘉 | 天妒、遗计 | 判定牌/受伤后分牌 |
| 甄姬 | 洛神、倾国 | 洛神有卡死 bug，倾国有使用限制 bug |
| 徐晃 | 断粮 | 黑色牌当兵粮寸断 |
| 夏侯渊 | 神速 | 两种神速各一次，无限距离 |
| 夏侯惇 | 刚烈 | 受伤后判定（支持鬼才介入） |
| 文聘 | 镇卫 | 被动距离+1 |
| 刘备 | 仁德 | 给牌，累计2张回血 |
| 张飞 | 咆哮 | 杀无次数限制 |
| 诸葛亮 | 观星、空城 | 排列牌堆 + 手牌空不被杀/决斗 |
| 赵云 | 龙胆 | 杀↔闪互换 |
| 马超 | 马术、铁骑 | 距离-1 + 判定跳闪 |
| 黄月英 | 集智、奇才 | 用锦囊立即摸1牌 + 锦囊无距离限制 |
| 姜维 | 挑衅 | 指定目标出杀否则弃牌 |
| 庞德 | 马术 | 距离-1 |
| 孙权 | 制衡 | 弃手牌摸等量牌 |
| 甘宁 | 奇袭 | 黑色牌当过河拆桥 |
| 大乔 | 国色、流离 | 方块当乐 + 转移杀目标（流离有 bug） |
| 孙尚香 | 枭姬 | 失去装备摸2张 |
| 孙坚 | 英魂 | 回合开始选模式摸/弃 |
| 小乔 | 天香、红颜 | 转移伤害（有待验证） + ♠视为♥ |
| 孙策 | 激昂、英姿觉醒 | 红色决斗/杀摸牌 + 体力≤2觉醒 |
| 诸葛瑾 | 缓释、明哲 | 改己方判定 + 非自己回合出红色牌摸1张 |
| 周瑜 | 反间 | 对手猜花色，随机给牌 |
| 华佗 | 急救、青囊 | 红色牌当桃 + 弃牌回血 |
| 吕布 | 无双 | 杀需2闪/决斗出2杀 |
| 貂蝉 | 离间 | 让两人决斗 |
| 贾诩 | 乱武、帷幕 | 所有人杀最近或失血 + 不能被黑色锦囊指定 |
| 黄盖 | 苦肉 | 失1血摸2牌（先结算濒死） |

---

## 九、通信协议（Socket.IO 事件）

### C2S（客户端→服务端）

| 事件 | 数据 | 说明 |
|------|------|------|
| `create_room` | `{ nickname }` | 创建房间 |
| `join_room` | `{ roomCode, nickname }` | 加入房间 |
| `start_game` | `{}` | 开始游戏 |
| `pick_general` | `{ generalId }` | 选将 |
| `deploy_generals` | `{ commanderId, flankAId, flankBId }` | 部署 |
| `yield_choice` | `{ yield: boolean }` | 选择先手/让先 |
| `choose_action_unit` | `{ unit, flankOrder? }` | 选择行动单元 |
| `use_card` | `{ generalIndex, cardId, targetIndices, extra? }` | 使用卡牌 |
| `use_skill` | `{ generalIndex, skillId, targetIndices, cardIds? }` | 使用技能 |
| `respond` | `{ cardId?, decline?, suit?, targetIndex?, action?, ... }` | 响应 pending |
| `negate_respond` | `{ cardId?, generalIndex }` | 无懈可击响应 |
| `end_turn` | `{}` | 结束出牌 |
| `discard` | `{ cardIds }` | 弃牌 |

### S2C（服务端→客户端）

| 事件 | 数据 | 说明 |
|------|------|------|
| `room_created` | `{ roomCode, playerId }` | 房间已创建 |
| `room_joined` | `{ playerId }` | 已加入房间 |
| `game_state_update` | `{ state: GameStateClientView }` | 状态更新（脱敏） |
| `game_over` | `{ winnerFaction, reason }` | 游戏结束 |
| `error` | `{ message }` | 错误信息 |

---

## 十、开发注意事项

### 10.1 循环依赖

`game-actions.ts` 和 `turn-manager.ts` 之间存在潜在循环依赖：
- `game-actions.ts` 导入 `turn-manager.ts` 的 `continueJudgePhase`, `continueTurnFromJudge`, `findJudgeIntervenor`
- `turn-manager.ts` 导入 `game-actions.ts` 的函数（间接通过 handlers.ts 调用）

**规则**：`turn-manager.ts` 不应直接导入 `game-actions.ts`。需要 game-actions 逻辑时，在 turn-manager 中内联实现（如洛神初始判定）。

### 10.2 客户端数据脱敏

- 对手手牌：`hand` 字段为 `undefined`，只有 `handCount`
- 判断对手手牌数量应使用 `handCount`，而非 `hand?.length`
- 己方武将：`hand` 字段包含完整 Card[]

### 10.3 Pending Response 使用规范

- `unshift`：需要立即处理的响应（如杀→闪、技能判定介入）
- `push`：延后处理的响应（如洛神继续询问）
- 处理完成后必须 `shift()` 移除当前响应
- context 中存储延续所需的所有信息

### 10.4 技能 ID 命名规范

格式：`{武将拼音}_{技能拼音}`，例如 `simayi_guicai`, `zhenji_luoshen`, `huangyueying_jizhi`

### 10.5 装备效果处理位置

- 武器效果：主要在 `handleDodgeSucceeded` / `handleDodgeFailed` 中
- 防具效果（八卦阵）：在 `handleDodgeResponse` 中触发 `performSkillJudge`
- 坐骑效果：在 `getAttackRange` 距离计算中

---

## 十一、测试方法

1. 启动：根目录 `npm run dev`
2. 打开两个浏览器标签页，访问 `http://localhost:5174/`
3. 一个标签创建房间，另一个输入房间号加入
4. 选将 → 部署 → 开始游戏
5. 所有操作通过 UI 按钮完成

---

## 十二、文件大小参考

| 文件 | 行数 | 主要内容 |
|------|------|---------|
| `shared/src/index.ts` | ~538 | 所有共享类型 |
| `server/src/core/game-actions.ts` | ~3600 | 核心动作逻辑（最大文件） |
| `server/src/core/turn-manager.ts` | ~980 | 回合管理 |
| `server/src/core/generals.ts` | ~436 | 武将定义 |
| `server/src/core/game-state.ts` | ~251 | 状态工具 |
| `server/src/core/cards.ts` | ~174 | 卡牌定义 |
| `server/src/socket/handlers.ts` | ~323 | Socket 事件 |
| `server/src/rooms/room-manager.ts` | ~327 | 房间管理 |
| `client/src/pages/GamePage.tsx` | ~1146 | 核心对战 UI |
| `client/src/pages/GeneralPickPage.tsx` | ~300 | 选将 UI |
