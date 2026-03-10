// ============================================================
// 三国杀 3v3 — 共享类型定义
// ============================================================

// ─────────────────────────────────────────────────────────────
// 基础枚举
// ─────────────────────────────────────────────────────────────

/** 阵营 */
export enum Faction {
    WARM = 'warm',
    COOL = 'cool',
}

/** 座位角色 */
export enum SeatRole {
    COMMANDER = 'commander',
    FLANK_A = 'flank_a',
    FLANK_B = 'flank_b',
}

/** 游戏阶段 */
export enum GamePhase {
    WAITING = 'waiting',
    GENERAL_PICK = 'general_pick',
    DEPLOY = 'deploy',
    PLAYING = 'playing',
    GAME_OVER = 'game_over',
}

/** 回合阶段 */
export enum TurnPhase {
    TURN_START = 'turn_start',
    JUDGE = 'judge',
    DRAW = 'draw',
    ACTION = 'action',
    DISCARD = 'discard',
    TURN_END = 'turn_end',
}

/** 行动单元类型 */
export enum ActionUnitType {
    COMMANDER = 'commander',
    FLANKS = 'flanks',
}

/** 卡牌花色 */
export enum CardSuit {
    SPADE = 'spade',
    HEART = 'heart',
    CLUB = 'club',
    DIAMOND = 'diamond',
}

/** 卡牌类型大类 */
export enum CardCategory {
    BASIC = 'basic',
    TRICK = 'trick',
    EQUIPMENT = 'equipment',
}

/** 基本牌名 */
export enum BasicCardName {
    ATTACK = 'attack',
    DODGE = 'dodge',
    PEACH = 'peach',
}

/** 锦囊牌子类型 */
export enum TrickType {
    INSTANT = 'instant',
    DELAYED = 'delayed',
}

/** 锦囊牌名 */
export enum TrickCardName {
    DRAW_TWO = 'draw_two',
    DISMANTLE = 'dismantle',
    STEAL = 'steal',
    DUEL = 'duel',
    BARBARIANS = 'barbarians',
    ARROWS = 'arrows',
    PEACH_GARDEN = 'peach_garden',
    HARVEST = 'harvest',
    NEGATE = 'negate',
    BORROW_SWORD = 'borrow_sword',
    OVERINDULGENCE = 'overindulgence',
    SUPPLY_SHORTAGE = 'supply_shortage',
}

/** 装备区槽位 */
export enum EquipSlot {
    WEAPON = 'weapon',
    ARMOR = 'armor',
    PLUS_HORSE = 'plus_horse',
    MINUS_HORSE = 'minus_horse',
}

/** 装备牌名 */
export enum EquipmentCardName {
    // 武器
    CROSSBOW = 'crossbow',               // 诸葛连弩
    DOUBLE_SWORDS = 'double_swords',     // 雌雄双股剑
    QINGGANG_SWORD = 'qinggang_sword',   // 青釭剑
    ICE_SWORD = 'ice_sword',             // 寒冰剑
    ZHANGBA_SPEAR = 'zhangba_spear',     // 丈八蛇矛
    GREEN_DRAGON = 'green_dragon',       // 青龙偃月刀
    STONE_AXE = 'stone_axe',             // 贯石斧
    FANGTIAN_HALBERD = 'fangtian_halberd', // 方天画戟
    KYLIN_BOW = 'kylin_bow',             // 麒麟弓
    // 防具
    EIGHT_TRIGRAMS = 'eight_trigrams',    // 八卦阵
    NIOH_SHIELD = 'nioh_shield',         // 仁王盾
    // 坐骑
    PLUS_HORSE = 'plus_horse',           // +1 马
    MINUS_HORSE = 'minus_horse',         // -1 马
}

/** 武将技能类型 */
export enum SkillType {
    ACTIVE = 'active',
    PASSIVE = 'passive',
    LOCKED = 'locked',
    LIMITED = 'limited',
    AWAKENED = 'awakened',
}

/** 技能触发时机 */
export enum SkillTrigger {
    ON_TURN_START = 'on_turn_start',
    ON_DRAW_CARDS = 'on_draw_cards',
    ON_USE_CARD = 'on_use_card',
    ON_USED_AS_TARGET = 'on_used_as_target',
    ON_DAMAGE_DEALT = 'on_damage_dealt',
    ON_DAMAGE_RECEIVED = 'on_damage_received',
    ON_HP_CHANGED = 'on_hp_changed',
    ON_DYING = 'on_dying',
    ON_KILLED = 'on_killed',
    ON_TURN_END = 'on_turn_end',
    ON_JUDGE = 'on_judge',
    ON_DISCARD = 'on_discard',
    ON_LOSE_EQUIP = 'on_lose_equip',
    ACTIVE = 'active',
}

// ─────────────────────────────────────────────────────────────
// 卡牌
// ─────────────────────────────────────────────────────────────

export interface Card {
    id: string
    suit: CardSuit
    value: number           // 1(A) ~ 13(K)
    category: CardCategory
    name: BasicCardName | TrickCardName | EquipmentCardName
    equipSlot?: EquipSlot
    trickType?: TrickType
    attackRange?: number    // 武器专属
}

// ─────────────────────────────────────────────────────────────
// 武将
// ─────────────────────────────────────────────────────────────

export interface SkillDefinition {
    id: string
    name: string
    description: string
    type: SkillType
    trigger?: SkillTrigger
}

export interface GeneralDefinition {
    id: string
    name: string
    maxHp: number
    gender: 'male' | 'female'
    kingdom: 'wei' | 'shu' | 'wu' | 'qun'
    skills: SkillDefinition[]
}

// ─────────────────────────────────────────────────────────────
// 武将实例（游戏中）
// ─────────────────────────────────────────────────────────────

export interface EquipZone {
    [EquipSlot.WEAPON]?: Card
    [EquipSlot.ARMOR]?: Card
    [EquipSlot.PLUS_HORSE]?: Card
    [EquipSlot.MINUS_HORSE]?: Card
}

export interface GeneralInstance {
    generalId: string
    playerId: string
    faction: Faction
    seatRole: SeatRole
    hp: number
    maxHp: number
    hand: Card[]
    equip: EquipZone
    judgeZone: Card[]
    alive: boolean
    usedLimitedSkills: string[]
    hasActed: boolean
    /** 觉醒技是否已触发 */
    awakened: boolean
    /** 忠义牌（关羽限定技） */
    loyaltyCard?: Card
    /** 本回合已使用的技能（限一次的技能追踪） */
    skillsUsedThisTurn: string[]
    /** 觉醒后获得的额外技能 ID */
    acquiredSkills: string[]
    /** 仁德本回合已给出的牌数 */
    rendeGivenThisTurn: number
    /** 仁德本回合是否已回复过体力 */
    rendeHealedThisTurn: boolean
}

export interface Player {
    id: string
    nickname: string
    faction?: Faction
    connected: boolean
}

// ─────────────────────────────────────────────────────────────
// 选将
// ─────────────────────────────────────────────────────────────

/** 1-2-2-2-2-2-2-2-1 选将顺序（16步） */
export const PICK_SEQUENCE: Faction[] = [
    Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM,
]

export interface GeneralPickState {
    pool: GeneralDefinition[]
    pickStep: number
    warmPicked: GeneralDefinition[]
    coolPicked: GeneralDefinition[]
}

export interface DeployState {
    warmDeployed: boolean
    coolDeployed: boolean
}

// ─────────────────────────────────────────────────────────────
// 大回合状态
// ─────────────────────────────────────────────────────────────

export interface RoundState {
    /** 当前大回合编号（从 1 开始） */
    roundNumber: number
    /** 先手方（冷色方决定，暖主保护轮时暖色方自动先手） */
    firstMover: Faction
    /** 是否让先（冷色方选择让先→暖色方永久先手） */
    yieldedFirst?: boolean
    /** 是否正在等待冷色方选择先手/让先（仅第1大回合前） */
    waitingForYield?: boolean
    /** 先手方选择的行动单元（commander / flanks），undefined 表示尚未选择 */
    firstMoverChoice?: ActionUnitType
    /** 后手方选择的行动单元 */
    secondMoverChoice?: ActionUnitType
    /** 先手方选边锋时的顺序（[先动边锋index, 后动边锋index]） */
    firstMoverFlankOrder?: number[]
    /** 后手方选边锋时的顺序 */
    secondMoverFlankOrder?: number[]
    /** 当前执行到第几个行动单元（0~3） */
    currentActionStep: number
}

// ─────────────────────────────────────────────────────────────
// 游戏核心状态
// ─────────────────────────────────────────────────────────────

export interface GameState {
    roomId: string
    phase: GamePhase

    players: Record<string, Player>
    warmPlayerId: string
    coolPlayerId: string

    pickState?: GeneralPickState
    deployState?: DeployState

    generals: GeneralInstance[]

    deck: Card[]
    discard: Card[]

    // 回合状态
    turnPhase: TurnPhase
    activePlayerFaction: Faction
    currentActionUnit?: ActionUnitType
    activeGeneralIndex: number

    /** 大回合状态 */
    roundState: RoundState

    attackUsedThisTurn: number
    /** 待响应队列（队首为当前需响应的事件） */
    pendingResponseQueue: PendingResponse[]

    /** 五谷丰登可选牌池 */
    harvestPool?: Card[]

    /** 无懈可击独立窗口 */
    negateWindow?: NegateWindow

    log: LogEntry[]
}

/** 无懈可击窗口（服务端完整版） */
export interface NegateWindow {
    trickCardName: string
    trickUserIndex: number
    trickTargetIndex: number
    trickTargetName: string
    isCurrentlyNegated: boolean
    deferredEffect?: any
    hasFollowUpResponse: boolean
    passedPlayerIds: string[]
    startedAt: number
    anyoneHasNegate: boolean
}

/** 无懈可击窗口（客户端脱敏版） */
export interface NegateWindowClientView {
    trickCardName: string
    trickTargetName: string
    isCurrentlyNegated: boolean
    anyoneHasNegate: boolean
    startedAt: number
}

// ─────────────────────────────────────────────────────────────
// 客户端视图
// ─────────────────────────────────────────────────────────────

export interface GeneralClientView {
    generalId: string
    faction: Faction
    seatRole: SeatRole
    hp: number
    maxHp: number
    handCount: number
    hand?: Card[]
    equip: EquipZone
    judgeZone: Card[]
    alive: boolean
    hasActed: boolean
    awakened: boolean
    loyaltyCard?: Card
    skillsUsedThisTurn?: string[]
    usedLimitedSkills?: string[]
}

export interface GameStateClientView {
    roomId: string
    phase: GamePhase
    myPlayerId: string
    myFaction: Faction
    pickState?: GeneralPickState
    deployState?: DeployState
    generals: GeneralClientView[]
    deckCount: number
    discardTop?: Card
    turnPhase: TurnPhase
    activePlayerFaction: Faction
    currentActionUnit?: ActionUnitType
    activeGeneralIndex: number
    attackUsedThisTurn: number
    pendingResponse?: PendingResponse
    negateWindow?: NegateWindowClientView
    roundState: RoundState
    harvestPool?: Card[]
    log: LogEntry[]
}

// ─────────────────────────────────────────────────────────────
// 响应
// ─────────────────────────────────────────────────────────────

export enum ResponseType {
    DODGE = 'dodge',
    NEGATE = 'negate',
    ATTACK_DUEL = 'attack_duel',
    PEACH_SAVE = 'peach_save',
    HARVEST_CHOICE = 'harvest_choice',
    BARBARIANS_RESPONSE = 'barbarians_response',
    ARROWS_RESPONSE = 'arrows_response',
    // ── 技能交互 ──
    SKILL_YIJI_DISTRIBUTE = 'skill_yiji_distribute',       // 遗计：选择分配2张牌给谁
    SKILL_GANGLIE_CHOICE = 'skill_ganglie_choice',         // 刚烈：来源选弃2牌或受1伤
    SKILL_FANJIAN_SUIT = 'skill_fanjian_suit',             // 反间(周瑜)：目标选花色
    SKILL_FANKUI_PICK = 'skill_fankui_pick',               // 反馈(司马懿)：选来源一张牌
    SKILL_TIAOXIN_RESPONSE = 'skill_tiaoxin_response',     // 挑衅：目标出杀或放弃
    SKILL_TIANXIANG_CHOOSE = 'skill_tianxiang_choose',      // 天香(小乔)：选转移目标
    SKILL_GUANXING_ARRANGE = 'skill_guanxing_arrange',     // 观星：排列牌堆顶/底
    SKILL_LUOSHEN_CONTINUE = 'skill_luoshen_continue',     // 洛神：是否继续判定
    SKILL_TUXI_CHOOSE = 'skill_tuxi_choose',               // 突袭(张辽)：选偷谁的牌
    SKILL_SHENSU_TARGET = 'skill_shensu_target',           // 神速：选杀的目标
    SKILL_SHENSU_EQUIP = 'skill_shensu_equip',             // 神速二：选弃哪件装备
    SKILL_LUANWU_RESPONSE = 'skill_luanwu_response',       // 乱武：出杀或失血
    SKILL_LUANWU_PICK_TARGET = 'skill_luanwu_pick_target', // 乱武：选择出杀目标（多个最近）
    SKILL_RENDE_GIVE = 'skill_rende_give',                 // 仁德(刘备)：给牌
    SKILL_YINGHUN_CHOOSE = 'skill_yinghun_choose',         // 英魂(孙坚)：选目标+模式
    SKILL_YINGHUN_DISCARD = 'skill_yinghun_discard',       // 英魂(孙坚)：目标弃牌
    SKILL_LIULI_REDIRECT = 'skill_liuli_redirect',         // 流离(大乔)：重定向杀
    SKILL_YINGHUN_OPTION = 'skill_yinghun_option',         // 英魂(孙坚)：选模式
    SKILL_ZHIJI_CHOICE = 'skill_zhiji_choice',             // 志继(姜维)：回血或摸牌
    HARVEST_PICK = 'harvest_pick',                         // 五谷丰登：选择一张牌
    AOE_DODGE = 'aoe_dodge',                               // 万箭齐发：出闪或受伤
    AOE_ATTACK = 'aoe_attack',                             // 南蛮入侵：出杀或受伤
    PEACH_GARDEN_HEAL = 'peach_garden_heal',               // 桃园结义：回复体力（逐目标无懈）
    EQUIP_DOUBLE_SWORDS_CHOICE = 'equip_double_swords_choice', // 雌雄双股剑：目标选弃牌或让对方摸牌
    EQUIP_KYLIN_BOW_CHOICE = 'equip_kylin_bow_choice',     // 麒麟弓：选择弃哪匹马
    SKILL_EIGHT_TRIGRAMS = 'skill_eight_trigrams',          // 八卦阵：翻牌判定
    NEGATE_CHANCE = 'negate_chance',                       // 无懈可击：询问是否打出
    TRICK_TARGET_CARD_PICK = 'trick_target_card_pick',     // 过河拆桥/顺手牵羊：选目标的牌
    BORROW_SWORD_RESPONSE = 'borrow_sword_response',       // 借刀杀人：出杀或交武器
    // ── 濒死询问 ──
    PEACH_SAVE_ASK = 'peach_save_ask',                     // 逐人询问是否出桃/救主/急救
    // ── 判定介入 ──
    JUDGE_INTERVENE = 'judge_intervene',                   // 鬼才/缓释：打出手牌替换判定牌
    // ── 技能确认 ──
    SKILL_ACTIVATE_CONFIRM = 'skill_activate_confirm',     // 通用：确认是否发动某技能
}

export interface PendingResponse {
    type: ResponseType
    /** 需要响应的武将下标（或列表中当前响应者） */
    targetGeneralIndex: number
    /** 上下文 */
    context?: Record<string, unknown>
    /** 可使用的卡牌过滤 */
    validCardIds?: string[]
}

// ─────────────────────────────────────────────────────────────
// 日志
// ─────────────────────────────────────────────────────────────

export interface LogEntry {
    timestamp: number
    text: string
}

// ─────────────────────────────────────────────────────────────
// Socket.io 事件协议
// ─────────────────────────────────────────────────────────────

/* ---- C2S ---- */

export interface C2S_CreateRoom { nickname: string }
export interface C2S_JoinRoom { roomCode: string; nickname: string }
export interface C2S_PickGeneral { generalId: string }
export interface C2S_DeployGenerals { commander: string; flankA: string; flankB: string }

/** 选择行动单元（主帅 or 边锋） */
export interface C2S_ChooseActionUnit {
    unit: ActionUnitType
    /** 选边锋时指定行动顺序：[先动边锋 generalIndex, 后动边锋 generalIndex] */
    flankOrder?: number[]
}

export interface C2S_UseCard {
    cardId: string
    targetIndices: number[]
    /** 额外参数：AOE 方向 ('clockwise' | 'counterclockwise') 等 */
    extra?: Record<string, unknown>
    /** 技能转换声明：如 'ganning_qixi' 表示此黑色牌当过河拆桥使用 */
    asSkill?: string
}

export interface C2S_UseSkill {
    skillId: string
    targetIndices?: number[]
    cardIds?: string[]
}

export interface C2S_Respond {
    cardId?: string
    /** 用哪个武将的牌响应（无懈可击方案B需要） */
    generalIndex?: number
    /** 具体动作（如 'peach' / 'jiuzhu' / 'jijiu'） */
    action?: string
}

export interface C2S_Discard { cardIds: string[] }
export interface C2S_YieldChoice { yield: boolean }
export interface C2S_NegateRespond {
    /** 无懈可击牌 ID（undefined = 放弃） */
    cardId?: string
    /** 出牌武将 index */
    generalIndex: number
}

/* ---- S2C ---- */

export interface S2C_RoomCreated { roomCode: string; playerId: string }
export interface S2C_RoomJoined { playerId: string }
export interface S2C_RoomUpdate { roomCode: string; players: Player[]; phase: GamePhase }
export interface S2C_GameStateUpdate { state: GameStateClientView }
export interface S2C_Error { message: string }
export interface S2C_GameOver { winnerFaction: Faction; reason: string }

/* ---- 事件名 ---- */

export const SocketEvents = {
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    PICK_GENERAL: 'pick_general',
    DEPLOY_GENERALS: 'deploy_generals',
    CHOOSE_ACTION_UNIT: 'choose_action_unit',
    USE_CARD: 'use_card',
    USE_SKILL: 'use_skill',
    RESPOND: 'respond',
    END_TURN: 'end_turn',
    DISCARD: 'discard',
    YIELD_CHOICE: 'yield_choice',
    NEGATE_RESPOND: 'negate_respond',
    ROOM_CREATED: 'room_created',
    ROOM_JOINED: 'room_joined',
    ROOM_UPDATE: 'room_update',
    GAME_STATE_UPDATE: 'game_state_update',
    GAME_OVER: 'game_over',
    ERROR: 'error',
} as const
