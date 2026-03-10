import {
    GameState,
    Faction,
    TurnPhase,
    ActionUnitType,
    SeatRole,
    GeneralInstance,
    Card,
    CardSuit,
    TrickCardName,
    ResponseType,
    CardCategory,
} from 'sgs3v3-shared'
import { drawCards } from '../rooms/room-manager'
import { addLog, getActiveGeneral, resetActedFlags } from './game-state'
import { getGeneralById } from './generals'

// ─────────────────────────────────────────────────────────────
// 大回合管理
// ─────────────────────────────────────────────────────────────
//
// currentActionStep 语义：
//   0 = 等待先手方选择行动单元
//   1 = 先手方第一行动单元执行中
//   2 = 等待后手方选择行动单元（先手第一单元刚结束）
//   3 = 后手方第一行动单元执行中
//   4 = 先手方剩余行动单元执行中
//   5 = 后手方剩余行动单元执行中
// ─────────────────────────────────────────────────────────────

/**
 * 冷色方选择 先手/让先（仅在第1大回合之前调用一次）
 */
export function handleYieldChoice(
    state: GameState,
    playerId: string,
    yield_first: boolean,
): { error: string } | void {
    const rs = state.roundState
    if (!rs.waitingForYield) return { error: '当前不是选择先手/让先的时机' }

    const player = state.players[playerId]
    if (!player) return { error: '玩家不存在' }
    if (player.faction !== Faction.COOL) return { error: '只有冷色方可以选择先手/让先' }

    rs.waitingForYield = false
    rs.yieldedFirst = yield_first

    if (yield_first) {
        rs.firstMover = Faction.WARM
        addLog(state, `冷色方选择【让先】，暖色方为先手方`)
    } else {
        rs.firstMover = Faction.COOL
        addLog(state, `冷色方选择【先手】，冷色方为先手方`)
    }

    // 开始第1大回合
    startNewRound(state)
}

/**
 * 开始一个新的大回合 —— 等待先手方选择行动单元
 */
export function startNewRound(state: GameState): void {
    const rs = state.roundState
    rs.roundNumber++
    rs.currentActionStep = 0
    rs.firstMoverChoice = undefined
    rs.secondMoverChoice = undefined
    rs.firstMoverFlankOrder = undefined
    rs.secondMoverFlankOrder = undefined

    // 暖主保护轮：若暖色方只剩主帅存活，暖色方自动先手（临时覆盖）
    const warmAlive = state.generals.filter(g => g.faction === Faction.WARM && g.alive)
    const warmOnlyCommander = warmAlive.length === 1 && warmAlive[0].seatRole === SeatRole.COMMANDER
    if (warmOnlyCommander && rs.firstMover !== Faction.WARM) {
        rs.firstMover = Faction.WARM
        addLog(state, `暖主保护轮！暖色方自动成为先手`)
    }

    resetActedFlags(state, Faction.WARM)
    resetActedFlags(state, Faction.COOL)

    // 清除忠义效果（"至本轮结束"）
    for (const g of state.generals) {
        if (g.loyaltyCard) {
            state.discard.push(g.loyaltyCard)
            g.loyaltyCard = undefined
        }
    }

    addLog(state, `═══ 第 ${rs.roundNumber} 大回合开始 ═══ 先手方：${factionName(rs.firstMover)}`)

    // 等待先手方选择
    state.activePlayerFaction = rs.firstMover
    state.currentActionUnit = undefined
    state.activeGeneralIndex = -1
    state.turnPhase = TurnPhase.TURN_START
}

/**
 * 玩家选择行动单元
 *
 * Step 0 → 先手选择 → 进入 step 1（先手第一单元执行）
 * Step 2 → 后手选择 → 进入 step 3（后手第一单元执行）
 */
export function chooseActionUnit(
    state: GameState,
    playerId: string,
    unit: ActionUnitType,
    flankOrder?: number[]
): { error: string } | void {
    const rs = state.roundState
    const player = state.players[playerId]
    if (!player?.faction) return { error: '玩家不存在' }

    const faction = player.faction
    const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM

    // ── 先手方选择（step 0）
    if (rs.currentActionStep === 0) {
        if (faction !== rs.firstMover) return { error: '等待先手方选择' }

        const err = validateUnitChoice(state, faction, unit)
        if (err) return err

        rs.firstMoverChoice = unit
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            rs.firstMoverFlankOrder = flankOrder
        }

        addLog(state, `${factionName(faction)}选择${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}先行动`)

        // 进入 step 1：执行先手第一单元
        rs.currentActionStep = 1
        executeCurrentStep(state)
        return
    }

    // ── 后手方选择（step 2）
    if (rs.currentActionStep === 2) {
        if (faction !== secondMover) return { error: '等待后手方选择' }

        const err = validateUnitChoice(state, faction, unit)
        if (err) return err

        rs.secondMoverChoice = unit
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            rs.secondMoverFlankOrder = flankOrder
        }

        addLog(state, `${factionName(faction)}选择${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}先行动`)

        // 进入 step 3：执行后手第一单元
        rs.currentActionStep = 3
        executeCurrentStep(state)
        return
    }

    // ── step 4/5：剩余单元是边锋时的边锋顺序选择
    if (rs.currentActionStep === 4 || rs.currentActionStep === 5) {
        const expectedFaction = rs.currentActionStep === 4 ? rs.firstMover : secondMover
        if (faction !== expectedFaction) return { error: '等待对方选择' }

        // 此时 unit 应该是 FLANKS（从客户端传来的是 FLANKS + flankOrder）
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            if (rs.currentActionStep === 4) {
                rs.firstMoverFlankOrder = flankOrder
            } else {
                rs.secondMoverFlankOrder = flankOrder
            }
        }

        addLog(state, `${factionName(faction)}选择了边锋行动顺序`)
        executeCurrentStep(state)
        return
    }

    return { error: '当前不是选择行动单元的时机' }
}

/** 验证行动单元选择是否有效 */
function validateUnitChoice(
    state: GameState,
    faction: Faction,
    unit: ActionUnitType
): { error: string } | undefined {
    const rs = state.roundState

    // 第1大回合，先手方只能选主帅
    if (rs.roundNumber === 1 && faction === rs.firstMover && unit === ActionUnitType.FLANKS) {
        return { error: '第一大回合先手方只能选择主帅先行动' }
    }

    if (unit === ActionUnitType.FLANKS) {
        const flanks = state.generals.filter(
            g => g.faction === faction &&
                (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
                g.alive
        )
        if (flanks.length === 0) return { error: '没有存活的边锋，只能选主帅' }
    } else {
        const cmd = state.generals.find(
            g => g.faction === faction && g.seatRole === SeatRole.COMMANDER && g.alive
        )
        if (!cmd) return { error: '主帅已阵亡' }
    }
    return undefined
}

/**
 * 根据当前 step 执行对应的行动单元
 *
 *   step 1 → 先手方第一选择单元
 *   step 3 → 后手方第一选择单元
 *   step 4 → 先手方剩余单元
 *   step 5 → 后手方剩余单元
 */
function executeCurrentStep(state: GameState): void {
    const rs = state.roundState
    const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM

    let faction: Faction
    let unit: ActionUnitType
    let flankOrder: number[] | undefined

    switch (rs.currentActionStep) {
        case 1:
            faction = rs.firstMover
            unit = rs.firstMoverChoice!
            flankOrder = rs.firstMoverFlankOrder
            break
        case 3:
            faction = secondMover
            unit = rs.secondMoverChoice!
            flankOrder = rs.secondMoverFlankOrder
            break
        case 4:
            faction = rs.firstMover
            unit = rs.firstMoverChoice === ActionUnitType.COMMANDER
                ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
            flankOrder = rs.firstMoverFlankOrder
            break
        case 5:
            faction = secondMover
            unit = rs.secondMoverChoice === ActionUnitType.COMMANDER
                ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
            flankOrder = rs.secondMoverFlankOrder
            break
        default:
            // 所有步骤执行完毕
            startNewRound(state)
            return
    }

    // 如果该单元没有存活角色，直接跳过
    const candidates = getUnitCandidates(state, faction, unit, flankOrder)
    if (candidates.length === 0) {
        advanceStep(state)
        return
    }

    // step 4/5 的边锋行动：如果有多个存活边锋且没有 flankOrder，需要让用户选择顺序
    if ((rs.currentActionStep === 4 || rs.currentActionStep === 5) && unit === ActionUnitType.FLANKS) {
        const aliveFlanks = state.generals.filter(
            g => g.faction === faction &&
                (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
                g.alive
        )
        if (aliveFlanks.length > 1 && !flankOrder) {
            // 暂停，等待用户选择边锋顺序
            state.activePlayerFaction = faction
            state.currentActionUnit = undefined
            state.activeGeneralIndex = -1
            addLog(state, `${factionName(faction)}请选择边锋行动顺序`)
            return
        }
    }

    state.activePlayerFaction = faction
    state.currentActionUnit = unit
    state.activeGeneralIndex = state.generals.indexOf(candidates[0])

    addLog(state, `${factionName(faction)}的${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}行动`)
    runTurnStart(state)
}

/**
 * 当前行动单元完成后推进到下一步
 * step 1 结束 → step 2（等待后手选择）
 * step 3 结束 → step 4（先手剩余）
 * step 4 结束 → step 5（后手剩余）
 * step 5 结束 → 下一大回合
 */
function advanceStep(state: GameState): void {
    const rs = state.roundState

    if (rs.currentActionStep === 1) {
        // 先手第一单元结束 → 等待后手选择
        rs.currentActionStep = 2
        const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM
        state.activePlayerFaction = secondMover
        state.currentActionUnit = undefined
        state.activeGeneralIndex = -1
        addLog(state, `${factionName(secondMover)}请选择行动单元`)
        return
    }

    // 其他步骤直接递进
    rs.currentActionStep++
    executeCurrentStep(state)
}

/** 获取行动单元内的候选武将（按顺序，排除已行动的） */
function getUnitCandidates(
    state: GameState,
    faction: Faction,
    unit: ActionUnitType,
    flankOrder?: number[]
): GeneralInstance[] {
    if (unit === ActionUnitType.COMMANDER) {
        return state.generals.filter(
            g => g.faction === faction && g.seatRole === SeatRole.COMMANDER && g.alive && !g.hasActed
        )
    }

    const flanks = state.generals.filter(
        g => g.faction === faction &&
            (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
            g.alive && !g.hasActed
    )

    if (flankOrder && flankOrder.length > 0) {
        flanks.sort((a, b) => {
            const ai = flankOrder.indexOf(state.generals.indexOf(a))
            const bi = flankOrder.indexOf(state.generals.indexOf(b))
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
    }

    return flanks
}

// ─────────────────────────────────────────────────────────────
// 武将回合管理
// ─────────────────────────────────────────────────────────────

/** 武将回合开始：准备 → 判定 → 摸牌 → 出牌 */
export function runTurnStart(state: GameState): void {
    const general = getActiveGeneral(state)
    if (!general) return

    const name = getGeneralName(general)
    addLog(state, `【${name}】回合开始`)
    state.turnPhase = TurnPhase.TURN_START
    state.attackUsedThisTurn = 0
    general.skillsUsedThisTurn = []
    general.rendeGivenThisTurn = 0
    general.rendeHealedThisTurn = false

    // ── 准备阶段被动

    // 洛神（甄姬）：判定若黑色获得此牌，可选择继续判定（支持鬼才/缓释介入）
    if (hasSkillById(general, 'zhenji_luoshen') && state.deck.length > 0) {
        const judgeCard = state.deck.shift()!
        state.discard.push(judgeCard)
        addLog(state, `【${name}】的【洛神】判定：${suitName(judgeCard.suit)}${valueName(judgeCard.value)}`)

        // 检查鬼才/缓释介入
        const intervenor = findJudgeIntervenor(state, general)
        if (intervenor) {
            state.pendingResponseQueue.push({
                type: ResponseType.JUDGE_INTERVENE,
                targetGeneralIndex: state.generals.indexOf(intervenor),
                context: {
                    judgeType: 'luoshen',
                    judgingGeneralIndex: state.generals.indexOf(general),
                    judgeCardId: judgeCard.id,
                    judgeName: '洛神',
                },
            })
            const skillName = hasSkillById(intervenor, 'simayi_guicai') ? '鬼才' : '缓释'
            addLog(state, `【${getGeneralName(intervenor)}】可发动【${skillName}】修改判定`)
        } else {
            // 无人介入，直接结算
            const isBlack = judgeCard.suit === CardSuit.SPADE || judgeCard.suit === CardSuit.CLUB
            if (isBlack) {
                const discardIdx = state.discard.indexOf(judgeCard)
                if (discardIdx >= 0) state.discard.splice(discardIdx, 1)
                general.hand.push(judgeCard)
                addLog(state, `【${name}】【洛神】判定黑色！获得此牌`)
                if (state.deck.length > 0) {
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(general),
                        context: {
                            skillId: 'zhenji_luoshen_continue',
                            skillName: '洛神',
                            description: '继续判定',
                        },
                    })
                }
            } else {
                addLog(state, `【${name}】【洛神】判定红色，停止`)
                checkTiandu(state, general, judgeCard)
            }
        }
    }

    // 志继（姜维觉醒技）：准备阶段无手牌→减1体力上限→获得观星→选择回1血或摸2牌
    if (hasSkillById(general, 'jiangwei_zhiji') && !general.awakened && general.hand.length === 0) {
        general.awakened = true
        general.maxHp -= 1
        if (general.hp > general.maxHp) general.hp = general.maxHp
        general.acquiredSkills.push('zhugeliang_guanxing')
        addLog(state, `【${name}】发动【志继】觉醒！减1体力上限，获得【观星】`)

        // 让玩家选择：回1血 或 摸2牌
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'jiangwei_zhiji_choice',
                skillName: '志继',
                description: '选择回复1点体力 或 摸2张牌',
            },
        })
    }

    // 魂姿（孙策觉醒技）：准备阶段，体力1→减1上限获得英姿+英魂
    if (hasSkillById(general, 'sunce_hunzi') && !general.awakened && general.hp === 1) {
        general.awakened = true
        general.maxHp -= 1
        if (general.hp > general.maxHp) general.hp = general.maxHp
        general.acquiredSkills.push('zhouyu_yingzi', 'sunjian_yinghun')
        addLog(state, `【${name}】发动【魂姿】觉醒！减1体力上限，获得【英姿】和【英魂】`)
    }

    // 英魂（孙坚）：准备阶段已受伤时→选一名其他角色+选模式（摸X弃1 / 摸1弃X，X=损失体力）
    if (hasSkillById(general, 'sunjian_yinghun') && general.hp < general.maxHp) {
        const others = state.generals.filter(g => g.alive && g !== general)
        if (others.length > 0) {
            const lostHp = general.maxHp - general.hp
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_YINGHUN_CHOOSE,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    lostHp,
                },
            })
        }
    }

    // ── 弘援（诸葛瑾）：准备阶段询问，是否少摸1张让友方各摸1张
    if (hasSkillById(general, 'zhugejin_hongyuan')) {
        const allies = state.generals.filter(g => g.alive && g.faction === general.faction && g !== general)
        if (allies.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhugejin_hongyuan',
                    skillName: '弘援',
                    description: '自己摸1张牌，至多2名己方角色各摸1张',
                },
            })
        }
    }

    // ── 观星（诸葛亮）：准备阶段，观看牌堆顶X张（X=存活角色数，最多5），分配至牌堆顶/底
    if (hasSkillById(general, 'zhugeliang_guanxing') || general.acquiredSkills.includes('zhugeliang_guanxing')) {
        const alive = state.generals.filter(g => g.alive).length
        const count = Math.min(alive, 5, state.deck.length)
        if (count > 0) {
            const cards = state.deck.splice(0, count)
            // 暂存观星牌到 context 中
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_GUANXING_ARRANGE,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    guanxingCards: cards,
                },
            })
            addLog(state, `【${name}】发动【观星】，观看了${count}张牌`)
        }
    }

    // ── 如果准备阶段有待处理的技能（洛神/观星/英魂等），等待完成后再继续
    // 完成后由各响应 handler 中的 continueFromPrepPhase() 推进到判定阶段
    if (state.pendingResponseQueue.length > 0) {
        return
    }

    // ── 神速（夏侯渊）：回合开始选择跳阶段视为杀
    if (hasSkillById(general, 'xiahoyuan_shensu')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'xiahoyuan_shensu_1',
                skillName: '神速一',
                description: '跳过判定和摸牌阶段，视为对一名角色使用一张杀',
            },
        })
        return // 等待响应，后续由 handler 继续推进回合
    }

    // ── 判定阶段
    state.turnPhase = TurnPhase.JUDGE
    const { skipAction, skipDraw } = runJudgePhase(state, general)

    // 如果判定被鬼才/缓释中断，等待玩家响应后由 continueJudgePhase 继续
    if (state.pendingResponseQueue.length > 0 && state.pendingResponseQueue[0].type === ResponseType.JUDGE_INTERVENE) {
        return
    }

    // ── 摸牌阶段
    if (!skipDraw) {
        state.turnPhase = TurnPhase.DRAW

        // 突袭（张辽）：可改为获取至多2名角色的各一张手牌
        // 突袭（张辽）：可选择发动，获取至多2名有手牌角色的各一张手牌（代替摸牌）
        if (hasSkillById(general, 'zhangliao_tuxi')) {
            const oppWithCards = state.generals.filter(
                g => g.alive && g.faction !== general.faction && g.hand.length > 0
            )
            if (oppWithCards.length > 0) {
                // 先让玩家选择是否发动突袭
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'zhangliao_tuxi',
                        skillName: '突袭',
                        description: `代替摸牌，获取至多2名角色的各一张手牌`,
                        skipAction,
                    },
                })
                return // 等待玩家响应，后续由 handleRespond 继续
            } else {
                // 无人可偷，正常摸牌
                const drawn = drawCards(state, 2)
                general.hand.push(...drawn)
                addLog(state, `【${name}】摸了 ${drawn.length} 张牌`)
            }
        } else {
            let drawCount = 2
            // 英姿（周瑜锁定技）：多摸 1 张
            if (hasYingziSkill(general)) {
                drawCount = 3
            }

            // 弘援（诸葛瑾）：准备阶段选择了弘援，自己只摸1张，友方各摸1张
            if ((general as any).hongyuanActivated) {
                delete (general as any).hongyuanActivated
                const drawn = drawCards(state, 1)
                general.hand.push(...drawn)
                addLog(state, `【${name}】发动【弘援】，自己摸了1张牌`)

                const allies = state.generals.filter(g => g.alive && g.faction === general.faction && g !== general)
                const shareCount = Math.min(2, allies.length)
                for (let i = 0; i < shareCount; i++) {
                    const bonus = drawCards(state, 1)
                    allies[i].hand.push(...bonus)
                    addLog(state, `【${getGeneralName(allies[i])}】因【弘援】摸了1张牌`)
                }
            } else {
                const drawn = drawCards(state, drawCount)
                general.hand.push(...drawn)
                addLog(state, `【${name}】摸了 ${drawn.length} 张牌${drawCount > 2 ? '（英姿+1）' : ''}`)
            }
        }
    }

    // ── 出牌阶段 / 直接弃牌
    if (!skipAction) {
        state.turnPhase = TurnPhase.ACTION

        // 神速二：出牌阶段开始时询问是否跳过出牌弃装备视为杀
        if (hasSkillById(general, 'xiahoyuan_shensu')) {
            const hasEquip = general.equip.weapon || general.equip.armor || general.equip.plus_horse || general.equip.minus_horse
            const hasHandEquip = general.hand.some(c => c.category === CardCategory.EQUIPMENT)
            if (hasEquip || hasHandEquip) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'xiahoyuan_shensu_2',
                        skillName: '神速二',
                        description: '跳过出牌阶段并弃一张装备牌，视为对一名角色使用一张杀',
                    },
                })
            }
        }
    } else {
        state.turnPhase = TurnPhase.DISCARD
        if (general.hand.length <= general.hp) {
            finishTurn(state)
        }
    }
}

/**
 * 从判定阶段开始继续执行回合（用于神速等跳阶段技能）
 * @param skipJudge 是否跳过判定阶段
 * @param skipDraw 是否跳过摸牌阶段
 * @param skipAction 是否跳过出牌阶段
 */
export function continueTurnFromJudge(
    state: GameState,
    skipJudge: boolean,
    extraSkipDraw: boolean,
    extraSkipAction: boolean,
): void {
    const general = getActiveGeneral(state)
    if (!general) return
    const name = getGeneralName(general)

    let skipAction = extraSkipAction
    let skipDraw = extraSkipDraw

    // ── 判定阶段
    if (!skipJudge) {
        state.turnPhase = TurnPhase.JUDGE
        const judgeResult = runJudgePhase(state, general)

        if (state.pendingResponseQueue.length > 0 && state.pendingResponseQueue[0].type === ResponseType.JUDGE_INTERVENE) {
            return
        }

        if (judgeResult.skipAction) skipAction = true
        if (judgeResult.skipDraw) skipDraw = true
    }

    // ── 摸牌阶段
    if (!skipDraw) {
        state.turnPhase = TurnPhase.DRAW
        let drawCount = 2
        if (hasYingziSkill(general)) drawCount = 3
        const drawn = drawCards(state, drawCount)
        general.hand.push(...drawn)
        addLog(state, `【${name}】摸了 ${drawn.length} 张牌${drawCount > 2 ? '（英姿+1）' : ''}`)
    }

    // ── 出牌阶段
    if (!skipAction) {
        state.turnPhase = TurnPhase.ACTION

        // 神速二：出牌阶段开始时询问
        if (hasSkillById(general, 'xiahoyuan_shensu')) {
            const hasEquip = general.equip.weapon || general.equip.armor || general.equip.plus_horse || general.equip.minus_horse
            const hasHandEquip = general.hand.some(c => c.category === CardCategory.EQUIPMENT)
            if (hasEquip || hasHandEquip) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'xiahoyuan_shensu_2',
                        skillName: '神速二',
                        description: '跳过出牌阶段并弃一张装备牌，视为对一名角色使用一张杀',
                    },
                })
            }
        }
    } else {
        state.turnPhase = TurnPhase.DISCARD
        if (general.hand.length <= general.hp) {
            finishTurn(state)
        }
    }
}

/**
 * 准备阶段技能全部完成后，继续推进回合到判定阶段。
 * 由各准备阶段响应 handler（观星、洛神、英魂等）在 shift() 后调用。
 */
export function continueFromPrepPhase(state: GameState): void {
    // 队列中还有其他准备阶段技能待处理，不推进
    if (state.pendingResponseQueue.length > 0) return
    // 只在准备阶段调用此函数
    if (state.turnPhase !== TurnPhase.TURN_START) return

    const general = getActiveGeneral(state)
    if (!general) return

    // 神速（夏侯渊）：准备阶段技能结束后，仍需询问神速
    if (hasSkillById(general, 'xiahoyuan_shensu')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'xiahoyuan_shensu_1',
                skillName: '神速一',
                description: '跳过判定和摸牌阶段，视为对一名角色使用一张杀',
            },
        })
        return // 等待神速响应，后续由 handler 继续推进回合
    }

    // 直接进入判定阶段
    continueTurnFromJudge(state, false, false, false)
}

/** 判定阶段：处理判定区延时锦囊（后放先判）
 * 如果有鬼才/缓释可介入，会设置 PendingResponse 中断流程，
 * 后续由 continueJudgePhase 继续结算。
 */
function runJudgePhase(
    state: GameState,
    general: GeneralInstance
): { skipAction: boolean; skipDraw: boolean } {
    if (general.judgeZone.length === 0) return { skipAction: false, skipDraw: false }

    const toJudge = [...general.judgeZone].reverse()
    return processNextJudge(state, general, toJudge, 0, false, false)
}

/** 处理一张延时锦囊的判定（递归逻辑拆分，支持中断+继续） */
function processNextJudge(
    state: GameState,
    general: GeneralInstance,
    toJudge: Card[],
    judgeIndex: number,
    skipAction: boolean,
    skipDraw: boolean,
): { skipAction: boolean; skipDraw: boolean } {
    if (judgeIndex >= toJudge.length) return { skipAction, skipDraw }
    if (state.deck.length === 0) return { skipAction, skipDraw }

    const card = toJudge[judgeIndex]
    const judgeCard = state.deck.shift()!
    state.discard.push(judgeCard)

    const name = getGeneralName(general)
    addLog(state, `【${name}】的【${card.name}】判定：${suitName(judgeCard.suit)}${valueName(judgeCard.value)}`)

    // 检查是否有鬼才/缓释可介入
    const intervenor = findJudgeIntervenor(state, general)
    if (intervenor) {
        // 中断判定流程 → 让介入者选择是否替换
        state.pendingResponseQueue.unshift({
            type: ResponseType.JUDGE_INTERVENE,
            targetGeneralIndex: state.generals.indexOf(intervenor),
            context: {
                judgingGeneralIndex: state.generals.indexOf(general),
                judgeCardId: judgeCard.id,
                delayedTrickCardId: card.id,
                delayedTrickName: card.name,
                // 存储继续判定所需的上下文
                toJudgeCardIds: toJudge.map(c => c.id),
                currentJudgeIndex: judgeIndex,
                skipAction,
                skipDraw,
            },
        })
        addLog(state, `【${getGeneralName(intervenor)}】可发动【${hasSkillById(intervenor, 'simayi_guicai') ? '鬼才' : '缓释'}】修改判定`)
        return { skipAction, skipDraw } // 暂时返回，后续由 continueJudgePhase 继续
    }

    // 无人介入 → 直接结算判定结果
    const result = resolveJudge(state, general, card, judgeCard, skipAction, skipDraw)

    // 继续处理下一张延时锦囊
    return processNextJudge(state, general, toJudge, judgeIndex + 1, result.skipAction, result.skipDraw)
}

/** 结算一张延时锦囊的判定效果 */
function resolveJudge(
    state: GameState,
    general: GeneralInstance,
    delayedCard: Card,
    judgeCard: Card,
    skipAction: boolean,
    skipDraw: boolean,
): { skipAction: boolean; skipDraw: boolean } {
    const isHeart = judgeCard.suit === CardSuit.HEART
    const isClub = judgeCard.suit === CardSuit.CLUB
    const name = getGeneralName(general)

    if (delayedCard.name === TrickCardName.OVERINDULGENCE) {
        if (!isHeart) {
            addLog(state, `【${name}】乐不思蜀生效，跳过出牌阶段`)
            skipAction = true
        } else {
            addLog(state, `【${name}】乐不思蜀判定♥，解除`)
        }
        general.judgeZone = general.judgeZone.filter(c => c.id !== delayedCard.id)
        state.discard.push(delayedCard)
        checkTiandu(state, general, judgeCard)
    } else if (delayedCard.name === TrickCardName.SUPPLY_SHORTAGE) {
        if (!isClub) {
            addLog(state, `【${name}】兵粮寸断生效，跳过摸牌阶段`)
            skipDraw = true
        } else {
            addLog(state, `【${name}】兵粮寸断判定♣，解除`)
        }
        general.judgeZone = general.judgeZone.filter(c => c.id !== delayedCard.id)
        state.discard.push(delayedCard)
        checkTiandu(state, general, judgeCard)
    }

    return { skipAction, skipDraw }
}

/** 查找可以介入判定的角色（鬼才/缓释），从判定者开始逆时针询问，excludeIndices 是已拒绝者的下标列表 */
export function findJudgeIntervenor(state: GameState, judgingGeneral: GeneralInstance, excludeIndices: number[] = []): GeneralInstance | null {
    const hasCards = (g: GeneralInstance) =>
        g.hand.length > 0 || Object.values(g.equip).some(Boolean)

    const judgingIdx = state.generals.indexOf(judgingGeneral)
    const n = state.generals.length

    // 从判定者开始，逆时针遍历所有角色（包括判定者自身）
    for (let i = 0; i < n; i++) {
        const idx = ((judgingIdx - i) % n + n) % n // 逆时针
        const g = state.generals[idx]
        if (!g.alive) continue
        if (!hasCards(g)) continue
        if (excludeIndices.includes(idx)) continue

        // 鬼才：可以改任何人的判定
        if (hasSkillById(g, 'simayi_guicai')) return g
        // 缓释：只能改己方角色的判定
        if (hasSkillById(g, 'zhugejin_huanshi') && g.faction === judgingGeneral.faction) return g
    }
    return null
}

/**
 * 判定介入处理完成后，继续判定流程
 * 由 handleRespond 的 JUDGE_INTERVENE case 调用
 */
export function continueJudgePhase(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeCard: Card,
    delayedCard: Card,
    toJudgeCardIds: string[],
    currentJudgeIndex: number,
    skipAction: boolean,
    skipDraw: boolean,
): void {
    // 结算当前判定
    const result = resolveJudge(state, judgingGeneral, delayedCard, judgeCard, skipAction, skipDraw)

    // 重建 toJudge 列表
    const toJudge = toJudgeCardIds
        .map(id => judgingGeneral.judgeZone.find(c => c.id === id))
        .filter((c): c is Card => !!c)

    // 继续下一张
    const finalResult = processNextJudge(
        state, judgingGeneral, toJudge, currentJudgeIndex + 1,
        result.skipAction, result.skipDraw
    )

    // 如果没有被新的介入打断，继续回合流程
    if (state.pendingResponseQueue.length === 0 || state.pendingResponseQueue[0].type !== ResponseType.JUDGE_INTERVENE) {
        // 重用 continueTurnFromJudge 的摸牌/出牌逻辑（包含弘援、突袭等技能检查）
        // skipJudge=true（判定已结算完），传入 skipDraw 和 skipAction
        continueTurnFromJudge(state, true, finalResult.skipDraw, finalResult.skipAction)
    }
}

/** 天妒（郭嘉）：判定牌生效后将该牌加入手牌 */
function checkTiandu(state: GameState, general: GeneralInstance, judgeCard: Card): void {
    const def = getGeneralById(general.generalId)
    if (def?.skills.some(s => s.id === 'guojia_tiandu')) {
        const idx = state.discard.indexOf(judgeCard)
        if (idx >= 0) {
            state.discard.splice(idx, 1)
            general.hand.push(judgeCard)
            const name = def?.name ?? general.generalId
            addLog(state, `【${name}】发动【天妒】，获得判定牌`)
        }
    }
}

/** 结束出牌阶段，进入弃牌 */
export function handleEndTurn(
    state: GameState,
    playerId: string
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) return { error: '不是你的回合' }
    if (state.turnPhase !== TurnPhase.ACTION) return { error: '当前不是出牌阶段' }

    state.turnPhase = TurnPhase.DISCARD
    if (general.hand.length <= general.hp) {
        finishTurn(state)
    }
}

/** 弃牌处理 */
export function handleDiscard(
    state: GameState,
    playerId: string,
    cardIds: string[]
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) return { error: '不是你的回合' }
    if (state.turnPhase !== TurnPhase.DISCARD) return { error: '现在不是弃牌阶段' }

    const handLimit = general.hp
    const mustDiscard = general.hand.length - handLimit

    if (mustDiscard <= 0) {
        finishTurn(state)
        return
    }

    if (cardIds.length !== mustDiscard) {
        return { error: `需要弃置 ${mustDiscard} 张牌` }
    }

    for (const id of cardIds) {
        const idx = general.hand.findIndex(c => c.id === id)
        if (idx === -1) return { error: `手牌中没有牌 ${id}` }
        state.discard.push(general.hand.splice(idx, 1)[0])
    }

    addLog(state, `【${getGeneralName(general)}】弃置了 ${mustDiscard} 张牌`)
    finishTurn(state)
}

/** 完成当前武将的回合，推进到同行动单元内下一武将，或推进大回合步骤 */
export function finishTurn(state: GameState): void {
    const general = getActiveGeneral(state)
    if (general) {
        // 闭月（貂蝉）：结束阶段摸1牌
        if (hasSkillById(general, 'diaochan_biyue')) {
            const drawn = drawCards(state, 1)
            general.hand.push(...drawn)
            addLog(state, `【${getGeneralName(general)}】发动【闭月】摸1张牌`)
        }

        general.hasActed = true
        state.turnPhase = TurnPhase.TURN_END
        addLog(state, `【${getGeneralName(general)}】回合结束`)
    }

    const faction = state.activePlayerFaction
    const unit = state.currentActionUnit!

    // 边锋行动单元：检查还有无未行动的边锋
    if (unit === ActionUnitType.FLANKS) {
        const rs = state.roundState
        const flankOrder =
            rs.currentActionStep === 1 ? rs.firstMoverFlankOrder :
                rs.currentActionStep === 3 ? rs.secondMoverFlankOrder :
                    undefined

        const nexts = getUnitCandidates(state, faction, unit, flankOrder)
        if (nexts.length > 0) {
            state.activeGeneralIndex = state.generals.indexOf(nexts[0])
            runTurnStart(state)
            return
        }
    }

    // 行动单元结束，推进到下一步
    advanceStep(state)
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function hasYingziSkill(general: GeneralInstance): boolean {
    return hasSkillById(general, 'zhouyu_yingzi') || hasSkillById(general, 'sunce_yingzi')
}

/** 检查武将是否拥有某技能（含原生技能 + 觉醒后获得的技能） */
function hasSkillById(general: GeneralInstance, skillId: string): boolean {
    const def = getGeneralById(general.generalId)
    const hasNative = def?.skills.some(s => s.id === skillId) ?? false
    const hasAcquired = general.acquiredSkills?.includes(skillId) ?? false
    return hasNative || hasAcquired
}

function getGeneralName(general: GeneralInstance): string {
    const def = getGeneralById(general.generalId)
    return def?.name ?? general.generalId
}

function factionName(f: Faction): string {
    return f === Faction.WARM ? '暖色方' : '冷色方'
}

function suitName(suit: CardSuit): string {
    const map: Record<string, string> = {
        spade: '♠', heart: '♥', club: '♣', diamond: '♦',
    }
    return map[suit] ?? suit
}

function valueName(value: number): string {
    const map: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }
    return map[value] ?? String(value)
}
