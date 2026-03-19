import { v4 as uuidv4 } from 'uuid'
import {
    Faction,
    SeatRole,
    GeneralDefinition,
    GeneralInstance,
    EquipZone,
    GameState,
    GameStateClientView,
    GeneralClientView,
    TurnPhase,
    GamePhase,
    SkillDefinition,
    CardSuit,
} from 'sgs3v3-shared'
import { getGeneralById } from './generals'

/**
 * 从武将定义创建武将实例
 */
export function createGeneralInstance(
    def: GeneralDefinition,
    playerId: string,
    faction: Faction,
    seatRole: SeatRole
): GeneralInstance {
    return {
        generalId: def.id,
        playerId,
        faction,
        seatRole,
        hp: def.maxHp,
        maxHp: def.maxHp,
        hand: [],
        equip: {} as EquipZone,
        judgeZone: [],
        alive: true,
        usedLimitedSkills: [],
        hasActed: false,
        awakened: false,
        skillsUsedThisTurn: [],
        acquiredSkills: [],
        rendeGivenThisTurn: 0,
        rendeHealedThisTurn: false,
    }
}

/**
 * 将服务端完整 GameState 转换为特定玩家视图（脱敏）
 * - 己方武将可见手牌
 * - 对方武将只显示手牌数量
 */
export function toClientView(
    state: GameState,
    myPlayerId: string
): GameStateClientView {
    const myPlayer = state.players[myPlayerId]
    const myFaction = myPlayer?.faction ?? Faction.WARM

    const generals: GeneralClientView[] = state.generals.map((g) => {
        const isMine = g.playerId === myPlayerId
        return {
            generalId: g.generalId,
            faction: g.faction,
            seatRole: g.seatRole,
            hp: g.hp,
            maxHp: g.maxHp,
            handCount: g.hand.length,
            hand: isMine ? g.hand : undefined,
            equip: g.equip,
            judgeZone: g.judgeZone,
            alive: g.alive,
            hasActed: g.hasActed,
            awakened: g.awakened,
            loyaltyCard: g.loyaltyCard,
            skillsUsedThisTurn: g.skillsUsedThisTurn,
            usedLimitedSkills: g.usedLimitedSkills,
        }
    })

    return {
        roomId: state.roomId,
        phase: state.phase,
        myPlayerId,
        myFaction,
        pickState: state.pickState,
        deployState: state.deployState,
        generals,
        deckCount: state.deck.length,
        discardTop: state.discard[state.discard.length - 1],
        turnPhase: state.turnPhase,
        activePlayerFaction: state.activePlayerFaction,
        currentActionUnit: state.currentActionUnit,
        activeGeneralIndex: state.activeGeneralIndex,
        attackUsedThisTurn: state.attackUsedThisTurn,
        pendingResponse: state.pendingResponseQueue[0],
        negateWindow: state.negateWindow ? {
            trickCardName: state.negateWindow.trickCardName,
            trickTargetName: state.negateWindow.trickTargetName,
            isCurrentlyNegated: state.negateWindow.isCurrentlyNegated,
            anyoneHasNegate: state.negateWindow.anyoneHasNegate,
            startedAt: state.negateWindow.startedAt,
        } : undefined,
        roundState: state.roundState,
        harvestPool: state.harvestPool,
        log: state.log.slice(-50),
    }
}

/**
 * 将服务端完整 GameState 转换为观战者视图
 * - 观战者以所选阵营为视角，可以看到该阵营的手牌
 * - 部署阶段不显示部署信息
 */
export function toSpectatorView(
    state: GameState,
    viewFaction: Faction
): GameStateClientView {
    const isDeploy = state.phase === GamePhase.DEPLOY

    const generals: GeneralClientView[] = state.generals.map((g) => {
        const isViewFaction = g.faction === viewFaction
        return {
            generalId: g.generalId,
            faction: g.faction,
            seatRole: g.seatRole,
            hp: g.hp,
            maxHp: g.maxHp,
            handCount: g.hand.length,
            hand: isViewFaction ? g.hand : undefined,
            equip: g.equip,
            judgeZone: g.judgeZone,
            alive: g.alive,
            hasActed: g.hasActed,
            awakened: g.awakened,
            loyaltyCard: g.loyaltyCard,
            skillsUsedThisTurn: g.skillsUsedThisTurn,
            usedLimitedSkills: g.usedLimitedSkills,
        }
    })

    return {
        roomId: state.roomId,
        phase: state.phase,
        myPlayerId: '',
        myFaction: viewFaction,
        pickState: state.pickState,
        deployState: isDeploy ? undefined : state.deployState,
        generals: isDeploy ? [] : generals,
        deckCount: state.deck.length,
        discardTop: state.discard[state.discard.length - 1],
        turnPhase: state.turnPhase,
        activePlayerFaction: state.activePlayerFaction,
        currentActionUnit: state.currentActionUnit,
        activeGeneralIndex: state.activeGeneralIndex,
        attackUsedThisTurn: state.attackUsedThisTurn,
        pendingResponse: state.pendingResponseQueue[0],
        negateWindow: state.negateWindow ? {
            trickCardName: state.negateWindow.trickCardName,
            trickTargetName: state.negateWindow.trickTargetName,
            isCurrentlyNegated: state.negateWindow.isCurrentlyNegated,
            anyoneHasNegate: state.negateWindow.anyoneHasNegate,
            startedAt: state.negateWindow.startedAt,
        } : undefined,
        roundState: state.roundState,
        harvestPool: state.harvestPool,
        log: state.log.slice(-50),
        isSpectator: true,
    }
}

/**
 * 添加日志条目
 */
export function addLog(state: GameState, text: string): void {
    state.log.push({ timestamp: Date.now(), text })
}

/**
 * 获取当前行动武将
 */
export function getActiveGeneral(state: GameState): GeneralInstance | undefined {
    return state.generals[state.activeGeneralIndex]
}

/**
 * 计算两个武将之间的距离（座位距离）
 * 3v3 标准座次：冷前A(0) → 冷主(1) → 冷前B(2) → 暖前B(3) → 暖主(4) → 暖前A(5)
 */
export function getSeatDistance(
    from: GeneralInstance,
    to: GeneralInstance,
    allGenerals: GeneralInstance[]
): number {
    const aliveSeats = allGenerals.filter((g) => g.alive)
    const fromIdx = aliveSeats.indexOf(from)
    const toIdx = aliveSeats.indexOf(to)
    if (fromIdx === -1 || toIdx === -1) return 999
    const n = aliveSeats.length
    const clockwise = (toIdx - fromIdx + n) % n
    const counterClock = (fromIdx - toIdx + n) % n
    return Math.min(clockwise, counterClock)
}

/**
 * 计算攻击范围
 * 实际攻击范围 = 武器攻击范围（默认1）- 出击方-1马加成 - 马术技能 + 防守方+1马加成 + 镇卫技能
 */
export function getAttackRange(
    attacker: GeneralInstance,
    target: GeneralInstance,
    allGenerals: GeneralInstance[]
): { inRange: boolean; distance: number; range: number } {
    const baseDist = getSeatDistance(attacker, target, allGenerals)

    // 坐骑影响
    const minusHorse = attacker.equip.minus_horse ? 1 : 0
    const plusHorse = target.equip.plus_horse ? 1 : 0

    // 马术技能：马超/庞德 → 攻击其他角色距离-1
    const mashuBonus = hasSkillOnGeneral(attacker, 'machao_mashu') || hasSkillOnGeneral(attacker, 'pangde_mashu') ? 1 : 0

    // 镇卫技能：文聘 → 对方计算与己方其他角色距离+1（仅限目标非文聘自己的己方角色受文聘保护）
    // 这里简化：如果目标方有文聘存活，且目标不是文聘自己，则距离+1
    let zhenweiBonus = 0
    const wenpinAlly = allGenerals.find(g =>
        g.alive && g !== target && g.faction === target.faction &&
        hasSkillOnGeneral(g, 'wenpin_zhenwei')
    )
    if (wenpinAlly) {
        zhenweiBonus = 1
    }

    const effectiveDist = baseDist - minusHorse - mashuBonus + plusHorse + zhenweiBonus
    const weaponRange = attacker.equip.weapon?.attackRange ?? 1

    return {
        inRange: effectiveDist <= weaponRange,
        distance: effectiveDist,
        range: weaponRange,
    }
}

/** 检查武将是否拥有某技能（含原生 + 觉醒获得） */
function hasSkillOnGeneral(general: GeneralInstance, skillId: string): boolean {
    const def = getGeneralById(general.generalId)
    const hasNative = def?.skills.some(s => s.id === skillId) ?? false
    const hasAcquired = general.acquiredSkills?.includes(skillId) ?? false
    return hasNative || hasAcquired
}

/**
 * 获取牌的有效花色（红颜：小乔的♠视为♥）
 * @param card 目标牌
 * @param owner 持有该牌的角色（可选，判定牌等无持有者时不转换）
 */
export function getEffectiveSuit(card: { suit: CardSuit }, owner?: GeneralInstance): CardSuit {
    if (owner && card.suit === CardSuit.SPADE && hasSkillOnGeneral(owner, 'xiaoqiao_hongyan')) {
        return CardSuit.HEART
    }
    return card.suit
}

/**
 * 找到武将在 generals 数组中的下标
 */
export function findGeneralIndex(
    state: GameState,
    generalId: string
): number {
    return state.generals.findIndex((g) => g.generalId === generalId)
}

/**
 * 重置一个行动单元内所有武将的 hasActed 标志
 */
export function resetActedFlags(state: GameState, faction: Faction): void {
    state.generals
        .filter((g) => g.faction === faction)
        .forEach((g) => (g.hasActed = false))
}

/**
 * 判断游戏是否结束
 * 任意一方主帅阵亡 → 立即结束
 */
export function checkGameOver(
    state: GameState
): { over: boolean; winnerFaction?: Faction; reason?: string } {
    const warmCommander = state.generals.find(
        (g) => g.faction === Faction.WARM && g.seatRole === SeatRole.COMMANDER
    )
    const coolCommander = state.generals.find(
        (g) => g.faction === Faction.COOL && g.seatRole === SeatRole.COMMANDER
    )

    if (!warmCommander?.alive) {
        return {
            over: true,
            winnerFaction: Faction.COOL,
            reason: '暖色方主帅阵亡',
        }
    }
    if (!coolCommander?.alive) {
        return {
            over: true,
            winnerFaction: Faction.WARM,
            reason: '冷色方主帅阵亡',
        }
    }
    return { over: false }
}
