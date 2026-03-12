import {
    GameState,
    GeneralInstance,
    Card,
    TurnPhase,
    ResponseType,
    PendingResponse,
    BasicCardName,
    TrickCardName,
    TrickType,
    EquipSlot,
    CardSuit,
    Faction,
    C2S_UseCard,
    C2S_UseSkill,
    C2S_Respond,
    CardCategory,
    EquipmentCardName,
    SeatRole,
} from 'sgs3v3-shared'
import { addLog, getActiveGeneral, checkGameOver, getAttackRange } from './game-state'
import { drawCards } from '../rooms/room-manager'
import { getGeneralById } from './generals'
import { continueJudgePhase, continueTurnFromJudge, continueFromPrepPhase, findJudgeIntervenor, finishTurn, continueDelayedTrickJudge } from './turn-manager'

/** 检查是否触发雌雄双股剑，如是则 unshift 确认到 pendingResponseQueue */
function maybeDoubleSwords(state: GameState, attackerIdx: number, targetIdx: number): void {
    const attacker = state.generals[attackerIdx]
    const target = state.generals[targetIdx]
    if (!attacker || !target) return
    if (attacker.equip.weapon?.name !== EquipmentCardName.DOUBLE_SWORDS) return
    const attackerDef = getGeneralById(attacker.generalId)
    const targetDef = getGeneralById(target.generalId)
    if (attackerDef && targetDef && attackerDef.gender !== targetDef.gender) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: attackerIdx,
            context: {
                skillId: 'equip_double_swords',
                skillName: '雌雄双股剑',
                description: `对异性【${getGeneralName(target)}】出杀，令其弃1牌或你摸1牌`,
                targetIndex: targetIdx,
            },
        })
    }
}


// ─────────────────────────────────────────────────────────────
// 无懈可击核心逻辑
// ─────────────────────────────────────────────────────────────

/** 检查所有武将中是否有人持有无懈可击 */
export function anyoneHasNegate(state: GameState): boolean {
    return state.generals.some(g => g.alive && g.hand.some(c => c.name === TrickCardName.NEGATE))
}

/** 延迟锦囊效果定义 */
interface DeferredTrickEffect {
    type: string
    userIndex: number
    targetIndex: number
    triggerJizhi: boolean
    extra?: any
}

/**
 * 在锦囊效果前打开无懈可击窗口。
 * @returns true 表示已打开窗口（效果被延迟），false 表示直接跳过（不开窗口直接执行）
 */
function pushNegateCheck(
    state: GameState,
    trickCardName: string,
    trickUserIndex: number,
    trickTargetIndex: number,
    trickTargetName: string,
    deferredEffect?: DeferredTrickEffect,
    hasFollowUpResponse?: boolean,
): boolean {
    const hasNegate = anyoneHasNegate(state)

    // 无论有没有人有无懈都要开窗口（没人有时3秒后自动结算）
    state.negateWindow = {
        trickCardName,
        trickUserIndex,
        trickTargetIndex,
        trickTargetName,
        isCurrentlyNegated: false,
        deferredEffect,
        hasFollowUpResponse: hasFollowUpResponse ?? false,
        passedPlayerIds: [],
        startedAt: Date.now(),
        anyoneHasNegate: hasNegate,
    }

    addLog(state, `询问无懈可击...（${cardDisplayName({ name: trickCardName } as any)} → ${trickTargetName}）`)
    return true
}

/** 执行被延迟的锦囊效果 */
function executeDeferredTrickEffect(state: GameState, effect: DeferredTrickEffect): void {
    const user = state.generals[effect.userIndex]
    const target = effect.targetIndex >= 0 ? state.generals[effect.targetIndex] : null

    switch (effect.type) {
        case 'draw_two': {
            const myAlive = state.generals.filter(g => g.faction === user.faction && g.alive).length
            const oppAlive = state.generals.filter(g => g.faction !== user.faction && g.alive).length
            const drawCount = oppAlive > myAlive ? 3 : 2
            const drawn = drawCards(state, drawCount)
            user.hand.push(...drawn)
            addLog(state, `【${getGeneralName(user)}】【无中生有】摸了 ${drawCount} 张牌${oppAlive > myAlive ? '（对方人多，额外+1）' : ''}`)
            break
        }
        case 'dismantle': {
            if (target && target.alive) {
                const totalCards = target.hand.length +
                    Object.values(target.equip).filter(e => e != null).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: effect.userIndex,
                        context: {
                            trickType: 'dismantle',
                            targetIndex: effect.targetIndex,
                        },
                    })
                }
            }
            break
        }
        case 'steal': {
            if (target && target.alive) {
                const totalCards = target.hand.length +
                    Object.values(target.equip).filter(e => e != null).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: effect.userIndex,
                        context: {
                            trickType: 'steal',
                            targetIndex: effect.targetIndex,
                        },
                    })
                }
            }
            break
        }
        case 'duel': {
            if (target && target.alive) {
                const requiredAttacks = hasSkill(user, 'lvbu_wushuang') ? 2 : 1
                state.pendingResponseQueue.unshift({
                    type: ResponseType.ATTACK_DUEL,
                    targetGeneralIndex: effect.targetIndex,
                    context: {
                        initiatorGeneralIndex: effect.userIndex,
                        requiredAttacks,
                        attacksReceived: 0,
                        duelCardId: effect.extra?.duelCardId,
                    },
                })
                addLog(state, `【${getGeneralName(user)}】对【${getGeneralName(target)}】发起【决斗】`)
            }
            break
        }
        case 'borrow_sword': {
            if (target && target.alive) {
                const killTargetIndex = effect.extra?.killTargetIndex as number
                state.pendingResponseQueue.unshift({
                    type: ResponseType.BORROW_SWORD_RESPONSE,
                    targetGeneralIndex: effect.targetIndex,
                    context: {
                        userIndex: effect.userIndex,
                        killTargetIndex,
                    },
                })
            }
            break
        }
    }
}

/**
 * 处理无懈可击玩家响应
 */
export function handleNegateRespond(
    state: GameState,
    playerId: string,
    data: { cardId?: string; generalIndex: number },
): { error: string } | void {
    const nw = state.negateWindow
    if (!nw) return { error: '当前没有无懈可击询问' }

    if (data.cardId) {
        // ── 玩家出无懈可击 ──
        const general = state.generals[data.generalIndex]
        if (!general || !general.alive) return { error: '武将不存在或已阵亡' }
        if (general.playerId !== playerId) return { error: '不能操作对方武将' }

        const cardIdx = general.hand.findIndex(c => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有此牌' }
        const card = general.hand[cardIdx]
        if (card.name !== TrickCardName.NEGATE) return { error: '此牌不是无懈可击' }

        general.hand.splice(cardIdx, 1)
        state.discard.push(card)
        checkMingzhe(state, general, card)

        // 集智（黄月英）：使用非延时锦囊后摸1张牌
        if (hasSkill(general, 'huangyueying_jizhi')) {
            const extra = drawCards(state, 1)
            general.hand.push(...extra)
            addLog(state, `【${getGeneralName(general)}】发动【集智】摸 1 张牌`)
        }

        nw.isCurrentlyNegated = !nw.isCurrentlyNegated
        const trickName = cardDisplayName({ name: nw.trickCardName } as any)
        if (nw.isCurrentlyNegated) {
            addLog(state, `【${getGeneralName(general)}】打出【无懈可击】，抵消了【${trickName}】对【${nw.trickTargetName}】的效果`)
        } else {
            addLog(state, `【${getGeneralName(general)}】打出【无懈可击】，反制无懈，【${trickName}】继续生效`)
        }

        // 重新检查是否还有人有无懈（可以反制）
        nw.passedPlayerIds = []
        nw.startedAt = Date.now()
        nw.anyoneHasNegate = anyoneHasNegate(state)
        // 如果没人有了，等 3 秒自动结算（由定时器或客户端触发）
    } else {
        // ── 玩家放弃 ──
        if (!nw.passedPlayerIds.includes(playerId)) {
            nw.passedPlayerIds.push(playerId)
        }

        // 检查是否所有持有无懈的玩家都放弃了
        const playerIds = Object.keys(state.players)
        const allRelevantPassed = playerIds.every(pid => {
            // 该玩家是否有武将持有无懈
            const hasNeg = state.generals.some(g =>
                g.playerId === pid && g.alive && g.hand.some(c => c.name === TrickCardName.NEGATE)
            )
            // 没有无懈 → 不需要放弃；有无懈 → 必须已放弃
            return !hasNeg || nw.passedPlayerIds.includes(pid)
        })

        if (allRelevantPassed) {
            resolveNegateWindow(state)
        }
    }
}

/**
 * 无懈可击超时自动结算（服务端定时器调用）
 */
export function negateWindowTimeout(state: GameState): void {
    if (!state.negateWindow) return
    resolveNegateWindow(state)
}

/** 结算无懈可击窗口 */
function resolveNegateWindow(state: GameState): void {
    const nw = state.negateWindow
    if (!nw) return

    state.negateWindow = undefined

    // ── 延时锦囊判定前的无懈 ──
    if (nw.delayedTrickJudgeContext) {
        continueDelayedTrickJudge(state, nw.delayedTrickJudgeContext, nw.isCurrentlyNegated)
        return
    }

    if (nw.isCurrentlyNegated) {
        // 锦囊被无懈
        const trickName = cardDisplayName({ name: nw.trickCardName } as any)
        addLog(state, `【${trickName}】对【${nw.trickTargetName}】的效果被无懈可击抵消`)
        if (nw.hasFollowUpResponse) {
            // 移除后续的 AOE 响应（AOE_DODGE / AOE_ATTACK / HARVEST_PICK 等）
            state.pendingResponseQueue.shift()
        }
        // deferredEffect 不执行
    } else {
        // 锦囊生效
        if (nw.deferredEffect) {
            executeDeferredTrickEffect(state, nw.deferredEffect)
        }
        // hasFollowUpResponse 的情况：不修改下一个 pending 的 needsNegate
        // processAutoExecutePending 会处理当前 pending 后，checkAndOpenNegateWindow 自然为下一个目标开窗口
    }

    // 递归检查下一个 pending 是否也需要无懈
    checkAndOpenNegateWindow(state)
}

/**
 * 检查当前 pending response 是否需要无懈窗口（用于 AOE 延迟开窗口）。
 * 在每次广播前调用，确保 AOE 的每个目标都能被询问无懈。
 */
export function checkAndOpenNegateWindow(state: GameState): void {
    if (state.negateWindow) return  // 已有窗口
    const pending = state.pendingResponseQueue[0]
    if (!pending) return
    const ctx = pending.context as any
    if (!ctx?.needsNegate) return

    // 标记已处理，防止重复
    ctx.needsNegate = false

    // 打开无懈窗口
    pushNegateCheck(
        state,
        ctx.trickCardName,
        ctx.sourceGeneralIndex,
        pending.targetGeneralIndex,
        ctx.trickTargetName,
        undefined,
        true,  // hasFollowUpResponse
    )
}

// ─────────────────────────────────────────────────────────────
// 自动执行 pending response（无需用户交互）
// ─────────────────────────────────────────────────────────────

export function processAutoExecutePending(state: GameState): void {
    // 循环处理所有队首的自动执行 pending
    while (state.pendingResponseQueue.length > 0) {
        const pending = state.pendingResponseQueue[0]
        const ctx = pending.context as any

        // 仁王盾：目标有仁王盾 + 攻击牌为黑色 + 攻击者无青釭剑 → 自动防御
        if (pending.type === ResponseType.DODGE) {
            const dodgeCtx = ctx as { attackerGeneralIndex: number; attackCard?: Card }
            const target = state.generals[pending.targetGeneralIndex]
            const attacker = dodgeCtx.attackerGeneralIndex >= 0 ? state.generals[dodgeCtx.attackerGeneralIndex] : null
            if (target?.equip.armor?.name === EquipmentCardName.NIOH_SHIELD
                && attacker?.equip.weapon?.name !== EquipmentCardName.QINGGANG_SWORD
                && dodgeCtx.attackCard
                && (dodgeCtx.attackCard.suit === CardSuit.SPADE || dodgeCtx.attackCard.suit === CardSuit.CLUB)) {
                addLog(state, `【${getGeneralName(target)}】的仁王盾抵消了黑色【杀】`)
                handleDodgeSucceeded(state, target, dodgeCtx)
                continue
            }
        }

        // 桃园结义：无懈窗口已结算（needsNegate 为 false）且无活跃无懈窗口，自动执行治疗
        if (pending.type === ResponseType.PEACH_GARDEN_HEAL && !ctx?.needsNegate && !state.negateWindow) {
            state.pendingResponseQueue.shift()
            const target = state.generals[pending.targetGeneralIndex]
            if (target && target.alive && target.hp < target.maxHp) {
                target.hp++
                addLog(state, `【${getGeneralName(target)}】通过【桃园结义】回复至 ${target.hp}/${target.maxHp}`)
            }
            continue
        }

        // 其他 autoExecute pending（如苦肉摸牌）
        if (!ctx?.autoExecute) break

        state.pendingResponseQueue.shift()
        const general = state.generals[pending.targetGeneralIndex]
        if (!general) continue

        switch (ctx.skillId) {
            case 'huanggai_kurou_draw': {
                if (general.alive) {
                    const drawn = drawCards(state, 2)
                    general.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(general)}】苦肉结算：摸了2张牌`)
                }
                break
            }
            default:
                break
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 通用技能判定（支持鬼才/缓释介入）
// ─────────────────────────────────────────────────────────────

/**
 * 技能判定类型：用于区分不同的判定来源
 * - delayedTrick: 延时锦囊（乐不思蜀/兵粮寸断）— 由 turn-manager 处理
 * - ganglie: 刚烈
 * - tieqi: 铁骑
 * - luoshen: 洛神
 * - eight_trigrams: 八卦阵
 */
export type SkillJudgeType = 'ganglie' | 'tieqi' | 'luoshen' | 'eight_trigrams'

/**
 * 执行一次技能判定：翻牌 → 检查鬼才/缓释 → 结算或等待介入
 * @param extraContext 额外上下文信息，会存入 JUDGE_INTERVENE 的 context 中
 * @returns true 如果判定被介入者打断（需等待），false 如果判定已直接结算
 */
export function performSkillJudge(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeType: SkillJudgeType,
    judgeName: string,
    extraContext: Record<string, any>,
): boolean {
    if (state.deck.length === 0) return false

    const judgeCard = state.deck.shift()!
    state.discard.push(judgeCard)

    const name = getGeneralName(judgingGeneral)
    addLog(state, `【${name}】的【${judgeName}】判定：${suitSymbol(judgeCard.suit)}${valueName(judgeCard.value)}`)

    // 检查鬼才/缓释
    const intervenor = findJudgeIntervenor(state, judgingGeneral)
    if (intervenor) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.JUDGE_INTERVENE,
            targetGeneralIndex: state.generals.indexOf(intervenor),
            context: {
                judgeType,
                judgingGeneralIndex: state.generals.indexOf(judgingGeneral),
                judgeCardId: judgeCard.id,
                judgeName,
                ...extraContext,
            },
        })
        const skillName = hasSkill(intervenor, 'simayi_guicai') ? '鬼才' : '缓释'
        addLog(state, `【${getGeneralName(intervenor)}】可发动【${skillName}】修改判定`)
        return true // 被介入，等待
    }

    // 无人介入 → 直接结算
    resolveSkillJudge(state, judgingGeneral, judgeCard, judgeType, extraContext)
    return false
}

/**
 * 结算技能判定结果（被介入后也用此函数，传入替换后的牌）
 */
export function resolveSkillJudge(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeCard: Card,
    judgeType: SkillJudgeType,
    extraContext: Record<string, any>,
): void {
    const name = getGeneralName(judgingGeneral)

    switch (judgeType) {
        case 'ganglie': {
            const attackerIdx = extraContext.attackerGeneralIndex as number
            if (judgeCard.suit !== CardSuit.HEART) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_GANGLIE_CHOICE,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        ganglieSourceIndex: state.generals.indexOf(judgingGeneral),
                    },
                })
                const atkName = getGeneralName(state.generals[attackerIdx])
                addLog(state, `【刚烈】判定非♥！【${atkName}】须弃2张手牌或受1点伤害`)
            } else {
                addLog(state, `【刚烈】判定为♥，无效果`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'tieqi': {
            const isRed = judgeCard.suit === CardSuit.HEART || judgeCard.suit === CardSuit.DIAMOND
            const tieqiTargetIdx = extraContext.tieqiTargetIndex as number
            const tieqiTarget = state.generals[tieqiTargetIdx]
            if (isRed) {
                addLog(state, `【${name}】【铁骑】判定（${suitSymbol(judgeCard.suit)}${valueName(judgeCard.value)}）红色！【${getGeneralName(tieqiTarget)}】不能出闪`)
                // 移除紧跟的 DODGE 响应
                const dodgeIdx = state.pendingResponseQueue.findIndex(
                    p => p.type === ResponseType.DODGE && p.targetGeneralIndex === tieqiTargetIdx
                )
                if (dodgeIdx >= 0) {
                    state.pendingResponseQueue.splice(dodgeIdx, 1)
                }
                // 直接造伤
                const killDmg = calcKillDamage(state, judgingGeneral)
                dealDamage(state, judgingGeneral, tieqiTarget, killDmg, extraContext.attackCardId as string)
            } else {
                addLog(state, `【${name}】【铁骑】判定（${suitSymbol(judgeCard.suit)}${valueName(judgeCard.value)}）黑色，无效`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'luoshen': {
            const isBlack = judgeCard.suit === CardSuit.SPADE || judgeCard.suit === CardSuit.CLUB
            if (isBlack) {
                // 把判定牌从弃牌堆取出加入手牌
                const discardIdx = state.discard.indexOf(judgeCard)
                if (discardIdx >= 0) state.discard.splice(discardIdx, 1)
                judgingGeneral.hand.push(judgeCard)
                addLog(state, `【${name}】【洛神】判定黑色！获得此牌`)
                // 询问是否继续
                if (state.deck.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(judgingGeneral),
                        context: {
                            skillId: 'zhenji_luoshen_continue',
                            skillName: '洛神',
                            description: '继续判定',
                        },
                    })
                }
            } else {
                addLog(state, `【${name}】【洛神】判定红色，停止`)
                checkTiandu(state, judgingGeneral, judgeCard)
            }
            break
        }
        case 'eight_trigrams': {
            const isRed = judgeCard.suit === CardSuit.HEART || judgeCard.suit === CardSuit.DIAMOND
            const isAoe = extraContext.pendingType === 'AOE_DODGE'
            if (isRed) {
                addLog(state, `【${name}】【八卦阵】判定红色！视为出闪`)
                if (isAoe) {
                    // 万箭齐发：shift 掉 AOE_DODGE pending
                    const aoePendingIdx = state.pendingResponseQueue.findIndex(
                        p => p.type === ResponseType.AOE_DODGE && p.targetGeneralIndex === state.generals.indexOf(judgingGeneral)
                    )
                    if (aoePendingIdx >= 0) {
                        state.pendingResponseQueue.splice(aoePendingIdx, 1)
                    }
                    addLog(state, `【${name}】抵挡万箭齐发`)
                } else {
                    // 杀：找到对应的 DODGE pending 并移除
                    const dodgePendingIdx = state.pendingResponseQueue.findIndex(
                        p => p.type === ResponseType.DODGE && p.targetGeneralIndex === state.generals.indexOf(judgingGeneral)
                    )
                    if (dodgePendingIdx >= 0) {
                        const dodgePending = state.pendingResponseQueue[dodgePendingIdx]
                        const dodgeCtx = dodgePending.context as any
                        // 先用 splice 精确移除 DODGE pending，避免 shift 移除错误元素
                        state.pendingResponseQueue.splice(dodgePendingIdx, 1)
                        addLog(state, `【${name}】成功防御【杀】`)
                        // 处理武器效果（贯石斧/青龙偃月刀/猛进等）
                        handleDodgeSucceededAfterRemoval(state, judgingGeneral, dodgeCtx)
                    }
                }
            } else {
                addLog(state, `【${name}】【八卦阵】判定黑色，判定失败`)
                // 玩家仍可继续出闪或放弃
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
    }
}

/** 天妒（郭嘉）：判定牌生效后，获得判定牌 */
function checkTiandu(state: GameState, general: GeneralInstance, judgeCard: Card): void {
    const def = getGeneralById(general.generalId)
    if (def?.skills.some(s => s.id === 'guojia_tiandu')) {
        const idx = state.discard.indexOf(judgeCard)
        if (idx >= 0) {
            state.discard.splice(idx, 1)
            general.hand.push(judgeCard)
            const gName = def?.name ?? general.generalId
            addLog(state, `【${gName}】发动【天妒】，获得判定牌`)
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 明哲（诸葛瑾）辅助：非自己回合使用/打出红色牌时摸1牌
// ─────────────────────────────────────────────────────────────

function checkMingzhe(state: GameState, general: GeneralInstance, card: Card): void {
    if (!hasSkill(general, 'zhugejin_mingzhe')) return
    // 必须非自己回合
    const activeGeneral = getActiveGeneral(state)
    if (activeGeneral === general) return
    // 红色牌
    if (card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND) {
        const drawn = drawCards(state, 1)
        general.hand.push(...drawn)
        addLog(state, `【${getGeneralName(general)}】发动【明哲】摸1张牌`)
    }
}

// ─────────────────────────────────────────────────────────────
// 枭姬（孙尚香）：失去装备区牌时摸2张
// ─────────────────────────────────────────────────────────────
function triggerXiaoji(state: GameState, general: GeneralInstance): void {
    if (hasSkill(general, 'sunshangxiang_xiaoji') && general.alive) {
        const bonus = drawCards(state, 2)
        general.hand.push(...bonus)
        addLog(state, `【${getGeneralName(general)}】发动【枭姬】摸 2 张牌`)
    }
}

// ─────────────────────────────────────────────────────────────
// 手牌/装备通用操作工具
// ─────────────────────────────────────────────────────────────

/**
 * 从手牌或装备区查找一张牌（不移除）
 * @returns 找到的 Card，或 undefined
 */
function findCardInHandOrEquip(general: GeneralInstance, cardId: string): Card | undefined {
    const hand = general.hand.find(c => c.id === cardId)
    if (hand) return hand
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) return general.equip[slot]!
    }
    return undefined
}

/**
 * 从手牌或装备区移除一张牌并放入弃牌堆（自动触发枭姬）
 * @returns 被移除的 Card，或 { error } 如果找不到
 */
function removeCardFromHandOrEquip(
    state: GameState,
    general: GeneralInstance,
    cardId: string,
): Card | { error: string } {
    const handIdx = general.hand.findIndex(c => c.id === cardId)
    if (handIdx >= 0) {
        const card = general.hand.splice(handIdx, 1)[0]
        state.discard.push(card)
        checkMingzhe(state, general, card)
        return card
    }
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) {
            const card = general.equip[slot]!
            general.equip[slot] = undefined as any
            state.discard.push(card)
            triggerXiaoji(state, general)
            checkMingzhe(state, general, card)
            return card
        }
    }
    return { error: '找不到该牌' }
}

/**
 * 从手牌或装备区移除一张牌但不放入弃牌堆（用于国色/断粮等放入判定区的场景）
 * 仍然触发枭姬
 */
function detachCardFromHandOrEquip(
    state: GameState,
    general: GeneralInstance,
    cardId: string,
): Card | { error: string } {
    const handIdx = general.hand.findIndex(c => c.id === cardId)
    if (handIdx >= 0) {
        const card = general.hand.splice(handIdx, 1)[0]
        return card
    }
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) {
            const card = general.equip[slot]!
            general.equip[slot] = undefined as any
            triggerXiaoji(state, general)
            return card
        }
    }
    return { error: '找不到该牌' }
}

// ─────────────────────────────────────────────────────────────
// 伤害处理
// ─────────────────────────────────────────────────────────────

/**
 * 失去体力（非伤害）：无来源，不触发被动技能（反馈/遗计/刚烈/奸雄等），
 * 但仍需检查濒死。例：苦肉、救主、乱武放弃等
 */
export function loseHp(state: GameState, target: GeneralInstance, amount: number): void {
    if (!target.alive) return
    target.hp -= amount
    addLog(state, `【${getGeneralName(target)}】失去${amount}点体力，剩余 ${Math.max(0, target.hp)}/${target.maxHp}`)
    if (target.hp <= 0) {
        enterDyingState(state, null, target)
    }
}

export function dealDamage(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    amount: number,
    /** 造成伤害的牌 ID（奸雄可获得此牌） */
    damageCardId?: string
): void {
    if (!target.alive) return

    // ── 天香（小乔）：受伤前可弃红桃手牌转移伤害（红颜：♠也算♥）
    if (hasSkill(target, 'xiaoqiao_tianxiang')) {
        const hasHeart = target.hand.some(c =>
            c.suit === CardSuit.HEART ||
            (c.suit === CardSuit.SPADE && hasSkill(target, 'xiaoqiao_hongyan'))
        )
        if (hasHeart) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xiaoqiao_tianxiang',
                    skillName: '天香',
                    description: '弃1张♥手牌，将伤害转移给另一角色',
                    damageAmount: amount,
                    attackerIndex: attacker ? state.generals.indexOf(attacker) : -1,
                    damageCardId,
                },
            })
            return // 中断伤害，等待响应
        }
    }

    target.hp -= amount
    const atkName = attacker ? getGeneralName(attacker) : '效果'
    const tgtName = getGeneralName(target)
    addLog(state, `【${tgtName}】受到 ${amount} 点伤害，剩余 ${Math.max(0, target.hp)}/${target.maxHp}`)

    // ── 被动技能触发：受伤后（仅存活且未濒死时触发）

    if (target.alive && target.hp > 0) {
        // 奸雄（曹操）：受伤后可选择获得造成伤害的牌
        if (hasSkill(target, 'caocao_jianxiong') && damageCardId) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'caocao_jianxiong',
                    skillName: '奸雄',
                    description: '获得造成伤害的牌',
                    damageCardId,
                },
            })
            addLog(state, `【${tgtName}】可发动【奸雄】`)
        }

        // 反馈（司马懿）：每受1点伤害可发动一次
        if (hasSkill(target, 'simayi_fankui') && attacker) {
            const atkCards = attacker.hand.length
            const atkEquips = Object.values(attacker.equip).filter(Boolean).length
            if (atkCards + atkEquips > 0) {
                for (let fi = 0; fi < amount; fi++) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(target),
                        context: {
                            skillId: 'simayi_fankui',
                            skillName: '反馈',
                            description: `获取【${getGeneralName(attacker)}】的一张牌（第${fi + 1}/${amount}次）`,
                            sourceGeneralIndex: state.generals.indexOf(attacker),
                        },
                    })
                }
                addLog(state, `【${tgtName}】可发动【反馈】（${amount}次）`)
            }
        }

        // 遗计（郭嘉）：每受1点伤害可发动一次
        if (hasSkill(target, 'guojia_yiji') && state.deck.length > 0) {
            for (let yi = 0; yi < amount; yi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'guojia_yiji',
                        skillName: '遗计',
                        description: `观看牌堆顶2张牌并分配（第${yi + 1}/${amount}次）`,
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【遗计】（${amount}次）`)
        }

        // 刚烈（夏侯惇）：每受1点伤害可发动一次
        if (hasSkill(target, 'xiahoudun_ganglie') && attacker && state.deck.length > 0) {
            for (let gi = 0; gi < amount; gi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'xiahoudun_ganglie',
                        skillName: '刚烈',
                        description: `判定，非♥则来源弃2牌或受1伤（第${gi + 1}/${amount}次）`,
                        attackerGeneralIndex: state.generals.indexOf(attacker),
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【刚烈】（${amount}次）`)
        }
    }

    if (target.hp <= 0) {
        // 进入濒死状态 —— 逆时针询问桃
        enterDyingState(state, attacker, target, damageCardId, amount)
    }
}

/**
 * 濒死处理：从濒死者开始逆时针询问每个角色是否使用桃
 * 简化实现：自动检查所有角色手中的桃
 * TODO: 完整实现需要异步响应链
 */
function enterDyingState(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    damageCardId?: string,
    damageAmount: number = 1
): void {
    const tgtName = getGeneralName(target)
    addLog(state, `【${tgtName}】进入濒死状态！`)

    // 建立逆时针询问顺序（从濒死者自己开始）
    const aliveGenerals = state.generals.filter(g => g.alive || g === target)
    const targetPos = aliveGenerals.indexOf(target)

    const askOrder: number[] = [] // 存储 generals 数组中的下标
    for (let i = 0; i < aliveGenerals.length; i++) {
        const idx = (targetPos - i + aliveGenerals.length) % aliveGenerals.length
        const g = aliveGenerals[idx]

        // 贾诩完杀：你的回合内，非濒死角色不能用桃
        const activeGeneral = getActiveGeneral(state)
        if (activeGeneral && hasSkill(activeGeneral, 'jiaxu_wansha') && g !== target) {
            continue
        }

        askOrder.push(state.generals.indexOf(g))
    }

    if (askOrder.length === 0) {
        // 无人可询问，直接死亡
        handleDeath(state, attacker, target)
        return
    }

    // 设置第一个被询问者的 PendingResponse
    const firstAskerIdx = askOrder[0]
    const remainingAskers = askOrder.slice(1)

    state.pendingResponseQueue.unshift({
        type: ResponseType.PEACH_SAVE_ASK,
        targetGeneralIndex: firstAskerIdx,
        context: {
            dyingGeneralIndex: state.generals.indexOf(target),
            attackerGeneralIndex: attacker ? state.generals.indexOf(attacker) : -1,
            remainingAskers,
            neededHp: 1 - target.hp, // 需要恢复的体力数
            damageCardId, // 传递伤害卡牌 ID 用于被救后触发被动技能
            damageAmount, // 传递伤害量用于遗计等技能
        },
    })

    addLog(state, `请【${getGeneralName(state.generals[firstAskerIdx])}】选择是否使用【桃】救援【${tgtName}】`)
}

/**
 * 从濒死被救活后触发受伤被动技能（遗计/奸雄/反馈/刚烈）
 * 在 dealDamage 中 target.hp <= 0 时被动不触发，被救后在此补充触发
 */
function triggerDamagePassiveSkills(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    damageCardId?: string,
    damageAmount: number = 1
): void {
    if (!target.alive || target.hp <= 0) return
    const tgtName = getGeneralName(target)

    // 刚烈：每受1点伤害可发动一次
    if (hasSkill(target, 'xiahoudun_ganglie') && attacker && state.deck.length > 0) {
        for (let gi = 0; gi < damageAmount; gi++) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xiahoudun_ganglie',
                    skillName: '刚烈',
                    description: `判定，非♥则来源弃2牌或受1伤（第${gi + 1}/${damageAmount}次）`,
                    attackerGeneralIndex: state.generals.indexOf(attacker),
                },
            })
        }
        addLog(state, `【${tgtName}】可发动【刚烈】（${damageAmount}次）`)
    }

    // 遗计：每受1点伤害可发动一次
    if (hasSkill(target, 'guojia_yiji') && state.deck.length > 0) {
        for (let yi = 0; yi < damageAmount; yi++) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'guojia_yiji',
                    skillName: '遗计',
                    description: `观看牌堆顶2张牌并分配（第${yi + 1}/${damageAmount}次）`,
                },
            })
        }
        addLog(state, `【${tgtName}】可发动【遗计】（${damageAmount}次）`)
    }

    // 反馈：每受1点伤害可发动一次
    if (hasSkill(target, 'simayi_fankui') && attacker) {
        const atkCards = attacker.hand.length
        const atkEquips = Object.values(attacker.equip).filter(Boolean).length
        if (atkCards + atkEquips > 0) {
            for (let fi = 0; fi < damageAmount; fi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'simayi_fankui',
                        skillName: '反馈',
                        description: `获取【${getGeneralName(attacker)}】的一张牌（第${fi + 1}/${damageAmount}次）`,
                        sourceGeneralIndex: state.generals.indexOf(attacker),
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【反馈】（${damageAmount}次）`)
        }
    }

    // 奸雄
    if (hasSkill(target, 'caocao_jianxiong') && damageCardId) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(target),
            context: {
                skillId: 'caocao_jianxiong',
                skillName: '奸雄',
                description: '获得造成伤害的牌',
                damageCardId,
            },
        })
        addLog(state, `【${tgtName}】可发动【奸雄】`)
    }
}

/** 处理角色死亡：弃置所有牌、击杀奖励 */
function handleDeath(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance
): void {
    target.alive = false
    target.hp = 0
    const tgtName = getGeneralName(target)
    addLog(state, `【${tgtName}】阵亡！`)

    // 弃置所有牌
    state.discard.push(...target.hand)
    target.hand = []
    for (const slot of Object.values(EquipSlot)) {
        if (target.equip[slot]) {
            state.discard.push(target.equip[slot]!)
            target.equip[slot] = undefined
        }
    }
    state.discard.push(...target.judgeZone)
    target.judgeZone = []

    // 击杀奖励：摸 2 张牌
    if (attacker && attacker.alive) {
        const bonus = drawCards(state, 2)
        attacker.hand.push(...bonus)
        addLog(state, `【${getGeneralName(attacker)}】获得击杀奖励，摸 2 张牌`)
    }
}

// ─────────────────────────────────────────────────────────────
// 使用卡牌
// ─────────────────────────────────────────────────────────────

export function handleUseCard(
    state: GameState,
    playerId: string,
    data: C2S_UseCard
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) return { error: '不是你的出牌阶段' }
    if (state.turnPhase !== TurnPhase.ACTION) return { error: '当前不是出牌阶段' }

    const cardIdx = general.hand.findIndex((c) => c.id === data.cardId)
    if (cardIdx === -1) return { error: '手牌中没有此牌' }

    const card = general.hand[cardIdx]
    const targets = data.targetIndices.map((i) => state.generals[i]).filter((g) => g?.alive)

    // asSkill 转换：将牌转换为技能使用（奇袭/断粮/国色等）
    if (data.asSkill) {
        return handleUseSkill(state, playerId, {
            skillId: data.asSkill,
            cardIds: [data.cardId],
            targetIndices: data.targetIndices,
        })
    }

    // 武圣（关羽）：客户端激活武圣模式后，红色牌当杀使用
    if (data.extra?.wusheng && hasSkill(general, 'guanyu_wusheng')) {
        const isRedCard = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        if (!isRedCard) return { error: '武圣须使用红色牌' }
        return handleWushengAttack(state, general, card, cardIdx, targets)
    }

    if (card.category === CardCategory.BASIC) {
        return handleBasicCard(state, general, card, cardIdx, targets)
    }
    if (card.category === CardCategory.TRICK) {
        return handleTrickCard(state, general, card, cardIdx, targets, data.extra)
    }
    if (card.category === CardCategory.EQUIPMENT) {
        return handleEquipCard(state, general, card, cardIdx)
    }
}

// ─── 基本牌 ──────────────────────────────────────────────────

function handleBasicCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[]
): { error: string } | void {
    const { name } = card

    if (name === BasicCardName.ATTACK || isCardUsableAsAttack(general, card)) {
        // 杀次数限制
        let maxAttacks = 1
        if (hasSkill(general, 'zhangfei_paoxiao')) {
            maxAttacks = 999 // 无限
        } else if (general.equip.weapon?.name === EquipmentCardName.CROSSBOW) {
            maxAttacks = 4 // 默认1 + 连弩+3
        }

        if (state.attackUsedThisTurn >= maxAttacks) {
            return { error: `每回合最多使用 ${maxAttacks} 张【杀】` }
        }

        // 方天画戟：最后一张手牌为杀时可额外指定最多2个目标
        const isLastCard = general.hand.length === 1
        const hasFangtian = general.equip.weapon?.name === EquipmentCardName.FANGTIAN_HALBERD
        const maxTargets = (isLastCard && hasFangtian) ? 3 : 1
        if (targets.length < 1 || targets.length > maxTargets) {
            return { error: maxTargets > 1 ? `方天画戟最多指定${maxTargets}个目标` : '【杀】需要指定一个目标' }
        }

        // 不能杀自己
        if (targets.some(t => t === general)) {
            return { error: '不能对自己使用【杀】' }
        }

        // 空城：诸葛亮无手牌时不能被杀指定
        for (const t of targets) {
            if (hasSkill(t, 'zhugeliang_kongcheng') && t.hand.length === 0) {
                return { error: `【${getGeneralName(t)}】发动【空城】，不能被【杀】指定` }
            }
        }

        // 攻击距离检查
        for (const t of targets) {
            const rangeInfo = getAttackRange(general, t, state.generals)
            if (!rangeInfo.inRange) {
                return { error: `【${getGeneralName(t)}】距离太远（距离${rangeInfo.distance}，攻击范围${rangeInfo.range}）` }
            }
        }

        // 帷幕：贾诩不能被黑色锦囊指定（杀不是锦囊，不受影响）

        general.hand.splice(cardIdx, 1)
        state.discard.push(card)
        state.attackUsedThisTurn++

        const targetNames = targets.map(t => `【${getGeneralName(t)}】`).join('、')
        addLog(state, `【${getGeneralName(general)}】对${targetNames}使用了【杀】${hasFangtian && targets.length > 1 ? '（方天画戟）' : ''}`)

        // 激昂（孙策）：使用红色杀时摸牌
        const isRedKill = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        if (isRedKill) {
            if (hasSkill(general, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                general.hand.push(...bonus)
                addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
            }
            for (const t of targets) {
                if (hasSkill(t, 'sunce_jiang')) {
                    const bonus = drawCards(state, 1)
                    t.hand.push(...bonus)
                    addLog(state, `【${getGeneralName(t)}】发动【激昂】摸 1 张牌`)
                }
            }
        }

        const attackerIdx = state.generals.indexOf(general)
        const attackerDef = getGeneralById(general.generalId)

        // 对每个目标逐一处理（反向入队使第一个目标先处理）
        for (let i = targets.length - 1; i >= 0; i--) {
            const target = targets[i]
            const targetIdx = state.generals.indexOf(target)

            // 马超铁骑：需手动触发（在 DODGE 之前插入确认）
            let tieqiPending = false
            if (hasSkill(general, 'machao_tieqi') && state.deck.length > 0) {
                tieqiPending = true
            }

            // 仁王盾：黑色杀无效
            if (target.equip.armor?.name === EquipmentCardName.NIOH_SHIELD) {
                // 青釭剑无视防具
                if (general.equip.weapon?.name !== EquipmentCardName.QINGGANG_SWORD) {
                    if (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB) {
                        addLog(state, `【${getGeneralName(target)}】的仁王盾抵消了黑色【杀】`)
                        continue
                    }
                }
            }

            // 吕布无双：需要 2 张闪
            const requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1

            // 流离（大乔）：被杀时可弃1牌转移目标
            if (hasSkill(target, 'daqiao_liuli') && (target.hand.length > 0 || target.equip.weapon || target.equip.armor || target.equip.plus_horse || target.equip.minus_horse)) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: targetIdx,
                    context: {
                        skillId: 'daqiao_liuli',
                        skillName: '流离',
                        description: '弃1张牌，将此杀转移给攻击范围内另一角色',
                        attackerIndex: attackerIdx,
                        attackCard: card,
                        requiredDodges,
                    },
                })
                continue
            }

            // 推 DODGE 响应
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: attackerIdx,
                    requiredDodges,
                    dodgesReceived: 0,
                    attackCard: card,
                },
            })

            // 铁骑确认：在 DODGE 之前插入
            if (tieqiPending) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'machao_tieqi',
                        skillName: '铁骑',
                        description: `对【${getGeneralName(target)}】发动铁骑？判定红色则目标不能出闪`,
                        tieqiTargetIndex: targetIdx,
                        attackCardId: card.id,
                    },
                })
            }

            // 雌雄双股剑：杀异性目标时可触发
            maybeDoubleSwords(state, attackerIdx, targetIdx)
        }
        return
    }

    if (name === BasicCardName.PEACH) {
        // 桃只能在非濒死时对自己使用，不需要指定目标
        if (general.hp >= general.maxHp) return { error: '你已满血，不能使用【桃】' }
        general.hand.splice(cardIdx, 1)
        state.discard.push(card)
        general.hp = Math.min(general.hp + 1, general.maxHp)
        addLog(state, `【${getGeneralName(general)}】使用【桃】，回复至 ${general.hp}/${general.maxHp}`)
        return
    }

    if (name === BasicCardName.DODGE) {
        return { error: '【闪】不能主动使用' }
    }
}

/** 武圣（关羽）：将红色牌当杀使用，走完整杀逻辑（含武器效果） */
function handleWushengAttack(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[]
): { error: string } | void {
    // 杀次数限制
    let maxAttacks = 1
    if (hasSkill(general, 'zhangfei_paoxiao')) {
        maxAttacks = 999
    } else if (general.equip.weapon?.name === EquipmentCardName.CROSSBOW) {
        maxAttacks = 4
    }
    if (state.attackUsedThisTurn >= maxAttacks) return { error: `每回合最多使用 ${maxAttacks} 张【杀】` }

    // 方天画戟：最后一张手牌为杀时可额外指定最多2个目标
    const isLastCard = general.hand.length === 1
    const hasFangtian = general.equip.weapon?.name === EquipmentCardName.FANGTIAN_HALBERD
    const maxTargets = (isLastCard && hasFangtian) ? 3 : 1
    if (targets.length < 1 || targets.length > maxTargets) {
        return { error: maxTargets > 1 ? `方天画戟最多指定${maxTargets}个目标` : '【杀】需要指定一个目标' }
    }

    if (targets.some(t => t === general)) return { error: '不能对自己使用【杀】' }
    for (const t of targets) {
        if (hasSkill(t, 'zhugeliang_kongcheng') && t.hand.length === 0) {
            return { error: `【${getGeneralName(t)}】发动【空城】，不能被【杀】指定` }
        }
    }
    for (const t of targets) {
        const rangeInfo = getAttackRange(general, t, state.generals)
        if (!rangeInfo.inRange) {
            return { error: `【${getGeneralName(t)}】距离太远（距离${rangeInfo.distance}，攻击范围${rangeInfo.range}）` }
        }
    }

    general.hand.splice(cardIdx, 1)
    state.discard.push(card)
    state.attackUsedThisTurn++

    const targetNames = targets.map(t => `【${getGeneralName(t)}】`).join('、')
    addLog(state, `【${getGeneralName(general)}】发动【武圣】，将${suitSymbol(card.suit)}${valueName(card.value)}当杀对${targetNames}使用${hasFangtian && targets.length > 1 ? '（方天画戟）' : ''}`)

    // 激昂（孙策）：红色杀
    if (hasSkill(general, 'sunce_jiang')) {
        const bonus = drawCards(state, 1)
        general.hand.push(...bonus)
        addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
    }
    for (const t of targets) {
        if (hasSkill(t, 'sunce_jiang')) {
            const bonus = drawCards(state, 1)
            t.hand.push(...bonus)
            addLog(state, `【${getGeneralName(t)}】发动【激昂】摸 1 张牌`)
        }
    }

    const attackerIdx = state.generals.indexOf(general)
    const attackerDef = getGeneralById(general.generalId)

    for (let i = targets.length - 1; i >= 0; i--) {
        const target = targets[i]
        const targetIdx = state.generals.indexOf(target)

        let tieqiPending = false
        if (hasSkill(general, 'machao_tieqi') && state.deck.length > 0) {
            tieqiPending = true
        }

        // 仁王盾：黑色杀无效（武圣杀一定是红色，不会触发）
        const requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1

        if (hasSkill(target, 'daqiao_liuli') && (target.hand.length > 0 || target.equip.weapon || target.equip.armor || target.equip.plus_horse || target.equip.minus_horse)) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: targetIdx,
                context: {
                    skillId: 'daqiao_liuli',
                    skillName: '流离',
                    description: '弃1张牌，将此杀转移给攻击范围内另一角色',
                    attackerIndex: attackerIdx,
                    attackCard: card,
                    requiredDodges,
                },
            })
            continue
        }

        state.pendingResponseQueue.unshift({
            type: ResponseType.DODGE,
            targetGeneralIndex: targetIdx,
            context: {
                attackerGeneralIndex: attackerIdx,
                requiredDodges,
                dodgesReceived: 0,
                attackCard: card,
            },
        })

        if (tieqiPending) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: attackerIdx,
                context: {
                    skillId: 'machao_tieqi',
                    skillName: '铁骑',
                    description: `对【${getGeneralName(target)}】发动铁骑？判定红色则目标不能出闪`,
                    tieqiTargetIndex: targetIdx,
                    attackCardId: card.id,
                },
            })
        }

        maybeDoubleSwords(state, attackerIdx, targetIdx)
    }
    return
}

// ─── 锦囊牌 ──────────────────────────────────────────────────

function handleTrickCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[],
    extra?: Record<string, unknown>
): { error: string } | void {
    const { name } = card

    // 黄月英集智：使用普通锦囊时立即摸 1 牌（在无懈可击询问之前，这样摸到无懈可击可以立即使用）
    const triggerJizhi = card.trickType === TrickType.INSTANT && hasSkill(general, 'huangyueying_jizhi')

    // 延时锦囊
    if (card.trickType === TrickType.DELAYED) {
        if (targets.length !== 1) return { error: '延时锦囊需要指定一个目标' }
        const target = targets[0]

        // 帷幕：贾诩不能被黑色锦囊指定
        if (hasSkill(target, 'jiaxu_weimu') && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)) {
            return { error: '目标发动【帷幕】，不能被黑色锦囊指定' }
        }

        // 兵粮寸断距离限制：距离 ≤ 1（奇才无视距离限制）
        if (card.name === TrickCardName.SUPPLY_SHORTAGE) {
            if (!hasSkill(general, 'huangyueying_qicai')) {
                const rangeInfo = getAttackRange(general, target, state.generals)
                if (rangeInfo.distance > 1) return { error: '兵粮寸断目标距离太远（需距离1以内）' }
            }
        }

        if (target.judgeZone.some((c) => c.name === card.name)) {
            return { error: '目标判定区已有相同延时锦囊' }
        }
        general.hand.splice(cardIdx, 1)
        target.judgeZone.push(card)
        addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】放置【${cardDisplayName(card)}】`)
        return
    }

    // 无懈可击不能主动使用
    if (name === TrickCardName.NEGATE) return { error: '【无懈可击】只能在响应时使用' }

    // ── 目标合法性检查（必须在移除手牌之前，否则 return error 后牌已消失）──
    const isBlackCard = card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
    if (name === TrickCardName.DISMANTLE || name === TrickCardName.STEAL || name === TrickCardName.DUEL || name === TrickCardName.BORROW_SWORD) {
        if (targets.length < 1) return { error: '需要指定目标' }
        const target = targets[0]
        // 帷幕：不能被黑色锦囊指定
        if (hasSkill(target, 'jiaxu_weimu') && isBlackCard) {
            return { error: '目标发动【帷幕】，不能被黑色锦囊指定' }
        }
    }
    if (name === TrickCardName.STEAL) {
        if (!hasSkill(general, 'huangyueying_qicai')) {
            const rangeInfo = getAttackRange(general, targets[0], state.generals)
            if (rangeInfo.distance > 1) return { error: '目标距离太远（需距离1以内）' }
        }
    }
    if (name === TrickCardName.DUEL) {
        const target = targets[0]
        if (target && hasSkill(target, 'zhugeliang_kongcheng') && target.hand.length === 0) {
            return { error: '目标发动【空城】，不能被决斗指定' }
        }
    }

    // 即时锦囊：统一先移除手牌
    general.hand.splice(cardIdx, 1)
    state.discard.push(card)

    // 黄月英集智：立即摸牌（在无懈可击之前，摸到无懈可击可以使用）
    if (triggerJizhi) {
        const extra = drawCards(state, 1)
        general.hand.push(...extra)
        addLog(state, `【${getGeneralName(general)}】发动【集智】摸 1 张牌`)
    }

    switch (name) {
        case TrickCardName.DRAW_TWO: {
            addLog(state, `【${getGeneralName(general)}】使用【无中生有】`)

            const gIdx = state.generals.indexOf(general)
            const effect: DeferredTrickEffect = { type: 'draw_two', userIndex: gIdx, targetIndex: -1, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, -1, getGeneralName(general), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.DISMANTLE: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】使用【过河拆桥】`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'dismantle', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.STEAL: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】使用【顺手牵羊】`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'steal', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.DUEL: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】向【${getGeneralName(target)}】发起【决斗】`)

            // 激昂（使用时立即触发，不受无懈影响）
            if (hasSkill(general, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                general.hand.push(...bonus)
                addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
            }
            if (hasSkill(target, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                target.hand.push(...bonus)
                addLog(state, `【${getGeneralName(target)}】发动【激昂】摸 1 张牌`)
            }

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'duel', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false, extra: { duelCardId: card.id } }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.BARBARIANS: {
            addLog(state, `【${getGeneralName(general)}】使用【南蛮入侵】`)

            const direction = (extra?.direction as string) || 'clockwise'
            let others = getDirectionalTargets(state, general, direction).filter(t => t.alive)
            const gIdx = state.generals.indexOf(general)

            // 帷幕：跳过不能被黑色锦囊指定的角色
            if (isBlackCard) {
                others = others.filter(t => {
                    if (hasSkill(t, 'jiaxu_weimu')) {
                        addLog(state, `【${getGeneralName(t)}】发动【帷幕】，免疫黑色锦囊【南蛮入侵】`)
                        return false
                    }
                    return true
                })
            }

            for (let i = others.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(others[i])
                state.pendingResponseQueue.unshift({
                    type: ResponseType.AOE_ATTACK,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        sourceCardId: card.id,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(others[i]),
                    },
                })
            }
            break
        }
        case TrickCardName.ARROWS: {
            addLog(state, `【${getGeneralName(general)}】使用【万箭齐发】`)

            const direction = (extra?.direction as string) || 'clockwise'
            let others = getDirectionalTargets(state, general, direction).filter(t => t.alive)
            const gIdx = state.generals.indexOf(general)

            // 帷幕：跳过不能被黑色锦囊指定的角色（万箭齐发是♥红色，标准不会触发，但防御性检查）
            if (isBlackCard) {
                others = others.filter(t => {
                    if (hasSkill(t, 'jiaxu_weimu')) {
                        addLog(state, `【${getGeneralName(t)}】发动【帷幕】，免疫黑色锦囊【万箭齐发】`)
                        return false
                    }
                    return true
                })
            }

            for (let i = others.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(others[i])
                state.pendingResponseQueue.unshift({
                    type: ResponseType.AOE_DODGE,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        sourceCardId: card.id,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(others[i]),
                    },
                })
            }
            break
        }
        // NEGATE 已在 switch 前处理
        case TrickCardName.PEACH_GARDEN: {
            addLog(state, `【${getGeneralName(general)}】使用【桃园结义】`)

            const direction = (extra?.direction as string) || 'clockwise'
            const allTargets = getDirectionalTargets(state, general, direction)
            const allWithSelf = [general, ...allTargets]
            const gIdx = state.generals.indexOf(general)

            // 与南蛮/万箭保持一致：为每个目标入队 pending，逐目标开无懈窗口
            for (let i = allWithSelf.length - 1; i >= 0; i--) {
                const t = allWithSelf[i]
                if (!t.alive) continue
                const tIdx = state.generals.indexOf(t)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.PEACH_GARDEN_HEAL,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(t),
                    },
                })
            }
            break
        }
        case TrickCardName.HARVEST: {
            addLog(state, `【${getGeneralName(general)}】使用【五谷丰登】`)

            const direction = (extra?.direction as string) || 'clockwise'
            const allTargets = getDirectionalTargets(state, general, direction)
            const allWithSelf = [general, ...allTargets]
            const alive = allWithSelf.filter(g => g.alive)
            const gIdx = state.generals.indexOf(general)

            const harvestCards = drawCards(state, alive.length)
            addLog(state, `五谷丰登翻出 ${harvestCards.length} 张牌：${harvestCards.map(c => cardFullName(c)).join('、')}`)
            state.harvestPool = harvestCards

            for (let i = alive.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(alive[i])
                state.pendingResponseQueue.unshift({
                    type: ResponseType.HARVEST_PICK,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(alive[i]),
                    },
                })
            }
            break
        }
        case TrickCardName.BORROW_SWORD: {
            // targets[0] = 持有武器的角色（被命令者），targets[1] = 杀的目标
            if (targets.length < 2) return { error: '借刀杀人需要指定两个目标' }
            const weaponHolder = targets[0]
            const killTarget = targets[1]
            if (!weaponHolder.equip.weapon) return { error: '第一个目标必须有武器' }
            if (weaponHolder === killTarget) return { error: '两个目标不能相同' }

            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(weaponHolder)}】使用【借刀杀人】，要求对【${getGeneralName(killTarget)}】出杀`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(weaponHolder)
            const killIdx = state.generals.indexOf(killTarget)
            const effect: DeferredTrickEffect = {
                type: 'borrow_sword', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false,
                extra: { killTargetIndex: killIdx }
            }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(weaponHolder), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        default:
            return { error: `尚未实现该锦囊：${name}` }
    }
}

// ─── 装备牌 ──────────────────────────────────────────────────

function handleEquipCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number
): { error: string } | void {
    const slot = card.equipSlot
    if (!slot) return { error: '装备牌槽位未定义' }

    general.hand.splice(cardIdx, 1)

    // 孙尚香枭姬：失去装备区牌时摸 2 张
    const oldEquip = general.equip[slot]
    if (oldEquip) {
        state.discard.push(oldEquip)
        triggerXiaoji(state, general)
    }

    general.equip[slot] = card
    addLog(state, `【${getGeneralName(general)}】装备了【${cardDisplayName(card)}】`)
}

// ─────────────────────────────────────────────────────────────
// 技能处理
// ─────────────────────────────────────────────────────────────

export function handleUseSkill(
    state: GameState,
    playerId: string,
    data: C2S_UseSkill
): { error: string } | void {
    const generalOrNull = getActiveGeneral(state)
    if (!generalOrNull || generalOrNull.playerId !== playerId) return { error: '不是你的出牌阶段' }
    if (state.turnPhase !== TurnPhase.ACTION) return { error: '当前不是出牌阶段' }
    const general = generalOrNull

    const name = getGeneralName(general)
    const targets = (data.targetIndices ?? []).map(i => state.generals[i]).filter(g => g?.alive)
    const cardIds = data.cardIds ?? []

    // 限一次检查工具
    function checkOncePerTurn(skillId: string): { error: string } | void {
        if (general.skillsUsedThisTurn.includes(skillId)) {
            return { error: '本回合已使用过此技能' }
        }
    }
    function markUsed(skillId: string) {
        general.skillsUsedThisTurn.push(skillId)
    }

    // 限定技检查
    function checkLimited(skillId: string): { error: string } | void {
        if (general.usedLimitedSkills.includes(skillId)) {
            return { error: '此限定技已使用' }
        }
    }
    function markLimited(skillId: string) {
        general.usedLimitedSkills.push(skillId)
    }

    // 弃牌工具
    function removeCardsFromHand(ids: string[]): { error: string } | Card[] {
        const cards: Card[] = []
        const indices = ids.map(id => general.hand.findIndex(c => c.id === id))
        if (indices.some(i => i === -1)) return { error: '手牌中找不到指定的牌' }
        // 从后往前删
        const sorted = [...indices].sort((a, b) => b - a)
        for (const idx of sorted) {
            cards.push(general.hand.splice(idx, 1)[0])
        }
        return cards
    }

    switch (data.skillId) {

        // ── 苦肉（黄盖）：出牌阶段，失去1体力，摸2张牌
        case 'huanggai_kurou': {
            if (!hasSkill(general, 'huanggai_kurou')) return { error: '你没有此技能' }
            addLog(state, `【${name}】发动【苦肉】`)
            loseHp(state, general, 1)
            // 如果产生了濒死（pendingResponseQueue 有 PEACH_SAVE_ASK），
            // 摸牌必须等濒死结算后再执行。插入一个自动确认的摸牌后续。
            if (general.hp <= 0) {
                // 濒死在 pendingResponseQueue[0]，摸牌在其后面
                // 被救活后由 handleRespond 中 SKILL_ACTIVATE_CONFIRM 的 auto-execute 处理
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'huanggai_kurou_draw',
                        skillName: '苦肉（摸牌）',
                        description: '苦肉结算：摸2张牌',
                        autoExecute: true,
                    },
                })
            } else if (general.alive) {
                const drawn = drawCards(state, 2)
                general.hand.push(...drawn)
                addLog(state, `【${name}】摸了2张牌`)
            }
            return
        }

        // ── 制衡（孙权）：出牌阶段限一次，弃任意张牌摸等量
        case 'sunquan_zhiheng': {
            if (!hasSkill(general, 'sunquan_zhiheng')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('sunquan_zhiheng')
            if (err) return err
            if (cardIds.length === 0) return { error: '请选择要弃置的牌' }
            let discardCount = 0
            const discardedCards: Card[] = []
            for (const cid of cardIds) {
                const card = findCardInHandOrEquip(general, cid)
                if (card) discardedCards.push(card)
                const result = removeCardFromHandOrEquip(state, general, cid)
                if ('error' in result) return result
                discardCount++
            }
            const drawn = drawCards(state, discardCount)
            general.hand.push(...drawn)
            markUsed('sunquan_zhiheng')
            addLog(state, `【${name}】发动【制衡】，弃${discardedCards.map(c => cardFullName(c)).join('、')}，摸 ${drawn.length} 张牌`)
            return
        }

        // ── 青囊（华佗）：出牌阶段限一次，弃1张手牌，目标回复1血
        case 'huatuo_qingnang': {
            if (!hasSkill(general, 'huatuo_qingnang')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('huatuo_qingnang')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张手牌弃置' }
            if (targets.length !== 1) return { error: '请选择1个目标' }
            const target = targets[0]
            if (target.hp >= target.maxHp) return { error: '目标已满血' }
            const result = removeCardsFromHand(cardIds)
            if ('error' in result) return result
            state.discard.push(...result)
            target.hp = Math.min(target.hp + 1, target.maxHp)
            markUsed('huatuo_qingnang')
            addLog(state, `【${name}】发动【青囊】，【${getGeneralName(target)}】回复至 ${target.hp}/${target.maxHp}`)
            return
        }

        // ── 结姻（孙尚香）：出牌阶段限一次，弃2手牌选一名已受伤男性，各回复1血
        case 'sunshangxiang_jieyin': {
            if (!hasSkill(general, 'sunshangxiang_jieyin')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('sunshangxiang_jieyin')
            if (err) return err
            if (cardIds.length !== 2) return { error: '需弃置2张手牌' }
            if (targets.length !== 1) return { error: '请选择1名已受伤男性角色' }
            const target = targets[0]
            const targetDef = getGeneralById(target.generalId)
            if (targetDef?.gender !== 'male') return { error: '目标必须是男性角色' }
            if (target.hp >= target.maxHp) return { error: '目标未受伤' }
            // 结姻只能用手牌
            for (const cid of cardIds) {
                const cardIdx = general.hand.findIndex(c => c.id === cid)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
            }
            const jieyinCards: Card[] = []
            for (const cid of cardIds) {
                const cardIdx = general.hand.findIndex(c => c.id === cid)
                const card = general.hand.splice(cardIdx, 1)[0]
                jieyinCards.push(card)
                state.discard.push(card)
                checkMingzhe(state, general, card)
            }
            if (general.hp < general.maxHp) general.hp++
            if (target.hp < target.maxHp) target.hp++
            markUsed('sunshangxiang_jieyin')
            addLog(state, `【${name}】发动【结姻】弃${jieyinCards.map(c => cardFullName(c)).join('、')}，与【${getGeneralName(target)}】各回复1点体力`)
            return
        }

        // ── 反间（周瑜）：出牌阶段限一次，选一张手牌展示给目标 → 目标选花色 → 不同受伤
        case 'zhouyu_fanjian': {
            if (!hasSkill(general, 'zhouyu_fanjian')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('zhouyu_fanjian')
            if (err) return err
            if (general.hand.length === 0) return { error: '你没有手牌可用' }
            if (targets.length !== 1) return { error: '请选择1名目标角色' }
            const target = targets[0]
            if (target === general) return { error: '不能选自己' }
            markUsed('zhouyu_fanjian')
            // 设置 pendingResponse，让目标选花色（周瑜不需要选牌，之后随机给一张）
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_FANJIAN_SUIT,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    fanjianUserIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【反间】，请选择一种花色`)
            return
        }

        // ── 挑衅（姜维）：出牌阶段限一次，指定攻击范围内角色（目标须能杀到你），其须对你出杀否则弃其一牌
        case 'jiangwei_tiaoxin': {
            if (!hasSkill(general, 'jiangwei_tiaoxin')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('jiangwei_tiaoxin')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名角色' }
            const target = targets[0]
            if (target === general) return { error: '不能挑衅自己' }
            // 校验：目标必须能攻击到姜维
            const rangeInfo = getAttackRange(target, general, state.generals)
            if (!rangeInfo.inRange) return { error: `目标攻击范围不够（距离${rangeInfo.distance}，范围${rangeInfo.range}）` }
            markUsed('jiangwei_tiaoxin')
            // 设置 pendingResponse，让目标选择出杀或放弃
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_TIAOXIN_RESPONSE,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    tiaoxinUserIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【挑衅】，请出一张【杀】或放弃`)
            return
        }

        // ── 离间（貂蝉）：出牌阶段限一次，弃1牌令两男角色决斗
        case 'diaochan_lijian': {
            if (!hasSkill(general, 'diaochan_lijian')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('diaochan_lijian')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张牌弃置' }
            if (targets.length !== 2) return { error: '请选择2名男性角色' }
            const [t1, t2] = targets
            const t1Def = getGeneralById(t1.generalId)
            const t2Def = getGeneralById(t2.generalId)
            if (t1Def?.gender !== 'male' || t2Def?.gender !== 'male') return { error: '目标必须是男性角色' }
            // 支持手牌和装备牌
            const result = removeCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in result) return result
            markUsed('diaochan_lijian')
            addLog(state, `【${name}】发动【离间】，令【${getGeneralName(t1)}】与【${getGeneralName(t2)}】决斗`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.ATTACK_DUEL,
                targetGeneralIndex: state.generals.indexOf(t2),
                context: {
                    initiatorGeneralIndex: state.generals.indexOf(t1),
                    requiredAttacks: 1,
                    attacksReceived: 0,
                },
            })
            return
        }

        // ── 仁德（刘备）：出牌阶段，将任意张手牌给予其他角色，每给出第2张时回1血
        case 'liubei_rende': {
            if (!hasSkill(general, 'liubei_rende')) return { error: '你没有此技能' }
            if (cardIds.length === 0) return { error: '请选择要给出的手牌' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能给自己' }
            const result = removeCardsFromHand(cardIds)
            if ('error' in result) return result
            target.hand.push(...result)
            // 累计给牌数
            const prevGiven = general.rendeGivenThisTurn
            const newGiven = prevGiven + cardIds.length
            general.rendeGivenThisTurn = newGiven
            // 每回合最多回复1点体力：累计给出≥2张且本回合未回过血
            let healed = false
            if (!general.rendeHealedThisTurn && newGiven >= 2 && general.hp < general.maxHp) {
                general.hp++
                general.rendeHealedThisTurn = true
                healed = true
            }
            addLog(state, `【${name}】发动【仁德】，给了【${getGeneralName(target)}】${cardIds.length}张牌${healed ? '，回复1点体力' : ''}`)
            return
        }

        // ── 忠义（关羽限定技）：将一张红色手牌置于武将牌上至本轮结束，期间己方杀+1伤
        case 'guanyu_zhongyi': {
            if (!hasSkill(general, 'guanyu_zhongyi')) return { error: '你没有此技能' }
            const errL = checkLimited('guanyu_zhongyi')
            if (errL) return errL
            if (cardIds.length !== 1) return { error: '请选择1张红色手牌' }
            const cardIdx = general.hand.findIndex(c => c.id === cardIds[0])
            if (cardIdx === -1) return { error: '手牌中找不到该牌' }
            const card = general.hand[cardIdx]
            if (card.suit !== CardSuit.HEART && card.suit !== CardSuit.DIAMOND) return { error: '须为红色牌' }
            general.hand.splice(cardIdx, 1)
            general.loyaltyCard = card
            markLimited('guanyu_zhongyi')
            addLog(state, `【${name}】发动【忠义】，置入了一张红色牌，己方使用【杀】伤害+1至本轮结束`)
            return
        }

        // ── 乱武（贾诩限定技）：所有其他角色依次选择：对最近角色出杀或失去1血
        case 'jiaxu_luanwu': {
            if (!hasSkill(general, 'jiaxu_luanwu')) return { error: '你没有此技能' }
            const errL = checkLimited('jiaxu_luanwu')
            if (errL) return errL
            markLimited('jiaxu_luanwu')
            addLog(state, `【${name}】发动【乱武】！所有其他角色须对距离最近的角色出杀或失去1点体力`)
            // 按逆时针从使用者下家开始（不包括贾诩本人）
            const generalIdx = state.generals.indexOf(general)
            const orderedTargets = getDirectionalTargets(state, general, 'counterclockwise')
                .filter(g => g.alive)
            if (orderedTargets.length > 0) {
                // 为第一个角色计算距离最近的目标
                const firstTarget = orderedTargets[0]
                const nearestIndices = findNearestTargets(state, firstTarget)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_LUANWU_RESPONSE,
                    targetGeneralIndex: state.generals.indexOf(firstTarget),
                    context: {
                        luanwuUserIndex: generalIdx,
                        remainingIndices: orderedTargets.slice(1).map(g => state.generals.indexOf(g)),
                        nearestIndices,
                    },
                })
                const nearestNames = nearestIndices.map((i: number) => getGeneralName(state.generals[i])).join('、')
                addLog(state, `【${getGeneralName(firstTarget)}】：距离最近的角色为【${nearestNames}】，请出【杀】或放弃（失去1血）`)
            }
            return
        }

        // ── 奇袭（甘宁）：黑色牌当过河拆桥
        case 'ganning_qixi': {
            if (!hasSkill(general, 'ganning_qixi')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张黑色牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备黑色牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.SPADE && card.suit !== CardSuit.CLUB) return { error: '须为黑色牌' }
            const target = targets[0]
            // 帷幕检查（过河拆桥是黑色锦囊）
            if (hasSkill(target, 'jiaxu_weimu')) return { error: '目标发动【帷幕】' }
            // 移除牌
            removeCardFromHandOrEquip(state, general, cardIds[0])
            addLog(state, `【${name}】发动【奇袭】（黑色牌当过河拆桥），对【${getGeneralName(target)}】使用`)
            // 走过河拆桥流程：无懈可击 → TRICK_TARGET_CARD_PICK
            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'dismantle', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, TrickCardName.DISMANTLE, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            return
        }

        // ── 断粮（徐晃）：黑色基本/装备牌当兵粮寸断
        case 'xuhuang_duanliang': {
            if (!hasSkill(general, 'xuhuang_duanliang')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张黑色基本/装备牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.SPADE && card.suit !== CardSuit.CLUB) return { error: '须为黑色牌' }
            if (card.category !== CardCategory.BASIC && card.category !== CardCategory.EQUIPMENT) return { error: '须为基本或装备牌' }
            const target = targets[0]
            // 距离限制：距离2以内（奇才无距离限制）
            if (!hasSkill(general, 'huangyueying_qicai')) {
                const rangeInfo = getAttackRange(general, target, state.generals)
                if (rangeInfo.distance > 2) return { error: '目标距离太远（需距离2以内）' }
            }
            if (target.judgeZone.some(c => c.name === TrickCardName.SUPPLY_SHORTAGE)) return { error: '目标已有兵粮寸断' }
            const removedCard = detachCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            // 将此牌当兵粮寸断放入目标判定区
            target.judgeZone.push({
                ...removedCard,
                originalName: removedCard.name,
                originalCategory: removedCard.category,
                name: TrickCardName.SUPPLY_SHORTAGE,
                category: CardCategory.TRICK,
                trickType: TrickType.DELAYED,
            })
            addLog(state, `【${name}】发动【断粮】（黑色牌当兵粮寸断），对【${getGeneralName(target)}】放置`)
            return
        }

        // ── 国色（大乔）：方块牌当乐不思蜀
        case 'daqiao_guose': {
            if (!hasSkill(general, 'daqiao_guose')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张♦牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.DIAMOND) return { error: '须为♦牌' }
            const target = targets[0]
            if (target.judgeZone.some(c => c.name === TrickCardName.OVERINDULGENCE)) return { error: '目标已有乐不思蜀' }
            const removedCard = detachCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            target.judgeZone.push({
                ...removedCard,
                originalName: removedCard.name,
                originalCategory: removedCard.category,
                name: TrickCardName.OVERINDULGENCE,
                category: CardCategory.TRICK,
                trickType: TrickType.DELAYED,
            })
            addLog(state, `【${name}】发动【国色】（♦牌当乐不思蜀），对【${getGeneralName(target)}】放置`)
            return
        }

        case 'equip_zhangba_spear': {
            // 丈八蛇矛：弃2张手牌当杀使用
            if (general.equip.weapon?.name !== EquipmentCardName.ZHANGBA_SPEAR) return { error: '未装备丈八蛇矛' }
            if (cardIds.length !== 2) return { error: '需要选择2张手牌' }
            if (targets.length !== 1) return { error: '需要指定1个目标' }

            // 杀次数限制
            let maxAttacks = 1
            if (hasSkill(general, 'zhangfei_paoxiao')) maxAttacks = 999
            if (state.attackUsedThisTurn >= maxAttacks) return { error: '本回合出杀次数已满' }

            const card1Idx = general.hand.findIndex(c => c.id === cardIds[0])
            const card2Idx = general.hand.findIndex(c => c.id === cardIds[1])
            if (card1Idx === -1 || card2Idx === -1) return { error: '手牌中找不到选择的牌' }

            const target = targets[0]
            // 不能杀自己
            if (target === general) return { error: '不能对自己使用【杀】' }
            // 空城
            if (hasSkill(target, 'zhugeliang_kongcheng') && target.hand.length === 0) {
                return { error: '目标发动空城，不能被杀指定' }
            }

            // 弃2牌
            const cards = [general.hand[card1Idx], general.hand[card2Idx]]
            const sortedIndices = [card1Idx, card2Idx].sort((a, b) => b - a)
            sortedIndices.forEach(i => general.hand.splice(i, 1))
            state.discard.push(...cards)
            state.attackUsedThisTurn++

            addLog(state, `【${name}】发动【丈八蛇矛】（弃${cards.map(c => cardFullName(c)).join('、')}）对【${getGeneralName(target)}】使用了【杀】`)

            const targetIdx = state.generals.indexOf(target)
            const attackerIdx = state.generals.indexOf(general)
            const requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1

            // 推 DODGE
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: attackerIdx,
                    requiredDodges,
                    dodgesReceived: 0,
                    // 丈八蛇矛的杀没有单张 attackCard
                },
            })
            return
        }

        default:
            return { error: `未知技能：${data.skillId}` }
    }
}


// ─────────────────────────────────────────────────────────────
// 响应处理
// ─────────────────────────────────────────────────────────────

export function handleRespond(
    state: GameState,
    playerId: string,
    data: C2S_Respond
): { error: string } | void {
    const pending = state.pendingResponseQueue[0]
    if (!pending) return { error: '当前没有待响应的事件' }

    // 如果 negateWindow 正在开，阻止普通响应
    if (state.negateWindow) return { error: '等待无懈可击结算' }

    const targetGeneral = state.generals[pending.targetGeneralIndex]
    if (!targetGeneral || targetGeneral.playerId !== playerId) {
        return { error: '不是你需要响应' }
    }

    switch (pending.type) {
        case ResponseType.DODGE:
            return handleDodgeResponse(state, targetGeneral, pending, data)
        case ResponseType.ATTACK_DUEL:
            return handleDuelResponse(state, targetGeneral, pending, data)

        // ── 技能确认：是否发动
        case ResponseType.SKILL_ACTIVATE_CONFIRM: {
            const ctx = pending.context as {
                skillId: string
                skillName: string
                description: string
                sourceGeneralIndex?: number
                attackerGeneralIndex?: number
                damageCardId?: string
                autoExecute?: boolean
            }
            const action = data.action

            // 自动执行的效果（如苦肉摸牌）：不需要用户确认
            if (ctx.autoExecute) {
                state.pendingResponseQueue.shift()
                switch (ctx.skillId) {
                    case 'huanggai_kurou_draw': {
                        if (targetGeneral.alive) {
                            const drawn = drawCards(state, 2)
                            targetGeneral.hand.push(...drawn)
                            addLog(state, `【${getGeneralName(targetGeneral)}】苦肉结算：摸了2张牌`)
                        }
                        return
                    }
                    default:
                        return
                }
            }

            if (action === 'decline' || (!action && !data.cardId)) {
                // 放弃发动
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【${ctx.skillName}】`)
                state.pendingResponseQueue.shift()

                // 突袭放弃 → 正常摸牌 + 进入出牌/弃牌阶段
                if (ctx.skillId === 'zhangliao_tuxi') {
                    let drawCount = 2
                    if (hasSkill(targetGeneral, 'zhouyu_yingzi') || hasSkill(targetGeneral, 'sunce_yingzi')) drawCount = 3
                    const drawn = drawCards(state, drawCount)
                    targetGeneral.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了 ${drawn.length} 张牌`)
                    if ((ctx as any).skipAction) {
                        state.turnPhase = TurnPhase.DISCARD
                        if (targetGeneral.hand.length <= targetGeneral.hp) {
                            finishTurn(state)
                        }
                    } else {
                        state.turnPhase = TurnPhase.ACTION
                        addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                    }
                }

                // 流离放弃 → 正常接杀（推 DODGE 给自己）
                if (ctx.skillId === 'daqiao_liuli') {
                    const atkCtx = ctx as any
                    const attackerIdx = atkCtx.attackerIndex as number
                    const attacker = state.generals[attackerIdx]
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackerGeneralIndex: attackerIdx,
                            requiredDodges: atkCtx.requiredDodges || 1,
                            dodgesReceived: 0,
                            attackCard: atkCtx.attackCard,
                        },
                    })
                    // 流离拒绝后，检查雌雄双股剑（杀异性目标）
                    maybeDoubleSwords(state, attackerIdx, state.generals.indexOf(targetGeneral))
                }

                // 天香放弃 → 正常受伤
                if (ctx.skillId === 'xiaoqiao_tianxiang') {
                    const txCtx = ctx as any
                    const atkIdx = txCtx.attackerIndex as number
                    const atk = atkIdx >= 0 ? state.generals[atkIdx] : null
                    dealDamage(state, atk, targetGeneral, txCtx.damageAmount, txCtx.damageCardId)
                }

                // 神速一放弃 → 正常执行判定+摸牌+出牌
                if (ctx.skillId === 'xiahoyuan_shensu_1') {
                    continueTurnFromJudge(state, false, false, false)
                }

                // 神速二放弃 → 继续出牌阶段（什么都不做）
                // (ctx.skillId === 'xiahoyuan_shensu_2') — 无需额外处理

                // 青龙偃月刀放弃 → 不追杀（什么都不做）
                // (ctx.skillId === 'equip_green_dragon') — 无需额外处理

                // 寒冰剑放弃 → 正常造成伤害
                if (ctx.skillId === 'equip_ice_sword') {
                    const isCtx = ctx as any
                    const iceTarget = state.generals[isCtx.targetIndex as number]
                    if (iceTarget) {
                        let killDamage = isCtx.killDamage ?? 1
                        // 忠义加成
                        const allySameTeam = state.generals.filter(g => g.alive && g.faction === targetGeneral.faction)
                        if (allySameTeam.some(g => g.loyaltyCard)) killDamage += 1
                        dealDamage(state, targetGeneral, iceTarget, killDamage, isCtx.attackCard?.id)
                    }
                }

                // 贯石斧放弃 → 杀被完全抵消（什么都不做）
                // (ctx.skillId === 'equip_stone_axe') — 无需额外处理

                // 麒麟弓放弃 → 不弃马，但仍造成伤害
                if (ctx.skillId === 'equip_kylin_bow' || ctx.skillId === 'equip_kylin_bow_auto') {
                    const kbCtx = ctx as any
                    const kbTarget = state.generals[kbCtx.targetIndex as number]
                    if (kbTarget) {
                        dealDamage(state, targetGeneral, kbTarget, kbCtx.killDamage ?? 1, kbCtx.attackCard?.id)
                    }
                }

                // 准备阶段技能放弃后，检查是否需要推进回合
                continueFromPrepPhase(state)
                return
            }

            // 确认发动 → 根据 skillId 执行具体效果
            state.pendingResponseQueue.shift()
            const name = getGeneralName(targetGeneral)

            switch (ctx.skillId) {
                case 'caocao_jianxiong': {
                    // 奸雄：获得造成伤害的那张牌
                    const dmgCardId = ctx.damageCardId as string | undefined
                    if (dmgCardId) {
                        const idx = state.discard.findIndex(c => c.id === dmgCardId)
                        if (idx >= 0) {
                            const card = state.discard.splice(idx, 1)[0]
                            targetGeneral.hand.push(card)
                            addLog(state, `【${name}】发动【奸雄】，获得造成伤害的牌（${suitSymbol(card.suit)}${valueName(card.value)} ${card.name}）`)
                        }
                    }
                    return
                }
                case 'simayi_fankui': {
                    // 反馈：设置选牌 PendingResponse
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_FANKUI_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            sourceGeneralIndex: ctx.sourceGeneralIndex!,
                        },
                    })
                    addLog(state, `【${name}】发动【反馈】，选择获取一张牌`)
                    return
                }
                case 'guojia_yiji': {
                    // 遗计：先摸2张到手牌，然后将这2张分给任意角色（含自己）
                    const yijiCards = state.deck.splice(0, Math.min(2, state.deck.length))
                    if (yijiCards.length > 0) {
                        targetGeneral.hand.push(...yijiCards)
                        addLog(state, `【${name}】发动【遗计】，摸了 ${yijiCards.length} 张牌`)
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_YIJI_DISTRIBUTE,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                yijiCardIds: yijiCards.map(c => c.id),
                                remaining: yijiCards.length,
                            },
                        })
                        addLog(state, `请将 ${yijiCards.length} 张牌分配给任意角色（给自己=保留）`)
                    }
                    return
                }
                case 'xiahoudun_ganglie': {
                    // 刚烈：判定，非♥来源选弃2牌/受1伤
                    performSkillJudge(state, targetGeneral, 'ganglie', '刚烈', {
                        attackerGeneralIndex: ctx.attackerGeneralIndex!,
                    })
                    return
                }
                case 'pangde_mengjin': {
                    // 猛进确认：推选牌弃
                    const mengjinCtx = ctx as any
                    const mengjinTargetIdx = mengjinCtx.mengjinTargetIndex as number
                    addLog(state, `【${name}】发动【猛进】，选择弃【${getGeneralName(state.generals[mengjinTargetIdx])}】的一张牌`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            targetIndex: mengjinTargetIdx,
                            trickType: 'dismantle',
                        },
                    })
                    return
                }
                case 'machao_tieqi': {
                    // 铁骑：判定红色 → 目标不能出闪
                    const tieqiCtx = ctx as any
                    performSkillJudge(state, targetGeneral, 'tieqi', '铁骑', {
                        tieqiTargetIndex: tieqiCtx.tieqiTargetIndex,
                        attackCardId: tieqiCtx.attackCardId,
                    })
                    return
                }
                case 'zhenji_luoshen_continue': {
                    // 洛神继续判定
                    const interrupted = performSkillJudge(state, targetGeneral, 'luoshen', '洛神', {})
                    if (!interrupted) {
                        // 判定直接结算（无介入），需要推进回合
                        continueFromPrepPhase(state)
                    }
                    return
                }
                case 'zhangliao_tuxi': {
                    // 突袭确认：推选目标响应
                    addLog(state, `【${name}】发动【突袭】，选择至多2名有手牌的角色获取手牌`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_TUXI_CHOOSE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: { remainingPicks: 2, skipAction: (ctx as any).skipAction },
                    })
                    return
                }
                case 'zhugejin_hongyuan': {
                    // 弘援确认：标记弘援激活，摸牌阶段减少摸牌+友方摸牌
                    ;(targetGeneral as any).hongyuanActivated = true
                    addLog(state, `【${name}】选择发动【弘援】`)
                    continueFromPrepPhase(state)
                    return
                }
                case 'jiangwei_zhiji_choice': {
                    // 志继：回血或摸牌二选一（不可放弃）
                    if (action === 'heal' || action === 'confirm') {
                        targetGeneral.hp = Math.min(targetGeneral.hp + 1, targetGeneral.maxHp)
                        addLog(state, `【${name}】选择回复1点体力（${targetGeneral.hp}/${targetGeneral.maxHp}）`)
                    } else {
                        const drawn = drawCards(state, 2)
                        targetGeneral.hand.push(...drawn)
                        addLog(state, `【${name}】选择摸2张牌`)
                    }
                    continueFromPrepPhase(state)
                    return
                }
                case 'daqiao_liuli': {
                    // 流离：弃1牌（手牌或装备），将杀转移给攻击范围内另一角色
                    const atkCtx = ctx as any
                    const attackerIdx = atkCtx.attackerIndex as number
                    const attacker = state.generals[attackerIdx]

                    if (!data.cardId) return { error: '请选择一张牌弃置' }
                    // 先找到要弃的牌，检查是否是武器
                    const cardToDiscard = findCardInHandOrEquip(targetGeneral, data.cardId)
                    if (!cardToDiscard) return { error: '找不到此牌' }

                    // 模拟弃牌后的攻击范围：如果弃的是武器，临时移除来计算
                    const isWeapon = targetGeneral.equip.weapon?.id === data.cardId
                    const savedWeapon = isWeapon ? targetGeneral.equip.weapon : undefined
                    if (isWeapon) targetGeneral.equip.weapon = undefined as any

                    // 计算可转移目标
                    const candidates = state.generals.filter(g =>
                        g.alive && g !== targetGeneral && g !== attacker &&
                        getAttackRange(targetGeneral, g, state.generals).inRange
                    )

                    // 恢复武器（还没决定是否弃）
                    if (isWeapon) targetGeneral.equip.weapon = savedWeapon

                    if (candidates.length === 0) {
                        return { error: '弃此牌后无法转移目标（攻击范围内无其他角色），请重新选择' }
                    }

                    // 确认弃牌
                    const result = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                    if ('error' in result) return result

                    if (candidates.length === 1) {
                        const newTarget = candidates[0]
                        addLog(state, `【${name}】发动【流离】，将杀转移给【${getGeneralName(newTarget)}】`)
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.DODGE,
                            targetGeneralIndex: state.generals.indexOf(newTarget),
                            context: {
                                attackerGeneralIndex: attackerIdx,
                                requiredDodges: atkCtx.requiredDodges || 1,
                                dodgesReceived: 0,
                                attackCard: atkCtx.attackCard,
                            },
                        })
                        // 流离转移后，检查雌雄双股剑（对新目标）
                        maybeDoubleSwords(state, attackerIdx, state.generals.indexOf(newTarget))
                    } else {
                        const candidateIndices = candidates.map(g => state.generals.indexOf(g))
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_LIULI_REDIRECT,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                candidateIndices,
                                attackerIndex: attackerIdx,
                                requiredDodges: atkCtx.requiredDodges || 1,
                                attackCard: atkCtx.attackCard,
                            },
                        })
                        addLog(state, `【${name}】发动【流离】，请选择转移目标`)
                    }
                    return
                }
                case 'xiaoqiao_tianxiang': {
                    // 天香：弃1张♥手牌（红颜：♠也算♥），伤害转移给另一角色
                    const txCtx = ctx as any
                    const dmgAmount = txCtx.damageAmount as number || 1

                    // 红颜：♠视为♥，所以♥和♠手牌都可以弃
                    const isHeart = (c: Card) => {
                        if (c.suit === CardSuit.HEART) return true
                        if (c.suit === CardSuit.SPADE && hasSkill(targetGeneral, 'xiaoqiao_hongyan')) return true
                        return false
                    }

                    if (!data.cardId) return { error: '请选择一张♥手牌发动天香' }
                    let heartIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId && isHeart(c))
                    if (heartIdx < 0) {
                        // 无♥牌可弃 → 正常受伤
                        const atkIdx = txCtx.attackerIndex as number
                        const atk = atkIdx >= 0 ? state.generals[atkIdx] : null
                        dealDamage(state, atk, targetGeneral, dmgAmount, txCtx.damageCardId)
                        return
                    }
                    state.discard.push(targetGeneral.hand.splice(heartIdx, 1)[0])

                    // 让玩家选择转移目标
                    const others = state.generals.filter(g => g.alive && g !== targetGeneral)
                    if (others.length > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_TIANXIANG_CHOOSE,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                damageAmount: dmgAmount,
                                attackerIndex: txCtx.attackerIndex as number,
                                damageCardId: txCtx.damageCardId,
                            },
                        })
                        addLog(state, `【${name}】发动【天香】，请选择转移目标`)
                    }
                    return
                }
                case 'xiahoyuan_shensu_1': {
                    // 神速一：跳过判定+摸牌，让玩家选杀目标
                    addLog(state, `【${name}】发动【神速一】，跳过判定和摸牌阶段`)
                    continueTurnFromJudge(state, true, true, false)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_SHENSU_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: { shensuPhase: 1 },
                    })
                    return
                }
                case 'xiahoyuan_shensu_2': {
                    // 神速二：先选弃装备牌（已装备或手牌中的），再选杀目标
                    const equipSlots = [EquipSlot.WEAPON, EquipSlot.ARMOR, EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE] as const
                    const validSlots = equipSlots.filter(s => targetGeneral.equip[s] != null)
                    const handEquips = targetGeneral.hand.filter(c => c.category === CardCategory.EQUIPMENT)
                    if (validSlots.length === 0 && handEquips.length === 0) return { error: '没有装备牌可弃' }
                    addLog(state, `【${name}】发动【神速二】，选择弃一张装备牌`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_SHENSU_EQUIP,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {},
                    })
                    return
                }
                case 'equip_green_dragon': {
                    // 青龙偃月刀追杀：玩家选择一张杀牌
                    const gdCtx = ctx as any
                    const killTargetIdx = gdCtx.targetIndex as number
                    const killTarget = state.generals[killTargetIdx]
                    if (!killTarget?.alive) return { error: '目标不存在' }

                    // 使用玩家选择的杀牌
                    if (!data.cardId) return { error: '请选择一张杀牌' }
                    const killIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                    if (killIdx < 0) return { error: '手牌中找不到此牌' }
                    const killCard = targetGeneral.hand[killIdx]
                    if (!isCardUsableAsAttack(targetGeneral, killCard)) return { error: '此牌不能当杀使用' }
                    targetGeneral.hand.splice(killIdx, 1)
                    state.discard.push(killCard)

                    addLog(state, `【${name}】发动【青龙偃月刀】对【${getGeneralName(killTarget)}】追杀`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: killTargetIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                            attackCard: killCard,
                            requiredDodges: 1,
                            dodgesReceived: 0,
                        },
                    })
                    return
                }
                case 'equip_ice_sword': {
                    // 寒冰剑：弃目标2张牌，不造成伤害 → 推交互选牌
                    const isCtx = ctx as any
                    const iceTarget = state.generals[isCtx.targetIndex as number]
                    if (!iceTarget) return { error: '目标不存在' }

                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_ICE_SWORD_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            iceTargetIndex: isCtx.targetIndex as number,
                            remainingPicks: 2,
                        },
                    })
                    addLog(state, `【${name}】发动【寒冰剑】，请选择弃【${getGeneralName(iceTarget)}】的牌`)
                    return
                }
                case 'equip_stone_axe': {
                    // 贯石斧：弃2张牌（手牌或装备，不含贯石斧自身），使杀仍然命中
                    const saCtx = ctx as any
                    const saTarget = state.generals[saCtx.targetIndex as number]
                    if (!saTarget?.alive) return { error: '目标不存在' }

                    const cardIds = (data as any).cardIds as string[] | undefined
                    if (!cardIds || cardIds.length !== 2) return { error: '请选择2张牌弃置' }

                    // 不能弃贯石斧自身
                    const axeId = targetGeneral.equip.weapon?.id
                    if (cardIds.includes(axeId!)) return { error: '不能弃置正在使用的贯石斧' }

                    // 验证牌存在
                    for (const cid of cardIds) {
                        const card = findCardInHandOrEquip(targetGeneral, cid)
                        if (!card) return { error: '找不到选择的牌' }
                    }
                    // 逐张弃牌
                    for (const cid of cardIds) {
                        removeCardFromHandOrEquip(state, targetGeneral, cid)
                    }

                    const axeDiscarded = cardIds.map(cid => state.discard.find(c => c.id === cid)).filter(Boolean) as Card[]
                    addLog(state, `【${name}】发动【贯石斧】弃${axeDiscarded.map(c => cardFullName(c)).join('、')}，【杀】仍然命中`)

                    // 造成伤害
                    const killDamage = calcKillDamage(state, targetGeneral)
                    dealDamage(state, targetGeneral, saTarget, killDamage, saCtx.attackCard?.id)
                    return
                }
                case 'equip_double_swords': {
                    // 雌雄双股剑：令目标选择弃1牌或让攻击者摸1牌
                    const dsCtx = ctx as any
                    const dsTargetIdx = dsCtx.targetIndex as number
                    const dsTarget = state.generals[dsTargetIdx]
                    if (!dsTarget?.alive) return { error: '目标不存在' }

                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE,
                        targetGeneralIndex: dsTargetIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                        },
                    })
                    addLog(state, `【${name}】发动【雌雄双股剑】`)
                    return
                }
                case 'equip_kylin_bow': {
                    // 麒麟弓（两匹马）：推马的选择
                    const kbCtx = ctx as any
                    const kbTargetIdx = kbCtx.targetIndex as number
                    const kbTarget = state.generals[kbTargetIdx]
                    if (!kbTarget?.alive) {
                        // 目标已死，直接造伤
                        dealDamage(state, targetGeneral, kbTarget, kbCtx.killDamage ?? 1, kbCtx.attackCard?.id)
                        return
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_KYLIN_BOW_CHOICE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            targetIndex: kbTargetIdx,
                            killDamage: kbCtx.killDamage ?? 1,
                            attackCard: kbCtx.attackCard,
                        },
                    })
                    return
                }
                case 'equip_kylin_bow_auto': {
                    // 麒麟弓（只有一匹马）：自动弃那匹马
                    const kaCtx = ctx as any
                    const kaTargetIdx = kaCtx.targetIndex as number
                    const kaTarget = state.generals[kaTargetIdx]
                    if (kaTarget?.alive) {
                        const horseType = kaCtx.horseType as 'plus' | 'minus'
                        const slot = horseType === 'plus' ? 'plus_horse' : 'minus_horse'
                        const horseCard = kaTarget.equip[slot as keyof typeof kaTarget.equip]
                        if (horseCard) {
                            kaTarget.equip[slot as keyof typeof kaTarget.equip] = undefined as any
                            state.discard.push(horseCard)
                            triggerXiaoji(state, kaTarget)
                            addLog(state, `【${name}】发动【麒麟弓】弃了【${getGeneralName(kaTarget)}】的坐骑`)
                        }
                    }
                    dealDamage(state, targetGeneral, kaTarget, kaCtx.killDamage ?? 1, kaCtx.attackCard?.id)
                    return
                }
                default:
                    addLog(state, `【${name}】发动了【${ctx.skillName}】`)
                    return
            }
        }

        // ── 遗计分配：从手牌中选择 yiji 牌分给其他角色
        case ResponseType.SKILL_YIJI_DISTRIBUTE: {
            const ctx = pending.context as { yijiCardIds: string[]; remaining: number }
            const targetIdx = (data as any).targetIndex as number | undefined
            // 支持单张 cardId 或多张 cardIds
            const multiCardIds = (data as any).cardIds as string[] | undefined
            const singleCardId = data.cardId
            const cardIdsToGive: string[] = multiCardIds ?? (singleCardId ? [singleCardId] : [])

            if (cardIdsToGive.length > 0 && targetIdx !== undefined) {
                // 校验数量
                if (cardIdsToGive.length > ctx.remaining) return { error: `最多还能分配${ctx.remaining}张牌` }
                // 校验每张牌
                for (const cid of cardIdsToGive) {
                    if (!ctx.yijiCardIds.includes(cid)) return { error: '此牌不是遗计可分配的牌' }
                    const cardIdx = targetGeneral.hand.findIndex(c => c.id === cid)
                    if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                }
                const recipient = state.generals[targetIdx]
                if (!recipient?.alive) return { error: '目标不存在' }

                const count = cardIdsToGive.length
                if (recipient !== targetGeneral) {
                    // 给别人
                    for (const cid of cardIdsToGive) {
                        const cardIdx = targetGeneral.hand.findIndex(c => c.id === cid)
                        const card = targetGeneral.hand.splice(cardIdx, 1)[0]
                        recipient.hand.push(card)
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】将${count}张牌交给了【${getGeneralName(recipient)}】`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】保留了${count}张牌`)
                }

                ctx.yijiCardIds = ctx.yijiCardIds.filter(id => !cardIdsToGive.includes(id))
                ctx.remaining -= count
                if (ctx.remaining <= 0) {
                    state.pendingResponseQueue.shift()
                }
            } else {
                // 跳过 → 剩余牌全部保留在自己手中
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】保留了剩余的牌`)
            }
            return
        }

        // ── 刚烈：伤害来源选择弃2手牌或受1伤
        case ResponseType.SKILL_GANGLIE_CHOICE: {
            const ctx = pending.context as { ganglieSourceIndex: number }
            const ganglieUser = state.generals[ctx.ganglieSourceIndex]
            if (data.cardId === 'discard') {
                // 选择弃2张手牌
                if (targetGeneral.hand.length < 2) {
                    // 手牌不足，只能受伤
                    dealDamage(state, ganglieUser, targetGeneral, 1)
                    state.pendingResponseQueue.shift()
                    return
                }
                const cardIds = (data as any).cardIds as string[] | undefined
                if (!cardIds || cardIds.length !== 2) return { error: '请选择2张手牌弃置' }
                for (const id of cardIds) {
                    const idx = targetGeneral.hand.findIndex(c => c.id === id)
                    if (idx === -1) return { error: '手牌中找不到指定的牌' }
                    state.discard.push(targetGeneral.hand.splice(idx, 1)[0])
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】弃置了2张手牌`)
                state.pendingResponseQueue.shift()
            } else {
                // 选择受1伤（或默认放弃）
                state.pendingResponseQueue.shift()
                dealDamage(state, ganglieUser, targetGeneral, 1)
            }
            return
        }

        // ── 观星（诸葛亮）：排列牌堆顶/底
        case ResponseType.SKILL_GUANXING_ARRANGE: {
            const ctx = pending.context as { guanxingCards: Card[] }
            const topIds = (data as any).topCardIds as string[] | undefined ?? []
            const bottomIds = (data as any).bottomCardIds as string[] | undefined ?? []
            const allIds = ctx.guanxingCards.map(c => c.id)

            // 验证：所有牌必须被分配
            const submitted = [...topIds, ...bottomIds]
            if (submitted.length !== allIds.length || !submitted.every(id => allIds.includes(id))) {
                return { error: '请将所有牌分配到牌堆顶或牌堆底' }
            }

            // 按顺序放入牌堆
            const topCards = topIds.map(id => ctx.guanxingCards.find(c => c.id === id)!)
            const bottomCards = bottomIds.map(id => ctx.guanxingCards.find(c => c.id === id)!)
            state.deck.unshift(...topCards)
            state.deck.push(...bottomCards)

            addLog(state, `【${getGeneralName(targetGeneral)}】完成【观星】排列（${topCards.length}张置顶，${bottomCards.length}张置底）`)
            state.pendingResponseQueue.shift()
            continueFromPrepPhase(state)
            return
        }

        // ── 突袭（张辽）：选择至多2名角色各偷1张手牌
        case ResponseType.SKILL_TUXI_CHOOSE: {
            const ctx = pending.context as { remainingPicks: number; pickedIndices?: number[] }
            if (!ctx.pickedIndices) ctx.pickedIndices = []
            // 支持单目标 targetIndex 或 多目标 targetIndices
            const singleIdx = (data as any).targetIndex as number | undefined
            const multiIdx = (data as any).targetIndices as number[] | undefined
            const targetIndices: number[] = multiIdx ?? (singleIdx !== undefined ? [singleIdx] : [])

            if (targetIndices.length > 0) {
                // 校验数量
                if (targetIndices.length > ctx.remainingPicks) return { error: `最多还能选${ctx.remainingPicks}名角色` }
                // 校验去重
                const uniqueSet = new Set(targetIndices)
                if (uniqueSet.size !== targetIndices.length) return { error: '不能选择相同的角色' }

                for (const tIdx of targetIndices) {
                    const victim = state.generals[tIdx]
                    if (!victim?.alive || victim.hand.length === 0) return { error: `【${getGeneralName(victim)}】没有手牌` }
                    if (ctx.pickedIndices.includes(tIdx)) return { error: '已经选过此角色' }
                    if (tIdx === pending.targetGeneralIndex) return { error: '不能选自己' }
                }

                // 逐个获取手牌
                for (const tIdx of targetIndices) {
                    const victim = state.generals[tIdx]
                    const randIdx = Math.floor(Math.random() * victim.hand.length)
                    targetGeneral.hand.push(victim.hand.splice(randIdx, 1)[0])
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【突袭】，获取了【${getGeneralName(victim)}】的一张手牌`)
                    ctx.pickedIndices.push(tIdx)
                    ctx.remainingPicks -= 1
                }

                if (ctx.remainingPicks <= 0) {
                    state.pendingResponseQueue.shift()
                    if ((ctx as any).skipAction) {
                        state.turnPhase = TurnPhase.DISCARD
                        if (targetGeneral.hand.length <= targetGeneral.hp) {
                            finishTurn(state)
                        }
                    } else {
                        state.turnPhase = TurnPhase.ACTION
                        addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                    }
                }
            } else {
                // 手动结束
                state.pendingResponseQueue.shift()
                if ((ctx as any).skipAction) {
                    state.turnPhase = TurnPhase.DISCARD
                    if (targetGeneral.hand.length <= targetGeneral.hp) {
                        finishTurn(state)
                    }
                } else {
                    state.turnPhase = TurnPhase.ACTION
                    addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                }
            }
            return
        }

        // ── 神速：选杀目标
        case ResponseType.SKILL_SHENSU_TARGET: {
            const ctx = pending.context as { shensuPhase: number }
            const shensuTargetIdx = (data as any).targetIndex as number | undefined
            if (shensuTargetIdx === undefined) return { error: '请选择一个目标' }
            const shensuTarget = state.generals[shensuTargetIdx]
            if (!shensuTarget?.alive) return { error: '目标不存在' }
            if (shensuTargetIdx === pending.targetGeneralIndex) return { error: '不能选自己' }

            addLog(state, `【${getGeneralName(targetGeneral)}】视为对【${getGeneralName(shensuTarget)}】使用了【杀】`)
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: shensuTargetIdx,
                context: {
                    attackerGeneralIndex: pending.targetGeneralIndex,
                    requiredDodges: 1,
                    dodgesReceived: 0,
                },
            })
            return
        }

        // ── 神速二：选弃装备（已装备 或 手牌中的装备牌）
        case ResponseType.SKILL_SHENSU_EQUIP: {
            const action = (data as any).action as string | undefined

            if (action && ['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                // 弃已装备的装备
                const slot = action as keyof typeof targetGeneral.equip
                const equipCard = targetGeneral.equip[slot]
                if (!equipCard) return { error: '该装备栏为空' }
                targetGeneral.equip[slot] = undefined as any
                state.discard.push(equipCard)
                triggerXiaoji(state, targetGeneral)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【神速二】，弃置装备【${cardDisplayName(equipCard)}】`)
            } else if (data.cardId) {
                // 弃手牌中的装备牌
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (card.category !== CardCategory.EQUIPMENT) return { error: '此牌不是装备牌' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【神速二】，弃置手牌中的装备牌【${cardDisplayName(card)}】`)
            } else {
                return { error: '请选择要弃置的装备' }
            }

            // 弃装备后，跳过出牌阶段并选杀目标
            state.pendingResponseQueue.shift()
            state.turnPhase = TurnPhase.DISCARD
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_SHENSU_TARGET,
                targetGeneralIndex: pending.targetGeneralIndex,
                context: { shensuPhase: 2 },
            })
            return
        }

        // ── 反馈（司马懿）：选伤害来源的一张牌
        case ResponseType.SKILL_FANKUI_PICK: {
            const ctx = pending.context as { sourceGeneralIndex: number }
            const source = state.generals[ctx.sourceGeneralIndex]
            if (!data.cardId) {
                return { error: '请选择一张牌（已确认发动反馈，不能放弃）' }
            }
            // 随机手牌
            if (data.cardId === '__random_hand__') {
                if (source.hand.length === 0) return { error: '来源没有手牌' }
                const randIdx = Math.floor(Math.random() * source.hand.length)
                targetGeneral.hand.push(source.hand.splice(randIdx, 1)[0])
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的一张手牌`)
                state.pendingResponseQueue.shift()
                return
            }
            // 从来源手牌获取
            const fromHandIdx = source.hand.findIndex(c => c.id === data.cardId)
            if (fromHandIdx >= 0) {
                targetGeneral.hand.push(source.hand.splice(fromHandIdx, 1)[0])
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的一张手牌`)
                state.pendingResponseQueue.shift()
                return
            }
            // 从来源装备获取
            for (const slot of Object.values(EquipSlot)) {
                if (source.equip[slot]?.id === data.cardId) {
                    targetGeneral.hand.push(source.equip[slot]!)
                    source.equip[slot] = undefined
                    triggerXiaoji(state, source)
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的装备`)
                    state.pendingResponseQueue.shift()
                    return
                }
            }
            return { error: '指定的牌不存在' }
        }

        // ── 反间（周瑜）：目标选花色
        case ResponseType.SKILL_FANJIAN_SUIT: {
            const ctx = pending.context as { fanjianUserIndex: number }
            const fanjianUser = state.generals[ctx.fanjianUserIndex]
            const chosenSuit = (data as any).suit as string | undefined
            if (!chosenSuit || !['heart', 'diamond', 'spade', 'club'].includes(chosenSuit)) {
                return { error: '请选择一种花色（heart/diamond/spade/club）' }
            }
            // 随机取周瑜一张手牌
            if (fanjianUser.hand.length === 0) {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(fanjianUser)}】没有手牌，反间失效`)
                return
            }
            const randIdx = Math.floor(Math.random() * fanjianUser.hand.length)
            const givenCard = fanjianUser.hand.splice(randIdx, 1)[0]
            addLog(state, `【${getGeneralName(targetGeneral)}】选择了${suitSymbol(chosenSuit as CardSuit)}`)
            addLog(state, `随机抽取的牌为【${suitSymbol(givenCard.suit)}${valueName(givenCard.value)}】`)
            if (givenCard.suit !== chosenSuit) {
                addLog(state, `花色不同！对【${getGeneralName(targetGeneral)}】造成1点伤害`)
                // 无论花色是否相同，对手都获得这张牌
                targetGeneral.hand.push(givenCard)
                state.pendingResponseQueue.shift()
                dealDamage(state, fanjianUser, targetGeneral, 1)
            } else {
                addLog(state, `花色相同，无伤害`)
                // 无论花色是否相同，对手都获得这张牌
                targetGeneral.hand.push(givenCard)
                state.pendingResponseQueue.shift()
            }
            return
        }

        // ── 挑衅：目标选择出杀或放弃
        case ResponseType.SKILL_TIAOXIN_RESPONSE: {
            const ctx = pending.context as { tiaoxinUserIndex: number }
            const tiaoxinUser = state.generals[ctx.tiaoxinUserIndex]
            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出了一张【杀】`)
                state.pendingResponseQueue.shift()
                // 杀的效果 → 挑衅发起者需出闪
                state.pendingResponseQueue.unshift({
                    type: ResponseType.DODGE,
                    targetGeneralIndex: ctx.tiaoxinUserIndex,
                    context: {
                        attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                        requiredDodges: 1,
                        dodgesReceived: 0,
                        attackCard: card,
                    },
                })
            } else {
                // 放弃 → 姜维选目标的手牌或装备弃掉
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀`)
                state.pendingResponseQueue.shift()
                const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: ctx.tiaoxinUserIndex,
                        context: {
                            targetIndex: state.generals.indexOf(targetGeneral),
                            trickType: 'dismantle',
                        },
                    })
                    addLog(state, `【${getGeneralName(tiaoxinUser)}】选择弃掉【${getGeneralName(targetGeneral)}】的一张牌`)
                }
            }
            return
        }

        // ── 乱武：每个角色依次出杀或失血
        case ResponseType.SKILL_LUANWU_RESPONSE: {
            const ctx = pending.context as {
                luanwuUserIndex: number
                remainingIndices: number[]
                nearestIndices: number[]
            }

            // 准备下一个角色的响应
            const prepareNext = () => {
                while (ctx.remainingIndices.length > 0 && !checkGameOver(state).over) {
                    const nextIdx = ctx.remainingIndices.shift()!
                    const nextGeneral = state.generals[nextIdx]
                    if (!nextGeneral?.alive) continue
                    // 为下一个角色计算距离最近的目标
                    const nextNearest = findNearestTargets(state, nextGeneral)
                    if (nextNearest.length === 0) continue // 无存活目标，跳过
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_LUANWU_RESPONSE,
                        targetGeneralIndex: nextIdx,
                        context: {
                            luanwuUserIndex: ctx.luanwuUserIndex,
                            remainingIndices: ctx.remainingIndices,
                            nearestIndices: nextNearest,
                        },
                    })
                    const nearestNames = nextNearest.map(i => getGeneralName(state.generals[i])).join('、')
                    addLog(state, `【${getGeneralName(nextGeneral)}】：距离最近的角色为【${nearestNames}】，请出【杀】或放弃（失去1血）`)
                    return
                }
            }

            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)

                state.pendingResponseQueue.shift()

                if (ctx.nearestIndices.length === 1) {
                    // 唯一最近 → 直接对该角色使用杀
                    const nearestIdx = ctx.nearestIndices[0]
                    const nearest = state.generals[nearestIdx]
                    addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中对【${getGeneralName(nearest)}】使用了【杀】`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: nearestIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                            attackCard: card,
                            requiredDodges: 1,
                            dodgesReceived: 0,
                        },
                    })
                } else if (ctx.nearestIndices.length > 1) {
                    // 多个最近 → 让玩家选目标
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_LUANWU_PICK_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackCard: card,
                            candidateIndices: ctx.nearestIndices,
                        },
                    })
                    const names = ctx.nearestIndices.map(i => getGeneralName(state.generals[i])).join('、')
                    addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中出杀，距离最近有多人（${names}），请选择目标`)
                }

                prepareNext()
            } else {
                // 放弃 → 失去1点体力
                state.pendingResponseQueue.shift()
                loseHp(state, targetGeneral, 1)
                prepareNext()
            }
            return
        }

        // ── 英魂（孙坚）：选目标+模式
        case ResponseType.SKILL_YINGHUN_CHOOSE: {
            const ctx = pending.context as { lostHp: number }
            const yAction = (data as any).action as string
            const yTargetIdx = (data as any).targetIndex as number

            if (yAction === 'skip') {
                // 放弃
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【英魂】`)
                state.pendingResponseQueue.shift()
                continueFromPrepPhase(state)
                return
            }

            if (yTargetIdx == null || yTargetIdx < 0 || yTargetIdx >= state.generals.length) {
                return { error: '请选择一名其他角色' }
            }
            const yTarget = state.generals[yTargetIdx]
            if (!yTarget?.alive || yTarget === targetGeneral) return { error: '目标无效' }

            const lostHp = ctx.lostHp || 1

            if (yAction === 'modeB') {
                // 模式B：摸1弃X
                const drawn = drawCards(state, 1)
                yTarget.hand.push(...drawn)
                const discardCount = Math.min(lostHp, yTarget.hand.length + Object.values(yTarget.equip).filter(e => e != null).length)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【英魂】B，【${getGeneralName(yTarget)}】摸1张，需弃${discardCount}张`)
                state.pendingResponseQueue.shift()
                if (discardCount > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_YINGHUN_DISCARD,
                        targetGeneralIndex: yTargetIdx,
                        context: { discardCount },
                    })
                } else {
                    continueFromPrepPhase(state)
                }
            } else {
                // 模式A：摸X弃1
                const drawn = drawCards(state, lostHp)
                yTarget.hand.push(...drawn)
                const discardCount = Math.min(1, yTarget.hand.length + Object.values(yTarget.equip).filter(e => e != null).length)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【英魂】A，【${getGeneralName(yTarget)}】摸${lostHp}张，需弃1张`)
                state.pendingResponseQueue.shift()
                if (discardCount > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_YINGHUN_DISCARD,
                        targetGeneralIndex: yTargetIdx,
                        context: { discardCount },
                    })
                } else {
                    continueFromPrepPhase(state)
                }
            }

            return
        }

        // ── 英魂弃牌：目标选择弃哪些牌（手牌/装备）
        case ResponseType.SKILL_YINGHUN_DISCARD: {
            const ctx = pending.context as { discardCount: number }
            const cardIds = (data as any).cardIds as string[] | undefined ?? []
            const equipSlots = (data as any).equipSlots as string[] | undefined ?? []
            const totalDiscard = cardIds.length + equipSlots.length

            if (totalDiscard !== ctx.discardCount) {
                return { error: `需要弃${ctx.discardCount}张牌（当前选了${totalDiscard}张）` }
            }

            // 弃手牌
            const discardedNames: string[] = []
            for (const cid of cardIds) {
                const idx = targetGeneral.hand.findIndex(c => c.id === cid)
                if (idx === -1) return { error: '手牌中找不到该牌' }
                const card = targetGeneral.hand.splice(idx, 1)[0]
                state.discard.push(card)
                discardedNames.push(cardDisplayName(card))
            }

            // 弃装备
            for (const slot of equipSlots) {
                const s = slot as keyof typeof targetGeneral.equip
                const equipCard = targetGeneral.equip[s]
                if (!equipCard) return { error: `装备栏 ${slot} 为空` }
                targetGeneral.equip[s] = undefined as any
                state.discard.push(equipCard)
                discardedNames.push(cardDisplayName(equipCard))
                triggerXiaoji(state, targetGeneral)
            }

            addLog(state, `【${getGeneralName(targetGeneral)}】英魂弃牌：${discardedNames.join('、')}`)
            state.pendingResponseQueue.shift()
            continueFromPrepPhase(state)
            return
        }

        // ── 天香选目标
        case ResponseType.SKILL_TIANXIANG_CHOOSE: {
            const ctx = pending.context as { damageAmount: number; attackerIndex: number; damageCardId?: string }
            const chosenIdx = (data as any).targetIndex as number
            if (chosenIdx == null || chosenIdx < 0 || chosenIdx >= state.generals.length) {
                return { error: '请选择一名其他角色' }
            }
            const newTarget = state.generals[chosenIdx]
            if (!newTarget?.alive || newTarget === targetGeneral) return { error: '目标无效' }

            addLog(state, `【${getGeneralName(targetGeneral)}】发动【天香】，将伤害转移给【${getGeneralName(newTarget)}】`)
            state.pendingResponseQueue.shift()

            // 对新目标造成伤害（会触发濒死）
            const atk = ctx.attackerIndex >= 0 ? state.generals[ctx.attackerIndex] : null
            dealDamage(state, atk, newTarget, ctx.damageAmount, ctx.damageCardId)

            // 新目标存活则摸X张牌（X=当前已损失体力值）
            if (newTarget.alive) {
                const lostHp = Math.max(0, newTarget.maxHp - newTarget.hp)
                if (lostHp > 0) {
                    const drawn = drawCards(state, lostHp)
                    newTarget.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(newTarget)}】因天香摸${lostHp}张牌`)
                }
            }
            return
        }

        // ── 流离选目标
        case ResponseType.SKILL_LIULI_REDIRECT: {
            const ctx = pending.context as {
                candidateIndices: number[]
                attackerIndex: number
                requiredDodges: number
                attackCard?: Card
            }
            const chosenIdx = (data as any).targetIndex as number
            if (!ctx.candidateIndices.includes(chosenIdx)) return { error: '请从候选角色中选择' }
            const newTarget = state.generals[chosenIdx]
            if (!newTarget?.alive) return { error: '目标无效' }
            addLog(state, `【${getGeneralName(targetGeneral)}】将杀转移给【${getGeneralName(newTarget)}】`)
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: chosenIdx,
                context: {
                    attackerGeneralIndex: ctx.attackerIndex,
                    requiredDodges: ctx.requiredDodges || 1,
                    dodgesReceived: 0,
                    attackCard: ctx.attackCard,
                },
            })
            // 流离转移后，检查雌雄双股剑（对新目标）
            maybeDoubleSwords(state, ctx.attackerIndex, chosenIdx)
            return
        }

        // ── 乱武选目标：距离最近有多人时由玩家指定
        case ResponseType.SKILL_LUANWU_PICK_TARGET: {
            const ctx = pending.context as { attackCard: Card; candidateIndices: number[] }
            const targetIdx = (data as any).targetIndex as number | undefined
            if (targetIdx === undefined || !ctx.candidateIndices.includes(targetIdx)) {
                const names = ctx.candidateIndices.map(i => getGeneralName(state.generals[i])).join('、')
                return { error: `请选择一个目标（${names}）` }
            }
            const chosen = state.generals[targetIdx]
            if (!chosen?.alive) return { error: '目标角色不存在' }

            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中对【${getGeneralName(chosen)}】使用了【杀】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                    attackCard: ctx.attackCard,
                    requiredDodges: 1,
                    dodgesReceived: 0,
                },
            })
            return
        }

        // ── 借刀杀人：出杀或交武器
        case ResponseType.BORROW_SWORD_RESPONSE: {
            const ctx = pending.context as { userIndex: number; killTargetIndex: number }
            const user = state.generals[ctx.userIndex]
            const killTarget = state.generals[ctx.killTargetIndex]

            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有这张牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }

                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】借刀杀人中对【${getGeneralName(killTarget)}】出了【杀】`)

                state.pendingResponseQueue.shift()

                // 目标需要出闪
                if (killTarget.alive) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: ctx.killTargetIndex,
                        context: {
                            attackerGeneralIndex: pending.targetGeneralIndex,
                            attackCard: card,
                            requiredDodges: 1,
                            dodgesReceived: 0,
                        },
                    })
                }
            } else {
                // 不出杀 → 交出武器
                if (targetGeneral.equip.weapon) {
                    const weapon = targetGeneral.equip.weapon
                    targetGeneral.equip.weapon = undefined
                    user.hand.push(weapon)
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀，将武器【${cardDisplayName(weapon)}】交给【${getGeneralName(user)}】`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀但已无武器`)
                }
                state.pendingResponseQueue.shift()
            }
            return
        }

        // ── 过河拆桥/顺手牵羊：使用者选目标的牌
        case ResponseType.TRICK_TARGET_CARD_PICK: {
            const ctx = pending.context as { trickType: 'dismantle' | 'steal'; targetIndex: number }
            const pickTarget = state.generals[ctx.targetIndex]
            if (!pickTarget?.alive) {
                state.pendingResponseQueue.shift()
                return
            }
            const pickerName = getGeneralName(targetGeneral)
            const targetName = getGeneralName(pickTarget)
            const action = (data as any).action as string

            if (action === 'hand') {
                // 随机一张手牌
                if (pickTarget.hand.length === 0) return { error: '目标没有手牌' }
                const randIdx = Math.floor(Math.random() * pickTarget.hand.length)
                const card = pickTarget.hand.splice(randIdx, 1)[0]
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(card)
                    addLog(state, `【${pickerName}】【过河拆桥】弃了【${targetName}】的手牌【${cardDisplayName(card)}】`)
                    checkMingzhe(state, pickTarget, card)
                } else {
                    targetGeneral.hand.push(card)
                    addLog(state, `【${pickerName}】【顺手牵羊】从【${targetName}】处拿了一张手牌`)
                }
            } else if (['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                const slot = action as keyof typeof pickTarget.equip
                const equipCard = pickTarget.equip[slot]
                if (!equipCard) return { error: '目标该装备栏为空' }
                pickTarget.equip[slot] = undefined as any
                triggerXiaoji(state, pickTarget)
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(equipCard)
                    addLog(state, `【${pickerName}】【过河拆桥】弃了【${targetName}】的装备【${cardDisplayName(equipCard)}】`)
                    checkMingzhe(state, pickTarget, equipCard)
                } else {
                    targetGeneral.hand.push(equipCard)
                    addLog(state, `【${pickerName}】【顺手牵羊】从【${targetName}】处拿了装备【${cardDisplayName(equipCard)}】`)
                }
            } else if (action === 'judge') {
                // 判定区的牌
                const judgeCardId = (data as any).cardId as string | undefined
                if (!judgeCardId) return { error: '请指定判定区的牌' }
                const judgeIdx = pickTarget.judgeZone.findIndex((c: Card) => c.id === judgeCardId)
                if (judgeIdx === -1) return { error: '目标判定区没有此牌' }
                const judgeCard = pickTarget.judgeZone.splice(judgeIdx, 1)[0]
                const judgeName = judgeCard.name === TrickCardName.OVERINDULGENCE ? '乐不思蜀' : '兵粮寸断'
                // 恢复原始身份（断粮/国色转换的牌离开判定区后恢复原貌）
                if (judgeCard.originalName) {
                    judgeCard.name = judgeCard.originalName
                    judgeCard.category = judgeCard.originalCategory!
                    delete judgeCard.originalName
                    delete judgeCard.originalCategory
                    delete judgeCard.trickType
                }
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(judgeCard)
                    addLog(state, `【${pickerName}】【过河拆桥】弃了【${targetName}】判定区的【${judgeName}】`)
                } else {
                    targetGeneral.hand.push(judgeCard)
                    addLog(state, `【${pickerName}】【顺手牵羊】从【${targetName}】判定区拿了【${judgeName}】`)
                }
            } else {
                return { error: '无效选择' }
            }

            state.pendingResponseQueue.shift()
            return
        }

        // ── 无懈可击已迁移到独立的 negateWindow 机制，不再通过 pendingResponseQueue 处理 ──

        // ── 万箭齐发：出闪或受伤
        case ResponseType.AOE_DODGE: {
            const ctx = pending.context as { sourceGeneralIndex: number; sourceCardId: string }
            const source = state.generals[ctx.sourceGeneralIndex]
            const action = (data as any).action as string | undefined

            // 八卦阵判定
            if (action === 'eight_trigrams') {
                if (targetGeneral.equip.armor?.name !== EquipmentCardName.EIGHT_TRIGRAMS) return { error: '未装备八卦阵' }
                if (state.deck.length === 0) return { error: '牌堆为空' }
                performSkillJudge(state, targetGeneral, 'eight_trigrams', '八卦阵', {
                    pendingType: 'AOE_DODGE',
                })
                return
            }

            if (data.cardId) {
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsDodge(targetGeneral, card)) return { error: '此牌不能当【闪】使用' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出【闪】抵挡万箭齐发`)
            } else {
                addLog(state, `【${getGeneralName(targetGeneral)}】未出【闪】`)
                state.pendingResponseQueue.shift()
                dealDamage(state, source, targetGeneral, 1, ctx.sourceCardId)
                return
            }
            state.pendingResponseQueue.shift()
            return
        }

        // ── 南蛮入侵：出杀或受伤
        case ResponseType.AOE_ATTACK: {
            const ctx = pending.context as { sourceGeneralIndex: number; sourceCardId: string }
            const source = state.generals[ctx.sourceGeneralIndex]
            if (data.cardId) {
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '此牌不能当【杀】使用' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出【杀】抵挡南蛮入侵`)
            } else {
                addLog(state, `【${getGeneralName(targetGeneral)}】未出【杀】`)
                state.pendingResponseQueue.shift()
                dealDamage(state, source, targetGeneral, 1, ctx.sourceCardId)
                return
            }
            state.pendingResponseQueue.shift()
            return
        }

        // ── 雌雄双股剑：目标选择弃1牌或让对方摸1牌
        case ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE: {
            const ctx = pending.context as { attackerGeneralIndex: number }
            const attacker = state.generals[ctx.attackerGeneralIndex]
            const dsAction = (data as any).action as string

            if (dsAction === 'discard') {
                if (!data.cardId) return { error: '请选择一张手牌弃置' }
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand.splice(cardIdx, 1)[0]
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃置1张手牌（雌雄双股剑）`)
            } else {
                // draw：让攻击者摸1牌
                const drawn = drawCards(state, 1)
                attacker.hand.push(...drawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】让【${getGeneralName(attacker)}】摸1张牌（雌雄双股剑）`)
            }
            state.pendingResponseQueue.shift()
            return
        }

        // ── 麒麟弓：选择弃哪匹马
        case ResponseType.EQUIP_KYLIN_BOW_CHOICE: {
            const ctx = pending.context as { targetIndex: number; killDamage: number; attackCard?: Card }
            const kbTarget = state.generals[ctx.targetIndex]
            const horseChoice = (data as any).action as string // 'plus' or 'minus'

            if (kbTarget?.alive) {
                if (horseChoice === 'plus' && kbTarget.equip.plus_horse) {
                    state.discard.push(kbTarget.equip.plus_horse)
                    kbTarget.equip.plus_horse = undefined
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【麒麟弓】弃了【${getGeneralName(kbTarget)}】的+1马`)
                } else if (horseChoice === 'minus' && kbTarget.equip.minus_horse) {
                    state.discard.push(kbTarget.equip.minus_horse)
                    kbTarget.equip.minus_horse = undefined
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【麒麟弓】弃了【${getGeneralName(kbTarget)}】的-1马`)
                }
            }

            // 弃马后造伤
            dealDamage(state, targetGeneral, kbTarget, ctx.killDamage, ctx.attackCard?.id)
            state.pendingResponseQueue.shift()
            return
        }

        // ── 寒冰剑：攻击者选择弃目标的牌
        case ResponseType.EQUIP_ICE_SWORD_PICK: {
            const ctx = pending.context as { iceTargetIndex: number; remainingPicks: number }
            const iceTarget = state.generals[ctx.iceTargetIndex]
            if (!iceTarget?.alive) {
                state.pendingResponseQueue.shift()
                return
            }
            const action = (data as any).action as string

            if (action === 'hand') {
                // 随机弃一张手牌
                if (iceTarget.hand.length === 0) return { error: '目标没有手牌' }
                const randIdx = Math.floor(Math.random() * iceTarget.hand.length)
                const card = iceTarget.hand.splice(randIdx, 1)[0]
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃了【${getGeneralName(iceTarget)}】的手牌${cardFullName(card)}`)
                checkMingzhe(state, iceTarget, card)
            } else if (['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                const slot = action as keyof typeof iceTarget.equip
                const equipCard = iceTarget.equip[slot]
                if (!equipCard) return { error: '目标该装备栏为空' }
                iceTarget.equip[slot] = undefined as any
                state.discard.push(equipCard)
                triggerXiaoji(state, iceTarget)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃了【${getGeneralName(iceTarget)}】的装备【${cardDisplayName(equipCard)}】`)
                checkMingzhe(state, iceTarget, equipCard)
            } else {
                return { error: '无效选择' }
            }

            ctx.remainingPicks -= 1
            // 检查目标是否还有牌
            const totalLeft = iceTarget.hand.length + Object.values(iceTarget.equip).filter(Boolean).length
            if (ctx.remainingPicks <= 0 || totalLeft === 0) {
                state.pendingResponseQueue.shift()
                addLog(state, `寒冰剑效果结束，不造成伤害`)
            }
            return
        }

        // ── 五谷丰登选牌
        case ResponseType.HARVEST_PICK: {
            const pool = state.harvestPool ?? []
            if (pool.length === 0) {
                state.pendingResponseQueue.shift()
                return
            }
            const pickedId = data.cardId
            const pickedIdx = pickedId ? pool.findIndex(c => c.id === pickedId) : -1
            let picked: Card
            if (pickedIdx >= 0) {
                picked = pool.splice(pickedIdx, 1)[0]
            } else {
                // 没选或选无效 → 默认第一张
                picked = pool.splice(0, 1)[0]
            }
            targetGeneral.hand.push(picked)
            addLog(state, `【${getGeneralName(targetGeneral)}】从五谷丰登中选择了${cardFullName(picked)}`)

            state.pendingResponseQueue.shift()

            // 如果没有更多 HARVEST_PICK 待处理，剩余牌进弃牌堆
            const hasMore = state.pendingResponseQueue.some(p => p.type === ResponseType.HARVEST_PICK)
            if (!hasMore && pool.length > 0) {
                state.discard.push(...pool)
                addLog(state, `五谷丰登剩余 ${pool.length} 张牌进入弃牌堆`)
                state.harvestPool = undefined
            }
            return
        }

        // ── 濒死询问：出桃 / 救主 / 急救 / 跳过
        case ResponseType.PEACH_SAVE_ASK: {
            const ctx = pending.context as {
                dyingGeneralIndex: number
                attackerGeneralIndex: number
                remainingAskers: number[]
                neededHp: number
                damageCardId?: string
                damageAmount?: number
            }
            const dyingGeneral = state.generals[ctx.dyingGeneralIndex]
            const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null

            if (!dyingGeneral || dyingGeneral.hp > 0) {
                // 已被救，清除
                state.pendingResponseQueue.shift()
                return
            }

            const action = data.action

            if (action === 'peach' && data.cardId) {
                // 使用桃
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (card.name !== BasicCardName.PEACH) return { error: '此牌不是【桃】' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp)
                addLog(state, `【${getGeneralName(targetGeneral)}】使用【桃】，【${getGeneralName(dyingGeneral)}】回复至 ${dyingGeneral.hp}/${dyingGeneral.maxHp}`)
                if (dyingGeneral.hp > 0) {
                    state.pendingResponseQueue.shift()
                    // 被救活后触发受伤被动技能
                    triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                } else {
                    // 还需要更多桃
                    ctx.neededHp = 1 - dyingGeneral.hp
                }
                return
            }

            if (action === 'jiuzhu') {
                // 赵云救主：失去1血弃1牌（手牌或装备），救回濒死角色
                if (!hasSkill(targetGeneral, 'zhaoyun_jiuzhu')) return { error: '你没有【救主】技能' }
                if (targetGeneral === dyingGeneral) return { error: '不能对自己使用救主' }
                if (targetGeneral.faction !== dyingGeneral.faction) return { error: '只能救己方角色' }
                if (targetGeneral.hp <= 1) return { error: '体力不足（需>1）' }
                const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
                if (totalCards === 0) return { error: '没有牌可弃' }
                // 弃1张牌（手牌或装备）
                if (!data.cardId) return { error: '请选择一张牌弃置' }
                const removed = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                if ('error' in removed) return removed
                dyingGeneral.hp = 1
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【救主】，弃1牌，救回【${getGeneralName(dyingGeneral)}】`)
                loseHp(state, targetGeneral, 1)
                state.pendingResponseQueue.shift()
                // 被救活后触发受伤被动技能
                triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                return
            }

            if (action === 'jijiu' && data.cardId) {
                // 华佗急救：红色牌当桃（支持手牌和装备牌）
                if (!hasSkill(targetGeneral, 'huatuo_jijiu')) return { error: '你没有【急救】技能' }
                const card = findCardInHandOrEquip(targetGeneral, data.cardId)
                if (!card) return { error: '找不到此牌' }
                if (card.suit !== CardSuit.HEART && card.suit !== CardSuit.DIAMOND) return { error: '急救需要红色牌' }
                removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【急救】，【${getGeneralName(dyingGeneral)}】回复至 ${dyingGeneral.hp}/${dyingGeneral.maxHp}`)
                if (dyingGeneral.hp > 0) {
                    state.pendingResponseQueue.shift()
                    // 被救活后触发受伤被动技能
                    triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                }
                return
            }

            // 跳过 → 轮转到下一个角色
            if (ctx.remainingAskers.length > 0) {
                const nextAskerIdx = ctx.remainingAskers.shift()!
                pending.targetGeneralIndex = nextAskerIdx
                addLog(state, `请【${getGeneralName(state.generals[nextAskerIdx])}】选择是否使用【桃】救援【${getGeneralName(dyingGeneral)}】`)
            } else {
                // 全部跳过 → 死亡
                state.pendingResponseQueue.shift()
                handleDeath(state, attacker, dyingGeneral)
            }
            return
        }

        // ── 判定介入：鬼才/缓释 — 打出手牌替换判定牌 或 跳过
        case ResponseType.JUDGE_INTERVENE: {
            const ctx = pending.context as any
            const judgingGeneral = state.generals[ctx.judgingGeneralIndex]
            const isSkillJudge = !!ctx.judgeType // 技能判定 vs 延时锦囊判定
            const declinedIntervenors: number[] = ctx.declinedIntervenors ?? []

            if (data.cardId) {
                const isHuanshi = hasSkill(targetGeneral, 'zhugejin_huanshi')
                let replacementCard: Card
                if (isHuanshi) {
                    // 缓释：可以用手牌或装备牌
                    const result = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                    if ('error' in result) return result
                    replacementCard = result
                } else {
                    // 鬼才：只能用手牌
                    const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                    if (cardIdx === -1) return { error: '手牌中没有此牌' }
                    replacementCard = targetGeneral.hand.splice(cardIdx, 1)[0]
                    state.discard.push(replacementCard)
                }

                const skillName = isHuanshi ? '缓释' : '鬼才'
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【${skillName}】，将判定牌替换为${cardFullName(replacementCard)}`)

                // 原判定牌放到弃牌堆（替换牌成为新的判定牌，放入弃牌堆）
                state.discard.push(replacementCard)

                state.pendingResponseQueue.shift()

                // 修改者加入已询问列表，继续询问剩余介入者
                const newDeclined = [...declinedIntervenors, state.generals.indexOf(targetGeneral)]
                const nextIntervenor = findJudgeIntervenor(state, judgingGeneral, newDeclined)

                if (nextIntervenor) {
                    // 还有其他人可以介入 → 继续询问
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.JUDGE_INTERVENE,
                        targetGeneralIndex: state.generals.indexOf(nextIntervenor),
                        context: {
                            ...ctx,
                            judgeCardId: replacementCard.id,
                            declinedIntervenors: newDeclined,
                        },
                    })
                    const nextSkillName = hasSkill(nextIntervenor, 'simayi_guicai') ? '鬼才' : '缓释'
                    addLog(state, `【${getGeneralName(nextIntervenor)}】可发动【${nextSkillName}】修改判定`)
                    return
                }

                // 无人介入 → 结算
                if (isSkillJudge) {
                    resolveSkillJudge(state, judgingGeneral, replacementCard, ctx.judgeType as SkillJudgeType, ctx)
                    continueFromPrepPhase(state)
                } else {
                    const delayedCard = judgingGeneral.judgeZone.find((c: Card) => c.id === ctx.delayedTrickCardId)
                        ?? state.discard.find((c: Card) => c.id === ctx.delayedTrickCardId)
                    if (delayedCard && judgingGeneral) {
                        continueJudgePhase(state, judgingGeneral, replacementCard, delayedCard,
                            ctx.toJudgeCardIds, ctx.currentJudgeIndex, ctx.skipAction, ctx.skipDraw)
                    }
                }
            } else {
                // 跳过 → 查找下一个介入者
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃修改判定`)

                const newDeclined = [...declinedIntervenors, pending.targetGeneralIndex]
                const nextIntervenor = findJudgeIntervenor(state, judgingGeneral, newDeclined)

                if (nextIntervenor) {
                    // 还有人可以介入 → 修改 pending 指向下一个介入者
                    pending.targetGeneralIndex = state.generals.indexOf(nextIntervenor)
                    ctx.declinedIntervenors = newDeclined
                    const nextSkillName = hasSkill(nextIntervenor, 'simayi_guicai') ? '鬼才' : '缓释'
                    addLog(state, `【${getGeneralName(nextIntervenor)}】可发动【${nextSkillName}】修改判定`)
                    return
                }

                // 无人介入 → 用原判定牌结算
                state.pendingResponseQueue.shift()

                const origJudgeCard = state.discard.find((c: Card) => c.id === ctx.judgeCardId)
                if (!origJudgeCard || !judgingGeneral) return

                if (isSkillJudge) {
                    resolveSkillJudge(state, judgingGeneral, origJudgeCard, ctx.judgeType as SkillJudgeType, ctx)
                    continueFromPrepPhase(state)
                } else {
                    const delayedCard = judgingGeneral.judgeZone.find((c: Card) => c.id === ctx.delayedTrickCardId)
                        ?? state.discard.find((c: Card) => c.id === ctx.delayedTrickCardId)
                    if (delayedCard) {
                        continueJudgePhase(state, judgingGeneral, origJudgeCard, delayedCard,
                            ctx.toJudgeCardIds, ctx.currentJudgeIndex, ctx.skipAction, ctx.skipDraw)
                    }
                }
            }
            return
        }

        default:
            return { error: '未知响应类型' }
    }
}

function handleDodgeResponse(
    state: GameState,
    targetGeneral: GeneralInstance,
    pending: PendingResponse,
    data: C2S_Respond
): { error: string } | void {
    const ctx = pending.context as {
        attackerGeneralIndex: number
        requiredDodges: number
        dodgesReceived: number
        attackCard?: Card
    }
    const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null
    const action = (data as any).action as string | undefined

    // ── 八卦阵判定 ──
    if (action === 'eight_trigrams') {
        if (targetGeneral.equip.armor?.name !== EquipmentCardName.EIGHT_TRIGRAMS) return { error: '未装备八卦阵' }
        // 青釭剑无视防具
        if (attacker?.equip.weapon?.name === EquipmentCardName.QINGGANG_SWORD) return { error: '青釭剑无视防具，无法使用八卦阵' }
        if (state.deck.length === 0) return { error: '牌堆为空' }
        performSkillJudge(state, targetGeneral, 'eight_trigrams', '八卦阵', {})
        return
    }

    if (data.cardId) {
        const cardIdx = targetGeneral.hand.findIndex((c) => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有此牌' }
        const card = targetGeneral.hand[cardIdx]

        if (!isCardUsableAsDodge(targetGeneral, card)) return { error: '此牌不能当【闪】使用' }

        targetGeneral.hand.splice(cardIdx, 1)
        state.discard.push(card)
        checkMingzhe(state, targetGeneral, card)
        ctx.dodgesReceived = (ctx.dodgesReceived || 0) + 1
        addLog(state, `【${getGeneralName(targetGeneral)}】出了【闪】（${ctx.dodgesReceived}/${ctx.requiredDodges}）`)

        if (ctx.dodgesReceived >= ctx.requiredDodges) {
            addLog(state, `【${getGeneralName(targetGeneral)}】成功防御【杀】`)
            handleDodgeSucceeded(state, targetGeneral, ctx)
        }
    } else {
        // 放弃出闪
        addLog(state, `【${getGeneralName(targetGeneral)}】没有出【闪】`)
        handleDodgeFailed(state, targetGeneral, ctx)
    }
}

/** 杀被闪成功后的武器效果 */
function handleDodgeSucceeded(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card }
): void {
    // 先移除 DODGE pending（必须在 unshift 武器效果之前，否则 shift 会移错对象）
    state.pendingResponseQueue.shift()
    handleDodgeSucceededAfterRemoval(state, targetGeneral, ctx)
}

/** 杀被闪成功后的武器效果（DODGE pending 已被移除） */
function handleDodgeSucceededAfterRemoval(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card }
): void {
    const attacker = state.generals[ctx.attackerGeneralIndex]

    // 猛进（庞德）：可弃目标一牌（可选）
    if (attacker && hasSkill(attacker, 'pangde_mengjin')) {
        const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
        if (totalCards > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'pangde_mengjin',
                    skillName: '猛进',
                    description: `弃【${getGeneralName(targetGeneral)}】的一张牌`,
                    mengjinTargetIndex: state.generals.indexOf(targetGeneral),
                },
            })
        }
    }

    // 贯石斧：弃2张牌使杀仍然命中
    if (attacker?.equip.weapon?.name === EquipmentCardName.STONE_AXE) {
        const totalCards = attacker.hand.length +
            Object.values(attacker.equip).filter(e => e != null && e !== attacker.equip.weapon).length
        if (totalCards >= 2) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'equip_stone_axe',
                    skillName: '贯石斧',
                    description: `弃2张牌（手牌），使【杀】仍然对【${getGeneralName(targetGeneral)}】造成伤害`,
                    targetIndex: state.generals.indexOf(targetGeneral),
                    attackCard: ctx.attackCard,
                },
            })
            return
        }
    }

    // 青龙偃月刀：杀被闪时可继续出杀
    if (attacker?.equip.weapon?.name === EquipmentCardName.GREEN_DRAGON) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(attacker),
            context: {
                skillId: 'equip_green_dragon',
                skillName: '青龙偃月刀',
                description: `杀被闪抵消，是否对【${getGeneralName(targetGeneral)}】再出一张杀？（请先选择杀牌）`,
                targetIndex: state.generals.indexOf(targetGeneral),
            },
        })
    }
}

/** 杀命中（未出闪）后的处理 */
function handleDodgeFailed(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card }
): void {
    const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null

    // 寒冰剑：弃目标2牌不造伤
    if (attacker?.equip.weapon?.name === EquipmentCardName.ICE_SWORD) {
        const targetTotalCards = targetGeneral.hand.length +
            Object.values(targetGeneral.equip).filter(e => e != null).length
        if (targetTotalCards > 0) {
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'equip_ice_sword',
                    skillName: '寒冰剑',
                    description: `弃【${getGeneralName(targetGeneral)}】2张牌，不造成伤害`,
                    targetIndex: state.generals.indexOf(targetGeneral),
                    killDamage: 1,
                    attackCard: ctx.attackCard,
                },
            })
            return
        }
    }

    // 麒麟弓：弃目标坐骑
    if (attacker?.equip.weapon?.name === EquipmentCardName.KYLIN_BOW) {
        const hasPlus = !!targetGeneral.equip.plus_horse
        const hasMinus = !!targetGeneral.equip.minus_horse
        if (hasPlus || hasMinus) {
            state.pendingResponseQueue.shift()
            const killDamage = calcKillDamage(state, attacker)
            if (hasPlus && hasMinus) {
                // 两匹马，需要选择
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(attacker),
                    context: {
                        skillId: 'equip_kylin_bow',
                        skillName: '麒麟弓',
                        description: `是否弃【${getGeneralName(targetGeneral)}】一匹坐骑？`,
                        targetIndex: state.generals.indexOf(targetGeneral),
                        killDamage,
                        attackCard: ctx.attackCard,
                    },
                })
            } else {
                // 只有一匹马，询问是否发动
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(attacker),
                    context: {
                        skillId: 'equip_kylin_bow_auto',
                        skillName: '麒麟弓',
                        description: `是否弃【${getGeneralName(targetGeneral)}】的坐骑？`,
                        targetIndex: state.generals.indexOf(targetGeneral),
                        killDamage,
                        attackCard: ctx.attackCard,
                        horseType: hasPlus ? 'plus' : 'minus',
                    },
                })
            }
            return
        }
    }

    // 计算伤害（含忠义加成）
    const killDamage = calcKillDamage(state, attacker)
    // 先移除 DODGE 响应，再造成伤害（dealDamage 可能 unshift 被动技能到队列头部）
    state.pendingResponseQueue.shift()
    dealDamage(state, attacker, targetGeneral, killDamage, ctx.attackCard?.id)
}

/** 计算杀伤害（含忠义加成） */
function calcKillDamage(state: GameState, attacker: GeneralInstance | null): number {
    let dmg = 1
    if (attacker) {
        const allySameTeam = state.generals.filter(g => g.alive && g.faction === attacker.faction)
        if (allySameTeam.some(g => g.loyaltyCard)) {
            dmg += 1
            addLog(state, `【忠义】加成！杀伤害+1`)
        }
    }
    return dmg
}

function handleDuelResponse(
    state: GameState,
    targetGeneral: GeneralInstance,
    pending: PendingResponse,
    data: C2S_Respond
): { error: string } | void {
    const ctx = pending.context as {
        initiatorGeneralIndex: number
        requiredAttacks: number
        attacksReceived: number
        duelCardId?: string
        duelTargetIndex?: number
    }
    const initiator = state.generals[ctx.initiatorGeneralIndex]
    const targetIdx = pending.targetGeneralIndex
    // 决斗双方：发起者 vs 目标。当前轮到谁出杀，对方就是另一个
    const duelTargetIdx = ctx.duelTargetIndex ?? targetIdx // 决斗被指定的那个人
    const opponentIdx = targetIdx === ctx.initiatorGeneralIndex
        ? duelTargetIdx
        : ctx.initiatorGeneralIndex

    if (data.cardId) {
        const cardIdx = targetGeneral.hand.findIndex((c) => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有这张牌' }
        const card = targetGeneral.hand[cardIdx]
        if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '决斗中需要出【杀】' }

        targetGeneral.hand.splice(cardIdx, 1)
        state.discard.push(card)
        ctx.attacksReceived = (ctx.attacksReceived || 0) + 1
        addLog(state, `【${getGeneralName(targetGeneral)}】在决斗中出了【杀】（${ctx.attacksReceived}/${ctx.requiredAttacks}）`)

        if (ctx.attacksReceived >= ctx.requiredAttacks) {
            // 完成本轮出杀，切换到对方
            // 计算对方需要出几张杀（吕布无双：若刚出完杀的人有无双，对方需出2杀）
            const opponent = state.generals[opponentIdx]
            const nextRequired = hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1

            // 先移除当前，再推入新的
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.ATTACK_DUEL,
                targetGeneralIndex: opponentIdx,
                context: {
                    initiatorGeneralIndex: ctx.initiatorGeneralIndex,
                    duelTargetIndex: duelTargetIdx,
                    requiredAttacks: nextRequired,
                    attacksReceived: 0,
                    duelCardId: ctx.duelCardId,
                },
            })
        }
    } else {
        // 放弃出杀 → 受到伤害，来源是对方
        const opponent = state.generals[opponentIdx]
        addLog(state, `【${getGeneralName(targetGeneral)}】决斗中放弃，受到伤害`)
        state.pendingResponseQueue.shift()
        dealDamage(state, opponent || null, targetGeneral, 1, ctx.duelCardId)
    }
}

// ─────────────────────────────────────────────────────────────
// 方向选择工具
// ─────────────────────────────────────────────────────────────

/** 找出距离某角色最近的所有其他存活角色的 index 列表（用于乱武） */
function findNearestTargets(state: GameState, general: GeneralInstance): number[] {
    const others = state.generals.filter(g => g.alive && g !== general)
    if (others.length === 0) return []
    let minDist = Infinity
    for (const o of others) {
        const d = getAttackRange(general, o, state.generals).distance
        if (d < minDist) minDist = d
    }
    return others
        .filter(o => getAttackRange(general, o, state.generals).distance === minDist)
        .map(o => state.generals.indexOf(o))
}

/** 根据方向获取除发动者外的角色列表 */
function getDirectionalTargets(
    state: GameState,
    caster: GeneralInstance,
    direction: string
): GeneralInstance[] {
    const alive = state.generals.filter(g => g.alive)
    const casterIdx = alive.indexOf(caster)
    if (casterIdx === -1) return alive.filter(g => g !== caster)

    const result: GeneralInstance[] = []
    const n = alive.length

    if (direction === 'counterclockwise') {
        for (let i = 1; i < n; i++) {
            result.push(alive[(casterIdx - i + n) % n])
        }
    } else {
        // 默认顺时针
        for (let i = 1; i < n; i++) {
            result.push(alive[(casterIdx + i) % n])
        }
    }

    return result
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function hasSkill(general: GeneralInstance, skillId: string): boolean {
    const def = getGeneralById(general.generalId)
    return def?.skills.some((s) => s.id === skillId) ?? false
}

function isCardUsableAsDodge(general: GeneralInstance, card: Card): boolean {
    if (card.name === BasicCardName.DODGE) return true
    if (hasSkill(general, 'zhaoyun_longdan') && card.name === BasicCardName.ATTACK) return true
    if (hasSkill(general, 'zhenji_qingguo') && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)) return true
    return false
}

function isCardUsableAsAttack(general: GeneralInstance, card: Card): boolean {
    if (card.name === BasicCardName.ATTACK) return true
    if (hasSkill(general, 'zhaoyun_longdan') && card.name === BasicCardName.DODGE) return true
    if (hasSkill(general, 'guanyu_wusheng') && (card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND)) return true
    return false
}

/** 从目标移除一张牌（手牌优先，然后装备） */
function removeOneCardFrom(target: GeneralInstance, state: GameState): boolean {
    if (target.hand.length > 0) {
        state.discard.push(target.hand.splice(0, 1)[0])
        return true
    }
    for (const slot of Object.values(EquipSlot)) {
        if (target.equip[slot]) {
            state.discard.push(target.equip[slot]!)
            target.equip[slot] = undefined
            triggerXiaoji(state, target)
            return true
        }
    }
    return false
}

function getGeneralName(general: GeneralInstance): string {
    const def = getGeneralById(general.generalId)
    return def?.name ?? general.generalId
}

const CARD_DISPLAY: Record<string, string> = {
    attack: '杀', dodge: '闪', peach: '桃',
    draw_two: '无中生有', dismantle: '过河拆桥', steal: '顺手牵羊',
    duel: '决斗', barbarians: '南蛮入侵', arrows: '万箭齐发',
    peach_garden: '桃园结义', harvest: '五谷丰登', negate: '无懈可击',
    borrow_sword: '借刀杀人', overindulgence: '乐不思蜀',
    supply_shortage: '兵粮寸断', crossbow: '诸葛连弩',
    green_dragon: '青龙偃月刀', zhangba_spear: '丈八蛇矛',
    fangtian_halberd: '方天画戟', kylin_bow: '麒麟弓',
    double_swords: '雌雄双股剑', qinggang_sword: '青釭剑',
    ice_sword: '寒冰剑', stone_axe: '贯石斧',
    eight_trigrams: '八卦阵', nioh_shield: '仁王盾',
    plus_horse: '+1马', minus_horse: '-1马',
}

export function cardDisplayName(card: Card): string {
    return CARD_DISPLAY[card.name] ?? card.name
}

function suitSymbol(suit: CardSuit): string {
    return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] ?? suit
}

function valueName(value: number): string {
    return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[value] ?? String(value)
}

/** 完整牌名，如 "♠A【杀】" */
export function cardFullName(card: Card): string {
    return `${suitSymbol(card.suit)}${valueName(card.value)}【${cardDisplayName(card)}】`
}
