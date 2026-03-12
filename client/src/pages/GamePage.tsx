import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import {
    Faction,
    TurnPhase,
    ActionUnitType,
    SeatRole,
    GeneralClientView,
    Card,
    CardSuit,
    BasicCardName,
    TrickCardName,
    ResponseType,
} from 'sgs3v3-shared'
import { emit } from '../socket/client'
import { GENERAL_IMAGE } from '../data/generalImages'
import { useTooltip, generalTooltipById, cardTooltipContent, TooltipBubble } from '../components/Tooltip'
import './GamePage.css'

const GENERAL_NAMES: Record<string, string> = {
    // 蜀
    liubei: '刘备', guanyu: '关羽', zhangfei: '张飞',
    zhugeliang: '诸葛亮', zhaoyun: '赵云', huangyueying: '黄月英',
    machao: '马超', jiangwei: '姜维',
    // 魏
    caocao: '曹操', simayi: '司马懿', xiahoudun: '夏侯惇',
    zhangliao: '张辽', guojia: '郭嘉', zhenji: '甄姬',
    xiahoyuan: '夏侯渊', xuhuang: '徐晃', wenpin: '文聘',
    // 吴
    sunquan: '孙权', ganning: '甘宁', huanggai: '黄盖',
    zhouyu: '周瑜', daqiao: '大乔', sunshangxiang: '孙尚香',
    sunjian: '孙坚', xiaoqiao: '小乔', sunce: '孙策', zhugejin: '诸葛瑾',
    // 群
    huatuo: '华佗', lvbu: '吕布', diaochan: '貂蝉', pangde: '庞德', jiaxu: '贾诩',
}

const CARD_NAMES: Record<string, string> = {
    attack: '杀', dodge: '闪', peach: '桃',
    draw_two: '无中生有', dismantle: '过河拆桥', steal: '顺手牵羊',
    duel: '决斗', barbarians: '南蛮入侵', arrows: '万箭齐发',
    peach_garden: '桃园结义', harvest: '五谷丰登', negate: '无懈可击',
    borrow_sword: '借刀杀人', overindulgence: '乐不思蜀',
    supply_shortage: '兵粮寸断',
    crossbow: '诸葛连弩', green_dragon: '青龙偃月刀', zhangba_spear: '丈八蛇矛',
    fangtian_halberd: '方天画戟', kylin_bow: '麒麟弓', double_swords: '雌雄双股剑',
    qinggang_sword: '青釭剑', ice_sword: '寒冰剑', stone_axe: '贯石斧',
    eight_trigrams: '八卦阵', nioh_shield: '仁王盾',
    plus_horse: '+1马', minus_horse: '-1马',
}

function getSuitSymbol(suit: string) {
    return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] ?? ''
}

function isRedSuit(suit: string) {
    return suit === CardSuit.HEART || suit === CardSuit.DIAMOND
}

function getValueStr(v: number) {
    return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[v] ?? String(v)
}

interface SkillDef { id: string; name: string; desc: string }

/** 各武将在出牌阶段可主动发动的技能 */
function ACTIVE_SKILLS_FOR(generalId: string): SkillDef[] {
    const map: Record<string, SkillDef[]> = {
        sunquan: [{ id: 'sunquan_zhiheng', name: '制衡', desc: '限一次：弃任意张手牌，摸等量牌' }],
        huanggai: [{ id: 'huanggai_kurou', name: '苦肉', desc: '失去1体力，摸2张牌' }],
        sunshangxiang: [{ id: 'sunshangxiang_jieyin', name: '结姻', desc: '限一次：弃2牌，与已受伤男性各回1血' }],
        huatuo: [{ id: 'huatuo_qingnang', name: '青囊', desc: '限一次：弃1牌，目标回1血' }],
        jiangwei: [{ id: 'jiangwei_tiaoxin', name: '挑衅', desc: '限一次：对方角色出杀否则弃其一牌' }],
        diaochan: [{ id: 'diaochan_lijian', name: '离间', desc: '限一次：弃1牌，令两名男性决斗' }],
        zhouyu: [{ id: 'zhouyu_fanjian', name: '反间', desc: '限一次：目标选花色→获你一牌→不同受1伤' }],
        liubei: [{ id: 'liubei_rende', name: '仁德', desc: '将手牌给其他角色，每给2张回1血' }],
        guanyu: [
            { id: 'guanyu_wusheng', name: '武圣', desc: '红色手牌当杀使用（切换模式）' },
            { id: 'guanyu_zhongyi', name: '忠义', desc: '限定：置红牌，己方杀+1伤' },
        ],
        jiaxu: [{ id: 'jiaxu_luanwu', name: '乱武', desc: '限定：所有其他角色出杀或失1血' }],
        ganning: [{ id: 'ganning_qixi', name: '奇袭', desc: '黑色牌当过河拆桥' }],
        xuhuang: [{ id: 'xuhuang_duanliang', name: '断粮', desc: '黑色基本/装备牌当兵粮寸断' }],
        daqiao: [{ id: 'daqiao_guose', name: '国色', desc: '♦牌当乐不思蜀' }],
    }
    return map[generalId] ?? []
}

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
    const ratio = hp / maxHp
    const level = ratio > 0.75 ? 'full' : ratio > 0.5 ? 'high' : ratio > 0.25 ? 'medium' : 'low'
    return (
        <div className="hp-bar">
            <div className="hp-bar-fill" style={{ width: `${ratio * 100}%` }} data-level={level} />
        </div>
    )
}

function GeneralPanel({
    general, index, isActive, isTarget, onSelect, isViewing,
    onTooltipEnter, onTooltipMove, onTooltipLeave,
}: {
    general: GeneralClientView
    index: number
    isActive: boolean
    isTarget: boolean
    onSelect?: (i: number) => void
    isViewing?: boolean
    onTooltipEnter?: (e: React.MouseEvent) => void
    onTooltipMove?: (e: React.MouseEvent) => void
    onTooltipLeave?: () => void
}) {
    const factionCls = general.faction === Faction.WARM ? 'warm' : 'cool'
    const imgSrc = GENERAL_IMAGE[general.generalId]
    const name = GENERAL_NAMES[general.generalId] ?? general.generalId
    return (
        <div
            className={`general-panel faction-${factionCls} ${isActive ? 'active' : ''} ${isTarget ? 'target' : ''} ${!general.alive ? 'dead' : ''} ${isViewing ? 'viewing' : ''}`}
            onClick={() => onSelect?.(index)}
            onMouseEnter={onTooltipEnter}
            onMouseMove={onTooltipMove}
            onMouseLeave={onTooltipLeave}
        >
            <div className="general-card-img">
                {imgSrc
                    ? <img src={imgSrc} alt={name} className="general-portrait" />
                    : <span className="general-portrait-placeholder">{name[0]}</span>
                }
                {general.seatRole === SeatRole.COMMANDER && <span className="commander-badge">帅</span>}
            </div>
            <div className="general-info">
                <div className="general-name">
                    <span>{name}</span>
                    <span className="general-hp-text">{general.hp}/{general.maxHp}</span>
                </div>
                <HpBar hp={general.hp} maxHp={general.maxHp} />
                <div className="general-hand-count">手牌: {general.handCount}</div>
                {/* 装备区 */}
                {(general.equip.weapon || general.equip.armor || general.equip.plus_horse || general.equip.minus_horse) && (
                    <div className="general-equip-zone">
                        {general.equip.weapon && <div className="equip-item equip-weapon" title={CARD_NAMES[general.equip.weapon.name] ?? general.equip.weapon.name}>⚔{CARD_NAMES[general.equip.weapon.name] ?? '武器'}</div>}
                        {general.equip.armor && <div className="equip-item equip-armor" title={CARD_NAMES[general.equip.armor.name] ?? general.equip.armor.name}>🛡{CARD_NAMES[general.equip.armor.name] ?? '防具'}</div>}
                        {general.equip.minus_horse && <div className="equip-item equip-horse" title={CARD_NAMES[general.equip.minus_horse.name] ?? '-1马'}>🐎-1</div>}
                        {general.equip.plus_horse && <div className="equip-item equip-horse" title={CARD_NAMES[general.equip.plus_horse.name] ?? '+1马'}>🐎+1</div>}
                    </div>
                )}
                {/* 判定区 */}
                {general.judgeZone && general.judgeZone.length > 0 && (
                    <div className="general-judge-zone">
                        {general.judgeZone.map((card) => (
                            <div key={card.id} className={`judge-item ${card.name === 'overindulgence' ? 'judge-le' : 'judge-bing'}`}>
                                {card.name === 'overindulgence' ? '乐' : '兵'}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {!general.alive && <div className="general-dead-overlay">阵亡</div>}
            {general.alive && general.hasActed && <div className="general-acted-badge">已行动</div>}
        </div>
    )
}

function PlayingCard({ card, selected, onClick, dimmed, onTooltipEnter, onTooltipMove, onTooltipLeave }: {
    card: Card; selected: boolean; onClick?: () => void; dimmed?: boolean;
    onTooltipEnter?: (e: React.MouseEvent) => void;
    onTooltipMove?: (e: React.MouseEvent) => void;
    onTooltipLeave?: () => void;
}) {
    const red = isRedSuit(card.suit)
    return (
        <div className={`playing-card ${selected ? 'selected' : ''} ${red ? 'red' : 'black'} ${dimmed ? 'dimmed' : ''}`}
            onClick={onClick}
            onMouseEnter={onTooltipEnter}
            onMouseMove={onTooltipMove}
            onMouseLeave={onTooltipLeave}
        >
            <div className="card-corner top">
                <div className={`card-suit ${red ? 'suit-red' : ''}`}>{getSuitSymbol(card.suit)}</div>
                <div className="card-value">{getValueStr(card.value)}</div>
            </div>
            <div className="card-name">{CARD_NAMES[card.name] ?? card.name}</div>
        </div>
    )
}

/** 日志文本高亮：【技能名】→紫色，伤害→红色 */
function highlightLogText(text: string) {
    // 匹配【xxx】
    const parts = text.split(/(【[^】]+】)/g)
    return parts.map((part, i) => {
        if (part.startsWith('【') && part.endsWith('】')) {
            // 伤害相关
            if (part.includes('伤害') || part.includes('濒死') || part.includes('阵亡')) {
                return <span key={i} className="log-damage">{part}</span>
            }
            return <span key={i} className="log-skill">{part}</span>
        }
        // 高亮伤害数字
        if (part.includes('伤害')) {
            return <span key={i} className="log-damage">{part}</span>
        }
        return part
    })
}

export default function GamePage() {
    const {
        gameState, myFaction,
        selectedCardIds, selectedTargets,
        toggleCardSelection, toggleTargetSelection, clearSelection,
    } = useGameStore()
    const navigate = useNavigate()
    const [guanxingTop, setGuanxingTop] = useState<string[]>([])
    const [guanxingBottom, setGuanxingBottom] = useState<string[]>([])
    // 技能激活状态：点击技能按钮后进入激活模式，选牌/选目标后点确认发送
    const [activeSkillId, setActiveSkillId] = useState<string | null>(null)
    // 英魂弃牌：用于选择装备区的装备一起弃
    const [selectedEquipSlots, setSelectedEquipSlots] = useState<string[]>([])
    // 气泡提示
    const { tooltip, onEnter: tooltipEnter, onMove: tooltipMove, onLeave: tooltipLeave } = useTooltip(1500)

    // ── 背景音乐 ──
    const bgmRef = useRef<HTMLAudioElement | null>(null)
    useEffect(() => {
        const audio = new Audio('/bgm.flac')
        audio.loop = true
        audio.volume = 0.3
        bgmRef.current = audio

        // 尝试自动播放
        const playPromise = audio.play()
        if (playPromise) {
            playPromise.catch(() => {
                // 浏览器阻止自动播放，等待用户首次点击后播放
                const resumeOnClick = () => {
                    audio.play().catch(() => {})
                    document.removeEventListener('click', resumeOnClick)
                }
                document.addEventListener('click', resumeOnClick)
            })
        }

        return () => {
            audio.pause()
            audio.src = ''
            bgmRef.current = null
        }
    }, [])

    if (!gameState) return null

    const { generals, turnPhase, activePlayerFaction, activeGeneralIndex, currentActionUnit, pendingResponse, log, roundState } = gameState

    // 暖色方在 generals 数组中是 暖B→暖主→暖A，需要反转为 暖A→暖主→暖B 以形成环形座次
    const myRaw = generals.filter((g) => g.faction === myFaction)
    const oppRaw = generals.filter((g) => g.faction !== myFaction)
    const myGenerals = myFaction === Faction.WARM ? [...myRaw].reverse() : myRaw
    const oppGenerals = myFaction === Faction.WARM ? oppRaw : [...oppRaw].reverse()

    const isMyTurn = activePlayerFaction === myFaction
    const activeGeneral = generals[activeGeneralIndex]
    const isActionPhase = turnPhase === TurnPhase.ACTION
    const isDiscardPhase = turnPhase === TurnPhase.DISCARD
    const myPendingResponse =
        pendingResponse &&
        generals[pendingResponse.targetGeneralIndex]?.faction === myFaction

    const canInteractWithHand = (isActionPhase || isDiscardPhase || myPendingResponse) &&
        (activeGeneral?.faction === myFaction || !!myPendingResponse)

    // 是否需要选择行动单元：step=0（先手选）或 step=2（后手选）或 step=4/5（剩余边锋选顺序），且轮到我方
    // 让先选择期间不显示
    const needChooseUnit = roundState &&
        !roundState.waitingForYield &&
        (roundState.currentActionStep === 0 || roundState.currentActionStep === 2 ||
            roundState.currentActionStep === 4 || roundState.currentActionStep === 5) &&
        isMyTurn && activeGeneralIndex === -1

    // 查看哪个武将的手牌（点击己方武将切换）
    // 优先级：手动选择 > 需要响应的武将 > 当前行动武将
    const [viewingGeneralIdx, setViewingGeneralIdx] = useState<number | null>(null)
    // 当 activeGeneralIndex 变化时，重置手动选择的查看目标
    const prevActiveIdx = useRef(activeGeneralIndex)
    useEffect(() => {
        if (prevActiveIdx.current !== activeGeneralIndex) {
            setViewingGeneralIdx(null)
            prevActiveIdx.current = activeGeneralIndex
        }
    }, [activeGeneralIndex])
    const respondingIdx = myPendingResponse ? pendingResponse!.targetGeneralIndex : null
    const displayGeneralIdx = viewingGeneralIdx ?? respondingIdx ?? activeGeneralIndex
    const displayGeneral = displayGeneralIdx >= 0 ? generals[displayGeneralIdx] : null
    const isViewingActive = displayGeneralIdx === activeGeneralIndex
    const isViewingResponding = respondingIdx !== null && displayGeneralIdx === respondingIdx
    const isViewingMyGeneral = displayGeneral?.faction === myFaction
    // 可交互：正在查看活动武将或响应武将
    const canSelectCards = (isViewingActive || isViewingResponding) && canInteractWithHand

    function handleChooseUnit(unit: ActionUnitType) {
        emit.chooseActionUnit({ unit })
    }

    // ── AOE 方向选择 ──
    const [aoeDirection, setAoeDirection] = useState<'clockwise' | 'counterclockwise'>('clockwise')

    // 检查当前选中的牌是否为AOE
    const selectedCard = displayGeneral?.hand?.find(c => c.id === selectedCardIds[0])
    const isAoeCard = selectedCard && ['barbarians', 'arrows', 'peach_garden', 'harvest'].includes(selectedCard.name)

    // 计算AOE方向标签：使用相邻武将名称
    const aoeDirectionLabels = (() => {
        if (!isAoeCard || activeGeneralIndex < 0) return null
        const alive = generals.filter(g => g.alive)
        const caster = generals[activeGeneralIndex]
        if (!caster) return null
        const casterAliveIdx = alive.indexOf(caster)
        if (casterAliveIdx === -1 || alive.length <= 1) return null
        const n = alive.length
        const cwFirst = alive[(casterAliveIdx + 1) % n]
        const ccwFirst = alive[(casterAliveIdx - 1 + n) % n]
        return {
            clockwise: GENERAL_NAMES[cwFirst.generalId] ?? cwFirst.generalId,
            counterclockwise: GENERAL_NAMES[ccwFirst.generalId] ?? ccwFirst.generalId,
        }
    })()

    function handleUseCard() {
        if (selectedCardIds.length === 0) return
        let extra: any = isAoeCard ? { direction: aoeDirection } : undefined
        // 武圣模式：通知服务端红色牌当杀
        if (activeSkillId === 'guanyu_wusheng') {
            extra = { ...extra, wusheng: true }
        }
        emit.useCard({ cardId: selectedCardIds[0], targetIndices: selectedTargets, extra })
        clearSelection()
        setActiveSkillId(null)
    }

    function handleConfirmSkill() {
        if (!activeSkillId) return
        emit.useSkill({
            skillId: activeSkillId,
            targetIndices: selectedTargets,
            cardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
        })
        clearSelection()
        setActiveSkillId(null)
    }

    function handleCancelSkill() {
        setActiveSkillId(null)
        clearSelection()
    }

    function handleEndTurn() {
        emit.endTurn()
    }

    function handleDiscard() {
        if (selectedCardIds.length === 0) return
        emit.discard({ cardIds: selectedCardIds })
        clearSelection()
    }

    function handleRespond(cardId?: string, extra?: Record<string, unknown>) {
        emit.respond({ cardId, ...extra })
        clearSelection()
    }

    const turnPhaseName: Record<string, string> = {
        [TurnPhase.TURN_START]: '回合开始',
        [TurnPhase.JUDGE]: '判定阶段',
        [TurnPhase.DRAW]: '摸牌阶段',
        [TurnPhase.ACTION]: '出牌阶段',
        [TurnPhase.DISCARD]: '弃牌阶段',
        [TurnPhase.TURN_END]: '回合结束',
    }

    return (
        <>
        <div className="game-page">
          <div className="game-main">
            {/* 对手武将区 */}
            <div className="generals-row opp-row">
                {oppGenerals.map((g) => {
                    const idx = generals.indexOf(g)
                    const isYiji = myPendingResponse && pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE
                    const isSingleSelectSkill = isYiji || activeSkillId === 'liubei_rende'
                    return (
                        <GeneralPanel
                            key={g.generalId} general={g} index={idx}
                            isActive={idx === activeGeneralIndex}
                            isTarget={selectedTargets.includes(idx)}
                            onSelect={isSingleSelectSkill
                                ? (i) => useGameStore.setState({ selectedTargets: [i] })
                                : toggleTargetSelection
                            }
                            onTooltipEnter={(e) => { const c = generalTooltipById(g.generalId); if (c) tooltipEnter(e, c) }}
                            onTooltipMove={tooltipMove}
                            onTooltipLeave={tooltipLeave}
                        />
                    )
                })}
            </div>

            {/* 中央区域 */}
            <div className="game-center">
                <div className="deck-area">
                    <div className="deck-pile">牌堆 {gameState.deckCount}</div>
                    {gameState.discardTop && (
                        <div className="discard-top">弃牌: {CARD_NAMES[gameState.discardTop.name] ?? gameState.discardTop.name}</div>
                    )}
                </div>

                {/* 让先选择（仅冷色方、仅第1大回合前） */}
                {roundState?.waitingForYield && myFaction === Faction.COOL && (
                    <div className="action-unit-choice">
                        <div className="action-choice-label" style={{ color: '#ffd700' }}>
                            请选择：先手 或 让先
                        </div>
                        <button className="btn btn-secondary" onClick={() => emit.yieldChoice({ yield: false })}>
                            先手（我方先行动）
                        </button>
                        <button className="btn btn-primary" onClick={() => emit.yieldChoice({ yield: true })}>
                            让先（对方先行动）
                        </button>
                    </div>
                )}
                {roundState?.waitingForYield && myFaction === Faction.WARM && (
                    <div className="action-unit-choice">
                        <div className="action-choice-label">等待冷色方选择先手/让先...</div>
                    </div>
                )}

                {needChooseUnit && (() => {
                    const myFlanks = generals
                        .map((g, i) => ({ g, i }))
                        .filter(({ g }) => g.faction === myFaction && g.seatRole !== SeatRole.COMMANDER && g.alive)
                    const step = roundState?.currentActionStep ?? 0
                    const isFlankOrderOnly = step === 4 || step === 5
                    // 第1大回合先手方只能选主帅
                    const isFirstMover = roundState?.firstMover === myFaction
                    const isRound1 = roundState?.roundNumber === 1
                    const canChooseFlanks = !(isRound1 && isFirstMover) || isFlankOrderOnly
                    return (
                        <div className="action-unit-choice">
                            <div className="action-choice-label">
                                第 {roundState?.roundNumber} 大回合 · {isFlankOrderOnly ? '选择边锋行动顺序' : '选择行动单元'}
                                {isRound1 && isFirstMover && !isFlankOrderOnly && <span style={{ color: '#ff6b6b', fontSize: '12px', marginLeft: '8px' }}>（先手方第1回合只能选主帅）</span>}
                            </div>
                            {!isFlankOrderOnly && (
                                <button className="btn btn-primary" onClick={() => emit.chooseActionUnit({ unit: ActionUnitType.COMMANDER })}>主帅先动</button>
                            )}
                            {canChooseFlanks && (
                                myFlanks.length <= 1 ? (
                                    !isFlankOrderOnly && <button className="btn btn-secondary" onClick={() => emit.chooseActionUnit({ unit: ActionUnitType.FLANKS })}>边锋先动</button>
                                ) : (
                                    <>
                                        {!isFlankOrderOnly && <div className="action-choice-sub">边锋先动（选先手）：</div>}
                                        {myFlanks.map(({ g, i }) => (
                                            <button key={i} className="btn btn-secondary"
                                                onClick={() => {
                                                    const other = myFlanks.find(f => f.i !== i)!
                                                    emit.chooseActionUnit({ unit: ActionUnitType.FLANKS, flankOrder: [i, other.i] })
                                                }}>
                                                {GENERAL_NAMES[g.generalId] ?? g.generalId} 先动
                                            </button>
                                        ))}
                                    </>
                                )
                            )}
                        </div>
                    )
                })()}

                {currentActionUnit && (
                    <div className="turn-status">
                        <span className={activePlayerFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {activePlayerFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        {' · '}
                        {currentActionUnit === ActionUnitType.COMMANDER ? '主帅' : '前锋'}
                        {' · '}
                        {turnPhaseName[turnPhase] ?? turnPhase}
                    </div>
                )}

                {/* ── 无懈可击面板 ── */}
                {gameState.negateWindow && (() => {
                    const nw = gameState.negateWindow!
                    const trickName = CARD_NAMES[nw.trickCardName] ?? nw.trickCardName
                    // 找出己方有无懈可击的武将
                    const myNegateGenerals = generals
                        .map((g, idx) => ({ g, idx }))
                        .filter(({ g }) =>
                            g.faction === myFaction &&
                            g.alive &&
                            g.hand?.some(c => c.name === TrickCardName.NEGATE)
                        )

                    return (
                        <div className="negate-window-panel">
                            <div className="negate-header">
                                {nw.isCurrentlyNegated
                                    ? `🛡 【${trickName}】→ ${nw.trickTargetName}（已被无懈）`
                                    : `⚡ 【${trickName}】→ ${nw.trickTargetName}`
                                }
                            </div>
                            <div className="negate-sub">
                                {nw.isCurrentlyNegated ? '是否反制无懈？' : '是否使用无懈可击？'}
                            </div>
                            {!nw.anyoneHasNegate && (
                                <div className="negate-countdown">无人持有无懈可击，3秒后自动结算...</div>
                            )}
                            {myNegateGenerals.length > 0 && (
                                <div className="negate-actions">
                                    {myNegateGenerals.map(({ g, idx }) => {
                                        const name = GENERAL_NAMES[g.generalId] ?? g.generalId
                                        const negateCards = g.hand!.filter(c => c.name === TrickCardName.NEGATE)
                                        if (negateCards.length === 1) {
                                            return (
                                                <button key={idx} className="btn btn-skill"
                                                    onClick={() => emit.negateRespond({
                                                        cardId: negateCards[0].id,
                                                        generalIndex: idx,
                                                    })}>
                                                    {name} - 使用无懈可击
                                                </button>
                                            )
                                        }
                                        // 多张无懈可击：显示每张牌
                                        return negateCards.map(card => (
                                            <button key={card.id} className="btn btn-skill"
                                                onClick={() => emit.negateRespond({
                                                    cardId: card.id,
                                                    generalIndex: idx,
                                                })}>
                                                {name} - {getSuitSymbol(card.suit)}{getValueStr(card.value)}无懈
                                            </button>
                                        ))
                                    })}
                                    <button className="btn btn-secondary"
                                        onClick={() => emit.negateRespond({ generalIndex: -1 })}>
                                        全部放弃
                                    </button>
                                </div>
                            )}
                            {myNegateGenerals.length === 0 && nw.anyoneHasNegate && (
                                <div className="negate-countdown">等待对方决定...</div>
                            )}
                        </div>
                    )
                })()}

                {pendingResponse && (() => {
                    const who = generals[pendingResponse.targetGeneralIndex]
                    const isMe = who?.faction === myFaction
                    const whoName = isMe ? '你' : (GENERAL_NAMES[who?.generalId ?? ''] ?? '对方')
                    const ctx = pendingResponse.context as any

                    const descMap: Record<string, string> = {
                        [ResponseType.PEACH_SAVE_ASK]: `⚠️ 濒死！等待${whoName}救援`,
                        [ResponseType.DODGE]: `等待${whoName}出【闪】`,
                        [ResponseType.ATTACK_DUEL]: `等待${whoName}出【杀】（决斗）`,
                        [ResponseType.JUDGE_INTERVENE]: `等待${whoName}修改判定牌`,
                        [ResponseType.SKILL_ACTIVATE_CONFIRM]: `${whoName}：是否发动【${ctx?.skillName ?? '技能'}】`,
                        [ResponseType.SKILL_FANJIAN_SUIT]: `等待${whoName}猜花色（反间）`,
                        [ResponseType.SKILL_GANGLIE_CHOICE]: `等待${whoName}选择（刚烈）`,
                        [ResponseType.SKILL_YIJI_DISTRIBUTE]: `等待${whoName}分配遗计牌`,
                        [ResponseType.SKILL_TIAOXIN_RESPONSE]: `等待${whoName}出杀（挑衅）`,
                        [ResponseType.SKILL_LUANWU_RESPONSE]: `等待${whoName}出杀或放弃（乱武）`,
                        [ResponseType.SKILL_LUANWU_PICK_TARGET]: `等待${whoName}选择杀的目标（乱武）`,
                        [ResponseType.HARVEST_PICK]: `等待${whoName}从五谷丰登中选牌`,
                        [ResponseType.AOE_DODGE]: `等待${whoName}出闪（万箭齐发）`,
                        [ResponseType.AOE_ATTACK]: `等待${whoName}出杀（南蛮入侵）`,
                        [ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE]: `${whoName}：弃1手牌或让对方摸1牌（雌雄双股剑）`,
                        [ResponseType.EQUIP_KYLIN_BOW_CHOICE]: `${whoName}：选择弃目标哪匹马（麒麟弓）`,
                        [ResponseType.EQUIP_ICE_SWORD_PICK]: `${whoName}：选择弃目标的牌（寒冰剑）`,

                        [ResponseType.TRICK_TARGET_CARD_PICK]: `${whoName}：选择${(pendingResponse.context as any)?.trickType === 'dismantle' ? '弃' : '拿'}目标的哪张牌`,
                        [ResponseType.BORROW_SWORD_RESPONSE]: `${whoName}：出杀或交出武器（借刀杀人）`,
                        [ResponseType.SKILL_TUXI_CHOOSE]: `${whoName}：选择至多2名角色获取手牌（突袭）`,
                        [ResponseType.SKILL_SHENSU_TARGET]: `${whoName}：选择神速杀的目标`,
                        [ResponseType.SKILL_SHENSU_EQUIP]: `${whoName}：选择弃哪件装备（神速二）`,
                        [ResponseType.SKILL_FANKUI_PICK]: `${whoName}：选择获取伤害来源的一张牌（反馈）`,
                        [ResponseType.SKILL_GUANXING_ARRANGE]: `${whoName}：观星 — 排列牌堆顶/底`,
                        [ResponseType.SKILL_YINGHUN_CHOOSE]: `${whoName}：英魂 — 选一名角色和模式`,
                        [ResponseType.SKILL_TIANXIANG_CHOOSE]: `${whoName}：天香 — 选择转移伤害的目标`,
                        [ResponseType.SKILL_LIULI_REDIRECT]: `${whoName}：流离 — 选择杀的转移目标`,
                        [ResponseType.SKILL_YINGHUN_DISCARD]: `${whoName}：英魂 — 弃${(pendingResponse.context as any)?.discardCount ?? 1}张牌（手牌/装备）`,
                    }
                    const desc = descMap[pendingResponse.type] ?? `等待${whoName}响应`

                    return (
                        <div className={`pending-response-banner ${pendingResponse.type === ResponseType.PEACH_SAVE_ASK ? 'dying-alert' : ''}`}>
                            {desc}
                        </div>
                    )
                })()}

            </div>

            {/* 己方武将区 */}
            <div className="generals-row my-row">
                {myGenerals.map((g) => {
                    const idx = generals.indexOf(g)
                    const isViewing = idx === displayGeneralIdx
                    // 遗计等需要选目标的响应期间，点击己方武将也选为目标
                    const needTargetPick = myPendingResponse && (
                        pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE
                    )
                    // 出牌阶段：己方武将始终可以被选为目标（杀、顺手牵羊、决斗等均可对己方使用）
                    const needMyTarget = isActionPhase && isMyTurn
                    return (
                        <GeneralPanel
                            key={g.generalId} general={g} index={idx}
                            isActive={idx === activeGeneralIndex}
                            isTarget={selectedTargets.includes(idx)}
                            onSelect={(needTargetPick)
                                ? (i) => {
                                    // 遗计：不能选自己（有"保留"按钮），且单选模式
                                    if (i === pendingResponse!.targetGeneralIndex) return
                                    useGameStore.setState({ selectedTargets: [i] })
                                }
                                : (i) => {
                                    if (needMyTarget) {
                                        // 已选牌或激活技能时，点击己方武将 = 选为目标
                                        if (selectedCardIds.length > 0 || activeSkillId) {
                                            // 仁德等单选技能：替换而非追加
                                            if (activeSkillId === 'liubei_rende') {
                                                useGameStore.setState({ selectedTargets: [i] })
                                            } else {
                                                toggleTargetSelection(i)
                                            }
                                        } else {
                                            // 未选牌时，点击己方武将 = 切换查看手牌
                                            setViewingGeneralIdx(i === activeGeneralIndex ? null : i)
                                        }
                                    } else {
                                        setViewingGeneralIdx(i === viewingGeneralIdx ? null : i)
                                    }
                                }}
                            isViewing={isViewing}
                            onTooltipEnter={(e) => { const c = generalTooltipById(g.generalId); if (c) tooltipEnter(e, c) }}
                            onTooltipMove={tooltipMove}
                            onTooltipLeave={tooltipLeave}
                        />
                    )
                })}

            </div>

            {/* 手牌 + 操作 */}
            <div className="hand-area">
                <div className="hand-cards">
                    {displayGeneral && isViewingMyGeneral ? (
                        <>
                            {!isViewingActive && !isViewingResponding && (
                                <div className="hand-viewing-label">
                                    {GENERAL_NAMES[displayGeneral.generalId] ?? displayGeneral.generalId} 的手牌（只读）
                                </div>
                            )}
                            {(displayGeneral.hand ?? []).map((card) => (
                                <PlayingCard
                                    key={card.id} card={card}
                                    selected={selectedCardIds.includes(card.id)}
                                    onClick={() => canSelectCards && toggleCardSelection(card.id)}
                                    dimmed={!canSelectCards}
                                    onTooltipEnter={(e) => { const c = cardTooltipContent(card.name); if (c) tooltipEnter(e, c) }}
                                    onTooltipMove={tooltipMove}
                                    onTooltipLeave={tooltipLeave}
                                />
                            ))}
                            {/* 技能激活或特定响应时显示可选装备牌 */}
                            {(() => {
                                // 定义哪些主动技能可以用装备牌
                                const equipSkillFilter: Record<string, (card: Card) => boolean> = {
                                    'ganning_qixi': (c) => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB,
                                    'diaochan_lijian': () => true,
                                    'xuhuang_duanliang': (c) => (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB),
                                    'daqiao_guose': (c) => c.suit === CardSuit.DIAMOND,
                                    'sunquan_zhiheng': () => true,
                                    'equip_zhangba_spear': () => true,
                                }
                                let filter: ((card: Card) => boolean) | null = null
                                if (activeSkillId) {
                                    filter = equipSkillFilter[activeSkillId] ?? null
                                } else if (myPendingResponse && isViewingResponding && pendingResponse) {
                                    // 响应阶段：急救(红色牌)、缓释/鬼才(任意牌)、贯石斧(任意牌)
                                    if (pendingResponse.type === ResponseType.PEACH_SAVE_ASK) {
                                        // 急救(红色牌) + 救主(任意牌)
                                        const responder = gameState.generals[pendingResponse.targetGeneralIndex]
                                        const hasJiuzhu = responder?.generalId === 'zhaoyun'
                                        const hasJijiu = responder?.generalId === 'huatuo'
                                        if (hasJiuzhu) {
                                            filter = () => true // 救主可以弃任意牌
                                        } else if (hasJijiu) {
                                            filter = (c) => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
                                        }
                                    } else if (pendingResponse.type === ResponseType.JUDGE_INTERVENE) {
                                        // 只有缓释（诸葛瑾）可以用装备牌，鬼才（司马懿）不行
                                        const responder = gameState.generals[pendingResponse.targetGeneralIndex]
                                        if (responder?.generalId === 'zhugejin') filter = () => true
                                    } else if (pendingResponse.type === ResponseType.SKILL_ACTIVATE_CONFIRM
                                        && (pendingResponse.context as any)?.skillId === 'equip_stone_axe') {
                                        filter = () => true
                                    }
                                }
                                if (!filter || !displayGeneral) return null
                                const f = filter
                                const equipCards: Card[] = []
                                for (const slot of ['weapon', 'armor', 'plus_horse', 'minus_horse'] as const) {
                                    const card = displayGeneral.equip[slot]
                                    if (card && f(card)) equipCards.push(card)
                                }
                                if (equipCards.length === 0) return null
                                return (
                                    <div className="equip-select-row">
                                        <span className="equip-select-label">装备区：</span>
                                        {equipCards.map(card => (
                                            <PlayingCard
                                                key={card.id} card={card}
                                                selected={selectedCardIds.includes(card.id)}
                                                onClick={() => toggleCardSelection(card.id)}
                                            />
                                        ))}
                                    </div>
                                )
                            })()}
                        </>
                    ) : null}
                </div>

                <div className="action-btns">
                    {isActionPhase && isMyTurn && isViewingActive && !gameState.pendingResponse && !gameState.negateWindow && (() => {
                        // toggle模式技能：激活后仍用"出牌"按钮，不显示"确认发动"
                        const TOGGLE_SKILLS = ['guanyu_wusheng']
                        const isToggleSkillActive = activeSkillId && TOGGLE_SKILLS.includes(activeSkillId)
                        const isNonToggleSkillActive = activeSkillId && !isToggleSkillActive
                        return (
                        <>
                            <button className="btn btn-primary" disabled={selectedCardIds.length === 0 || !!isNonToggleSkillActive} onClick={handleUseCard}>出牌</button>
                            {/* AOE方向选择：显示相邻武将名表示方向 */}
                            {isAoeCard && aoeDirectionLabels && (
                                <>
                                    <button className={`btn ${aoeDirection === 'clockwise' ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => setAoeDirection('clockwise')}>
                                        → {aoeDirectionLabels.clockwise}方向
                                    </button>
                                    <button className={`btn ${aoeDirection === 'counterclockwise' ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => setAoeDirection('counterclockwise')}>
                                        → {aoeDirectionLabels.counterclockwise}方向
                                    </button>
                                </>
                            )}
                            {!isNonToggleSkillActive && <button className="btn" onClick={handleEndTurn}>结束出牌</button>}
                            {/* toggle模式技能激活中：显示高亮标签和取消 */}
                            {isToggleSkillActive && (() => {
                                const skillDef = activeGeneral ? ACTIVE_SKILLS_FOR(activeGeneral.generalId).find(s => s.id === activeSkillId) : null
                                return (
                                    <>
                                        <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '12px' }}>
                                            {skillDef?.name ?? activeSkillId} 模式
                                        </span>
                                        <button className="btn btn-secondary" onClick={handleCancelSkill}>取消{skillDef?.name}</button>
                                    </>
                                )
                            })()}
                            {/* 主动技能按钮（toggle和非toggle技能都未激活时显示） */}
                            {!activeSkillId && activeGeneral && ACTIVE_SKILLS_FOR(activeGeneral.generalId).map(skill => {
                                const usedThisTurn = activeGeneral.skillsUsedThisTurn?.includes(skill.id)
                                const usedLimited = activeGeneral.usedLimitedSkills?.includes(skill.id)
                                const isDisabled = !!(usedThisTurn || usedLimited)
                                return (
                                    <button
                                        key={skill.id}
                                        className={`btn btn-skill ${isDisabled ? 'btn-disabled' : ''}`}
                                        disabled={isDisabled}
                                        onClick={() => {
                                            clearSelection()
                                            setActiveSkillId(skill.id)
                                        }}
                                        title={isDisabled
                                            ? (usedLimited ? '限定技已使用' : '本回合已使用')
                                            : skill.desc}
                                    >
                                        {skill.name}{usedThisTurn ? '·已用' : ''}
                                    </button>
                                )
                            })}
                            {/* 非toggle技能激活中：显示确认/取消按钮 */}
                            {isNonToggleSkillActive && (() => {
                                const skillDef = activeGeneral ? ACTIVE_SKILLS_FOR(activeGeneral.generalId).find(s => s.id === activeSkillId) : null
                                const equipSkillNames: Record<string, string> = { equip_zhangba_spear: '丈八蛇矛' }
                                const displayName = skillDef?.name ?? equipSkillNames[activeSkillId!] ?? activeSkillId
                                return (
                                    <>
                                        <span style={{ color: '#ffd700', fontWeight: 'bold', marginRight: '8px' }}>
                                            {displayName} 激活中{activeSkillId === 'equip_zhangba_spear' ? '（选2张手牌+1个目标）' : ''}
                                        </span>
                                        <button className="btn btn-skill" onClick={handleConfirmSkill}>确认发动</button>
                                        <button className="btn btn-secondary" onClick={handleCancelSkill}>取消</button>
                                    </>
                                )
                            })()}
                            {/* 丈八蛇矛装备技能 */}
                            {!activeSkillId && activeGeneral?.equip?.weapon?.name === 'zhangba_spear' && (
                                <button
                                    className="btn btn-skill"
                                    onClick={() => {
                                        clearSelection()
                                        setActiveSkillId('equip_zhangba_spear')
                                    }}
                                    title="选2张手牌+1个目标，弃牌当杀使用"
                                >
                                    丈八蛇矛
                                </button>
                            )}
                        </>
                        )
                    })()}
                    {isDiscardPhase && isMyTurn && isViewingActive && !gameState.pendingResponse && !gameState.negateWindow && (
                        <button className="btn btn-primary" disabled={selectedCardIds.length === 0} onClick={handleDiscard}>弃牌确认</button>
                    )}
                    {/* 有待响应但不在查看响应武将时，提示点击切换 */}
                    {myPendingResponse && !isViewingResponding && (() => {
                        const rg = generals[pendingResponse!.targetGeneralIndex]
                        const rgName = rg ? (GENERAL_NAMES[rg.generalId] ?? rg.generalId) : '武将'
                        return (
                            <button className="btn btn-danger" onClick={() => setViewingGeneralIdx(pendingResponse!.targetGeneralIndex)}>
                                点击查看 {rgName} 的待操作
                            </button>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.PEACH_SAVE_ASK && (
                        <>
                            <button className="btn btn-danger" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0], { action: 'peach' })}>使用桃</button>
                            <button className="btn btn-skill"
                                onClick={() => handleRespond(selectedCardIds[0] || undefined, { action: 'jiuzhu' })}>救主</button>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0], { action: 'jijiu' })}>急救</button>
                            <button className="btn" onClick={() => handleRespond(undefined)}>跳过</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_ACTIVATE_CONFIRM && (
                        <>
                            <span className="skill-confirm-label">
                                {(pendingResponse.context as any)?.skillId === 'jiangwei_zhiji_choice'
                                    ? '【志继】选择：'
                                    : `发动【${(pendingResponse.context as any)?.skillName}】？`}
                                {(pendingResponse.context as any)?.description && ` ${(pendingResponse.context as any).description}`}
                            </span>
                            {(pendingResponse.context as any)?.skillId === 'jiangwei_zhiji_choice' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'heal' })}>回复体力</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'draw' })}>摸2张牌</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'sunjian_yinghun' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>模式A（摸X弃1）</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'modeB' })}>模式B（摸1弃X）</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'zhugejin_hongyuan' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>发动</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'equip_stone_axe' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length < 2}
                                        onClick={() => emit.respond({ action: 'confirm', cardIds: selectedCardIds.slice(0, 2) } as any)}>
                                        弃{selectedCardIds.length}/2张牌发动
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'equip_green_dragon' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'confirm' })}>
                                        选杀牌追杀
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'daqiao_liuli' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'confirm' })}>
                                        弃牌发动流离
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'xiaoqiao_tianxiang' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'confirm' })}>
                                        选♥牌发动天香
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>发动</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            )}
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.JUDGE_INTERVENE && (
                        <>
                            <span className="skill-confirm-label">修改判定：选一张手牌替换</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0])}>替换判定牌</button>
                            <button className="btn" onClick={() => handleRespond(undefined)}>放弃</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_FANJIAN_SUIT && (
                        <>
                            <span className="skill-confirm-label">猜花色：</span>
                            <button className="btn btn-suit suit-spade" onClick={() => handleRespond(undefined, { suit: 'spade' } as any)}>♠</button>
                            <button className="btn btn-suit suit-heart" onClick={() => handleRespond(undefined, { suit: 'heart' } as any)}>♥</button>
                            <button className="btn btn-suit suit-club" onClick={() => handleRespond(undefined, { suit: 'club' } as any)}>♣</button>
                            <button className="btn btn-suit suit-diamond" onClick={() => handleRespond(undefined, { suit: 'diamond' } as any)}>♦</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GANGLIE_CHOICE && (
                        <>
                            <span className="skill-confirm-label">刚烈发动，选择：</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length < 2}
                                onClick={() => handleRespond(undefined, { action: 'discard', cardIds: selectedCardIds.slice(0, 2) } as any)}>
                                弃2张牌
                            </button>
                            <button className="btn btn-danger"
                                onClick={() => handleRespond(undefined, { action: 'damage' } as any)}>受1伤</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE && (() => {
                        const remaining = (pendingResponse.context as any)?.remaining ?? 0
                        const yijiCardIds = (pendingResponse.context as any)?.yijiCardIds as string[] ?? []
                        // 只允许选择遗计可分配的手牌
                        const validSelected = selectedCardIds.filter(id => yijiCardIds.includes(id))
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    遗计：选择手牌分给一名角色（剩余{remaining}张，已选{validSelected.length}张）
                                </span>
                                <button className="btn btn-skill"
                                    disabled={validSelected.length === 0 || selectedTargets.length === 0}
                                    onClick={() => emit.respond({
                                        cardIds: validSelected,
                                        targetIndex: selectedTargets[0],
                                    } as any)}>
                                    分配{validSelected.length}张给选定角色
                                </button>
                                <button className="btn"
                                    onClick={() => handleRespond(undefined)}>跳过（保留剩余牌）</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LUANWU_PICK_TARGET && (
                        <>
                            <span className="skill-confirm-label">选择杀的目标：</span>
                            {((pendingResponse.context as any)?.candidateIndices as number[] || []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                        </>
                    )}
                    {/* 五谷丰登选牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.HARVEST_PICK && (
                        <>
                            <span className="skill-confirm-label">从五谷丰登中选一张牌：</span>
                            <div className="harvest-pool">
                                {(gameState.harvestPool ?? []).map(card => (
                                    <PlayingCard key={card.id} card={card} selected={false}
                                        onClick={() => handleRespond(card.id)}
                                        onTooltipEnter={(e) => { const c = cardTooltipContent(card.name); if (c) tooltipEnter(e, c) }}
                                        onTooltipMove={tooltipMove}
                                        onTooltipLeave={tooltipLeave}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                    {/* 无懈可击已迁移到独立面板 */}
                    {/* 借刀杀人：出杀或交武器 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.BORROW_SWORD_RESPONSE && (
                        <>
                            <span className="skill-confirm-label">借刀杀人：出杀或交出武器</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0])}>
                                出杀
                            </button>
                            <button className="btn btn-secondary"
                                onClick={() => handleRespond(undefined)}>
                                交出武器
                            </button>
                        </>
                    )}
                    {/* 突袭：选角色 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_TUXI_CHOOSE && (() => {
                        const remaining = (pendingResponse.context as any)?.remainingPicks ?? 2
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    突袭：选择至多{remaining}名有手牌的角色（已选{selectedTargets.length}名）
                                </span>
                                {selectedTargets.length > 0 && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ targetIndices: selectedTargets } as any)}>
                                        确认突袭（{selectedTargets.length}名）
                                    </button>
                                )}
                                <button className="btn" onClick={() => handleRespond(undefined)}>结束突袭</button>
                            </>
                        )
                    })()}
                    {/* 神速：选目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHENSU_TARGET && (
                        <>
                            <span className="skill-confirm-label">神速：选择杀的目标（点击角色区域）</span>
                            {selectedTargets.length > 0 && (
                                <button className="btn btn-skill"
                                    onClick={() => emit.respond({ targetIndex: selectedTargets[0] } as any)}>
                                    确认
                                </button>
                            )}
                        </>
                    )}
                    {/* 神速二：选弃装备 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHENSU_EQUIP && (() => {
                        const myGen = gameState.generals[pendingResponse.targetGeneralIndex]
                        return (
                            <>
                                <span className="skill-confirm-label">神速二：选择弃一张装备牌（已装备或手牌）</span>
                                {myGen?.equip?.weapon && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'weapon' } as any)}>武器</button>
                                )}
                                {myGen?.equip?.armor && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'armor' } as any)}>防具</button>
                                )}
                                {myGen?.equip?.plus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'plus_horse' } as any)}>+1马</button>
                                )}
                                {myGen?.equip?.minus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'minus_horse' } as any)}>-1马</button>
                                )}
                                <button className="btn btn-secondary"
                                    disabled={selectedCardIds.length === 0}
                                    onClick={() => emit.respond({ cardId: selectedCardIds[0] } as any)}>
                                    弃选中的手牌装备
                                </button>
                            </>
                        )
                    })()}
                    {/* 英魂弃牌：选手牌/装备 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YINGHUN_DISCARD && (() => {
                        const ctx = pendingResponse.context as any
                        const discardCount = ctx.discardCount ?? 1
                        const myGen = gameState.generals[pendingResponse.targetGeneralIndex]
                        const totalSelected = selectedCardIds.length + selectedEquipSlots.length
                        const toggleEquip = (slot: string) => {
                            setSelectedEquipSlots(prev =>
                                prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot]
                            )
                        }
                        return (
                            <>
                                <span className="skill-confirm-label">英魂弃牌：选{discardCount}张（已选{totalSelected}）</span>
                                {myGen?.equip?.weapon && (
                                    <button className={`btn ${selectedEquipSlots.includes('weapon') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('weapon')}>武器</button>
                                )}
                                {myGen?.equip?.armor && (
                                    <button className={`btn ${selectedEquipSlots.includes('armor') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('armor')}>防具</button>
                                )}
                                {myGen?.equip?.plus_horse && (
                                    <button className={`btn ${selectedEquipSlots.includes('plus_horse') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('plus_horse')}>+1马</button>
                                )}
                                {myGen?.equip?.minus_horse && (
                                    <button className={`btn ${selectedEquipSlots.includes('minus_horse') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('minus_horse')}>-1马</button>
                                )}
                                <button className="btn btn-skill" disabled={totalSelected !== discardCount}
                                    onClick={() => {
                                        emit.respond({ cardIds: selectedCardIds, equipSlots: selectedEquipSlots } as any)
                                        setSelectedEquipSlots([])
                                    }}>
                                    确认弃牌
                                </button>
                            </>
                        )
                    })()}
                    {/* 反馈：选来源的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_FANKUI_PICK && (() => {
                        const ctx = pendingResponse.context as any
                        const src = gameState.generals[ctx.sourceGeneralIndex]
                        return (
                            <>
                                <span className="skill-confirm-label">反馈：选择获取来源的一张牌</span>
                                {src && (src.handCount ?? 0) > 0 && (
                                    <button className="btn btn-secondary" onClick={() => {
                                        // 随机选一张手牌ID（客户端不知道具体哪张）
                                        emit.respond({ cardId: '__random_hand__' } as any)
                                    }}>手牌(随机{src.handCount ?? '?'}张)</button>
                                )}
                                {src?.equip?.weapon && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.weapon!.id } as any)}>武器</button>
                                )}
                                {src?.equip?.armor && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.armor!.id } as any)}>防具</button>
                                )}
                                {src?.equip?.plus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.plus_horse!.id } as any)}>+1马</button>
                                )}
                                {src?.equip?.minus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.minus_horse!.id } as any)}>-1马</button>
                                )}
                            </>
                        )
                    })()}
                    {/* 观星：排列牌堆顶/底 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GUANXING_ARRANGE && (() => {
                        const ctx = pendingResponse.context as any
                        const allCards = (ctx.guanxingCards ?? []) as any[]
                        const allCardIds = allCards.map((c: any) => c.id)
                        // 初始化：如果 guanxingTop/Bottom 为空或包含上一轮的旧 ID，重新初始化
                        const allAssigned = [...guanxingTop, ...guanxingBottom]
                        const hasStaleIds = allAssigned.length > 0 && !allAssigned.every(id => allCardIds.includes(id))
                        if (hasStaleIds || (allAssigned.length === 0 && allCards.length > 0)) {
                            // 延迟设置以避免渲染中 setState
                            setTimeout(() => {
                                setGuanxingTop(allCardIds)
                                setGuanxingBottom([])
                            }, 0)
                        }
                        const suitSym = (s: string) => ({ heart: '♥', diamond: '♦', spade: '♠', club: '♣' }[s] ?? s)
                        const renderCard = (id: string) => {
                            const c = allCards.find((x: any) => x.id === id)
                            if (!c) return id
                            return `${suitSym(c.suit)}${c.value} ${CARD_NAMES[c.name as keyof typeof CARD_NAMES] ?? c.name}`
                        }
                        const moveToBottom = (id: string) => {
                            setGuanxingTop(prev => prev.filter(x => x !== id))
                            setGuanxingBottom(prev => [...prev, id])
                        }
                        const moveToTop = (id: string) => {
                            setGuanxingBottom(prev => prev.filter(x => x !== id))
                            setGuanxingTop(prev => [...prev, id])
                        }
                        const moveUp = (list: string[], setList: (v: string[]) => void, idx: number) => {
                            if (idx <= 0) return
                            const arr = [...list];
                            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
                            setList(arr)
                        }
                        const moveDown = (list: string[], setList: (v: string[]) => void, idx: number) => {
                            if (idx >= list.length - 1) return
                            const arr = [...list];
                            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
                            setList(arr)
                        }
                        const total = guanxingTop.length + guanxingBottom.length
                        const allPlaced = total === allCards.length && allCards.length > 0
                        return (
                            <div className="guanxing-panel" style={{ background: 'rgba(0,0,0,0.85)', padding: '12px 16px', borderRadius: '8px', marginBottom: '8px', minWidth: '520px' }}>
                                <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                                    <div style={{ minWidth: '200px', flex: 1 }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#ffd700' }}>牌堆顶（先摸到）</div>
                                        {guanxingTop.map((id, idx) => (
                                            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                                                <span style={{ fontSize: '13px', color: '#eee', whiteSpace: 'nowrap' }}>{idx + 1}. {renderCard(id)}</span>
                                                <button className="btn" style={{ fontSize: '11px', padding: '1px 4px' }} onClick={() => moveUp(guanxingTop, setGuanxingTop, idx)}>↑</button>
                                                <button className="btn" style={{ fontSize: '11px', padding: '1px 4px' }} onClick={() => moveDown(guanxingTop, setGuanxingTop, idx)}>↓</button>
                                                <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '1px 6px' }} onClick={() => moveToBottom(id)}>→底</button>
                                            </div>
                                        ))}
                                        {guanxingTop.length === 0 && <div style={{ color: '#888', fontSize: '12px' }}>（空）</div>}
                                    </div>
                                    <div style={{ minWidth: '200px', flex: 1 }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#aaa' }}>牌堆底</div>
                                        {guanxingBottom.map((id, idx) => (
                                            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                                                <span style={{ fontSize: '13px', color: '#ccc', whiteSpace: 'nowrap' }}>{idx + 1}. {renderCard(id)}</span>
                                                <button className="btn" style={{ fontSize: '11px', padding: '1px 4px' }} onClick={() => moveUp(guanxingBottom, setGuanxingBottom, idx)}>↑</button>
                                                <button className="btn" style={{ fontSize: '11px', padding: '1px 4px' }} onClick={() => moveDown(guanxingBottom, setGuanxingBottom, idx)}>↓</button>
                                                <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '1px 6px' }} onClick={() => moveToTop(id)}>→顶</button>
                                            </div>
                                        ))}
                                        {guanxingBottom.length === 0 && <div style={{ color: '#888', fontSize: '12px' }}>（空）</div>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: '70px' }}>
                                        <button className="btn btn-skill" disabled={!allPlaced}
                                            onClick={() => {
                                                emit.respond({ topCardIds: guanxingTop, bottomCardIds: guanxingBottom } as any)
                                                setGuanxingTop([])
                                                setGuanxingBottom([])
                                            }}>
                                            确认排列
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    })()}
                    {/* 英魂：选目标+模式 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YINGHUN_CHOOSE && (() => {
                        const ctx = pendingResponse.context as any
                        const lostHp = ctx.lostHp || 1
                        const others = generals.filter((g, idx) => g.alive && idx !== pendingResponse.targetGeneralIndex)
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ffd700' }}>
                                    英魂 — 选一名角色（X={lostHp}）
                                </div>
                                {others.map(g => {
                                    const gIdx = generals.indexOf(g)
                                    const gName = g.generalId
                                    return (
                                        <div key={gIdx} style={{ marginBottom: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                            <span style={{ color: '#eee', minWidth: '60px' }}>{gName}</span>
                                            <button className="btn btn-skill" style={{ fontSize: '11px' }}
                                                onClick={() => emit.respond({ action: 'modeA', targetIndex: gIdx } as any)}>
                                                摸{lostHp}弃1
                                            </button>
                                            <button className="btn btn-secondary" style={{ fontSize: '11px' }}
                                                onClick={() => emit.respond({ action: 'modeB', targetIndex: gIdx } as any)}>
                                                摸1弃{lostHp}
                                            </button>
                                        </div>
                                    )
                                })}
                                <button className="btn" style={{ marginTop: '6px' }}
                                    onClick={() => emit.respond({ action: 'skip' } as any)}>放弃</button>
                            </div>
                        )
                    })()}
                    {/* 天香：选转移目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_TIANXIANG_CHOOSE && (() => {
                        const others = generals.filter((g, idx) => g.alive && idx !== pendingResponse.targetGeneralIndex)
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ff69b4' }}>天香 — 选择转移伤害的目标</div>
                                {others.map(g => {
                                    const gIdx = generals.indexOf(g)
                                    return (
                                        <button key={gIdx} className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => emit.respond({ targetIndex: gIdx } as any)}>
                                            {GENERAL_NAMES[g.generalId] ?? g.generalId}
                                        </button>
                                    )
                                })}
                            </div>
                        )
                    })()}
                    {/* 流离：选转移目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LIULI_REDIRECT && (() => {
                        const ctx = pendingResponse.context as any
                        const candidateIndices = ctx.candidateIndices as number[] || []
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#87ceeb' }}>流离 — 选择杀的转移目标</div>
                                {candidateIndices.map((idx: number) => {
                                    const g = generals[idx]
                                    if (!g) return null
                                    return (
                                        <button key={idx} className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => emit.respond({ targetIndex: idx } as any)}>
                                            {GENERAL_NAMES[g.generalId] ?? g.generalId}
                                        </button>
                                    )
                                })}
                            </div>
                        )
                    })()}
                    {/* 过河拆桥/顺手牵羊：选目标的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.TRICK_TARGET_CARD_PICK && (() => {
                        const ctx = pendingResponse.context as any
                        const pickTarget = gameState.generals[ctx.targetIndex]
                        const trickLabel = ctx.trickType === 'dismantle' ? '过河拆桥' : '顺手牵羊'
                        const actionLabel = ctx.trickType === 'dismantle' ? '弃' : '拿'
                        const handLen = pickTarget?.hand?.length ?? pickTarget?.handCount ?? 0
                        return (
                            <>
                                <span className="skill-confirm-label">{trickLabel}：选择{actionLabel}目标的哪张牌</span>
                                <div className="trick-pick-grid">
                                    {pickTarget && handLen > 0 && (
                                        <button className="btn btn-secondary"
                                            onClick={() => emit.respond({ action: 'hand' } as any)}>
                                            手牌(随机)
                                        </button>
                                    )}
                                    {pickTarget?.equip?.weapon && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'weapon' } as any)}>
                                            武器：{CARD_NAMES[pickTarget.equip.weapon.name] ?? '武器'}
                                        </button>
                                    )}
                                    {pickTarget?.equip?.armor && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'armor' } as any)}>
                                            防具：{CARD_NAMES[pickTarget.equip.armor.name] ?? '防具'}
                                        </button>
                                    )}
                                    {pickTarget?.equip?.plus_horse && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'plus_horse' } as any)}>
                                            +1马
                                        </button>
                                    )}
                                    {pickTarget?.equip?.minus_horse && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'minus_horse' } as any)}>
                                            -1马
                                        </button>
                                    )}
                                    {pickTarget?.judgeZone && pickTarget.judgeZone.length > 0 && pickTarget.judgeZone.map((jc: any) => (
                                        <button key={jc.id} className="btn btn-secondary"
                                            onClick={() => emit.respond({ action: 'judge', cardId: jc.id } as any)}>
                                            判定区：{jc.name === 'overindulgence' ? '乐不思蜀' : '兵粮寸断'}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )
                    })()}
                    {/* 雌雄双股剑：目标选弃牌或让对方摸牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE && (
                        <>
                            <span className="skill-confirm-label">雌雄双股剑：弃1张手牌或让对方摸1张牌</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => emit.respond({ cardId: selectedCardIds[0], action: 'discard' } as any)}>
                                弃1手牌
                            </button>
                            <button className="btn btn-secondary"
                                onClick={() => emit.respond({ action: 'draw' } as any)}>
                                让对方摸1牌
                            </button>
                        </>
                    )}
                    {/* 麒麟弓：选择弃哪匹马 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_KYLIN_BOW_CHOICE && (
                        <>
                            <span className="skill-confirm-label">麒麟弓：选择弃目标哪匹马</span>
                            <button className="btn btn-skill"
                                onClick={() => emit.respond({ action: 'plus' } as any)}>
                                弃+1马
                            </button>
                            <button className="btn btn-skill"
                                onClick={() => emit.respond({ action: 'minus' } as any)}>
                                弃-1马
                            </button>
                        </>
                    )}
                    {/* 寒冰剑：选择弃目标的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_ICE_SWORD_PICK && (() => {
                        const iceCtx = pendingResponse.context as any
                        const iceTarget = gameState.generals[iceCtx.iceTargetIndex]
                        const remaining = iceCtx.remainingPicks ?? 0
                        const iceTargetName = iceTarget ? (GENERAL_NAMES[iceTarget.generalId] ?? iceTarget.generalId) : '目标'
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    寒冰剑：选择弃【{iceTargetName}】的牌（剩余{remaining}次）
                                </span>
                                {(iceTarget?.handCount > 0 || (iceTarget?.hand && iceTarget.hand.length > 0)) && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'hand' } as any)}>
                                        手牌（随机）
                                    </button>
                                )}
                                {iceTarget?.equip?.weapon && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'weapon' } as any)}>
                                        武器：{CARD_NAMES[iceTarget.equip.weapon.name] ?? '武器'}
                                    </button>
                                )}
                                {iceTarget?.equip?.armor && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'armor' } as any)}>
                                        防具：{CARD_NAMES[iceTarget.equip.armor.name] ?? '防具'}
                                    </button>
                                )}
                                {iceTarget?.equip?.plus_horse && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'plus_horse' } as any)}>
                                        +1马：{CARD_NAMES[iceTarget.equip.plus_horse.name] ?? '+1马'}
                                    </button>
                                )}
                                {iceTarget?.equip?.minus_horse && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'minus_horse' } as any)}>
                                        -1马：{CARD_NAMES[iceTarget.equip.minus_horse.name] ?? '-1马'}
                                    </button>
                                )}
                            </>
                        )
                    })()}
                    {/* 通用响应：出牌/放弃（排除所有专属类型） */}
                    {myPendingResponse
                        && isViewingResponding
                        && pendingResponse?.type !== ResponseType.PEACH_SAVE_ASK
                        && pendingResponse?.type !== ResponseType.SKILL_ACTIVATE_CONFIRM
                        && pendingResponse?.type !== ResponseType.JUDGE_INTERVENE
                        && pendingResponse?.type !== ResponseType.SKILL_LUANWU_PICK_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_FANJIAN_SUIT
                        && pendingResponse?.type !== ResponseType.SKILL_GANGLIE_CHOICE
                        && pendingResponse?.type !== ResponseType.SKILL_YIJI_DISTRIBUTE
                        && pendingResponse?.type !== ResponseType.HARVEST_PICK
                        && pendingResponse?.type !== ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE
                        && pendingResponse?.type !== ResponseType.EQUIP_KYLIN_BOW_CHOICE
                        && pendingResponse?.type !== ResponseType.EQUIP_ICE_SWORD_PICK

                        && pendingResponse?.type !== ResponseType.TRICK_TARGET_CARD_PICK
                        && pendingResponse?.type !== ResponseType.BORROW_SWORD_RESPONSE
                        && pendingResponse?.type !== ResponseType.SKILL_TUXI_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_SHENSU_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_SHENSU_EQUIP
                        && pendingResponse?.type !== ResponseType.SKILL_FANKUI_PICK
                        && pendingResponse?.type !== ResponseType.SKILL_GUANXING_ARRANGE
                        && pendingResponse?.type !== ResponseType.SKILL_YINGHUN_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_TIANXIANG_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_LIULI_REDIRECT
                        && pendingResponse?.type !== ResponseType.SKILL_YINGHUN_DISCARD && (
                            <>
                                {/* 八卦阵按钮 + 倾国按钮：在 DODGE / AOE_DODGE 响应中 */}
                                {(pendingResponse?.type === ResponseType.DODGE || pendingResponse?.type === ResponseType.AOE_DODGE) && (() => {
                                    const rGeneral = gameState.generals[pendingResponse.targetGeneralIndex]
                                    const hasEightTrigrams = rGeneral?.equip?.armor?.name === 'eight_trigrams'
                                    const hasQingguo = rGeneral?.generalId === 'zhenji'
                                    return (
                                        <>
                                            {hasEightTrigrams && (
                                                <button className="btn btn-skill"
                                                    onClick={() => emit.respond({ action: 'eight_trigrams' } as any)}>
                                                    八卦阵判定
                                                </button>
                                            )}
                                            {hasQingguo && (
                                                <span style={{ color: '#a0d0ff', fontWeight: 'bold', fontSize: '12px' }}>
                                                    倾国：黑色手牌可当闪
                                                </span>
                                            )}
                                        </>
                                    )
                                })()}
                                <button className="btn btn-secondary" disabled={selectedCardIds.length === 0}
                                    onClick={() => handleRespond(selectedCardIds[0])}>出牌响应</button>
                                <button className="btn" onClick={() => handleRespond(undefined)}>放弃响应</button>
                            </>
                        )}
                </div>
            </div>
          </div>
          {/* 右侧日志面板 */}
          <div className="game-log-sidebar">
            <div className="game-log-sidebar-header">游戏日志</div>
            <div className="action-log">
                {[...log].reverse().map((entry, i) => (
                    <div key={i} className="log-entry">{highlightLogText(entry.text)}</div>
                ))}
            </div>
          </div>
        </div>
        <TooltipBubble tooltip={tooltip} />
        </>
    )
}
