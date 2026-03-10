import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { emit } from '../socket/client'
import { GENERAL_IMAGE } from '../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from '../components/Tooltip'
import {
    GamePhase,
    Faction,
    PICK_SEQUENCE,
} from 'sgs3v3-shared'
import './GeneralPickPage.css'

export default function GeneralPickPage() {
    const navigate = useNavigate()
    const { gameState, myFaction } = useGameStore()
    const [deploySelection, setDeploySelection] = useState<{
        commander?: string
        flankA?: string
        flankB?: string
    }>({})
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(1500)

    useEffect(() => {
        if (gameState?.phase === GamePhase.PLAYING) navigate('/game')
    }, [gameState?.phase])

    if (!gameState) return null

    const { phase, pickState, deployState } = gameState

    // ── 选将阶段 ──────────────────────────────────────────────
    if (phase === GamePhase.GENERAL_PICK && pickState) {
        const currentFaction = PICK_SEQUENCE[pickState.pickStep]
        const isMyTurn = currentFaction === myFaction
        const pickedIds = new Set([
            ...pickState.warmPicked.map((g) => g.id),
            ...pickState.coolPicked.map((g) => g.id),
        ])

        return (
            <div className="pick-page">
                <div className="pick-header">
                    <div className="pick-title page-title">武将选择</div>
                    <div className="pick-turn-info">
                        <span className={currentFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {currentFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        <span> 选将中</span>
                        <span className="pick-step">（{pickState.pickStep + 1} / 16）</span>
                    </div>
                    {isMyTurn && <div className="pick-my-turn-badge">轮到你选了！</div>}
                </div>

                <div className="pick-main">
                    <div className="pick-pool">
                        {pickState.pool.map((g) => {
                            const isPicked = pickedIds.has(g.id)
                            return (
                                <div
                                    key={g.id}
                                    className={`general-pick-card ${isPicked ? 'picked' : ''} ${isMyTurn && !isPicked ? 'selectable' : ''}`}
                                    onClick={() => {
                                        if (isMyTurn && !isPicked) emit.pickGeneral({ generalId: g.id })
                                    }}
                                    onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                    onMouseMove={onMove}
                                    onMouseLeave={onLeave}
                                >
                                    <div className="gpc-card-portrait">
                                        {GENERAL_IMAGE[g.id]
                                            ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="gpc-portrait-img" />
                                            : <span className="gpc-avatar-placeholder">{g.name[0]}</span>
                                        }
                                    </div>
                                    <div className="gpc-info">
                                        <div className="gpc-name">{g.name}</div>
                                        <div className="gpc-hp">{'♥'.repeat(g.maxHp)}</div>
                                        <div className="gpc-skills">
                                            {g.skills.map((s) => (
                                                <span key={s.id} className="gpc-skill-tag" title={s.description}>{s.name}</span>
                                            ))}
                                        </div>
                                    </div>
                                    {isPicked && <div className="gpc-picked-overlay">已选</div>}
                                </div>
                            )
                        })}
                    </div>

                    <div className="pick-sidebar">
                        <div className="pick-sidebar-section">
                            <div className="pick-sidebar-title faction-warm">暖色方 ({pickState.warmPicked.length}/8)</div>
                            <div className="pick-picked-list">
                                {pickState.warmPicked.map((g) => <div key={g.id} className="pick-picked-item">{g.name}</div>)}
                            </div>
                        </div>
                        <div className="pick-sidebar-section">
                            <div className="pick-sidebar-title faction-cool">冷色方 ({pickState.coolPicked.length}/8)</div>
                            <div className="pick-picked-list">
                                {pickState.coolPicked.map((g) => <div key={g.id} className="pick-picked-item">{g.name}</div>)}
                            </div>
                        </div>
                    </div>
                </div>
                <TooltipBubble tooltip={tooltip} />
            </div>
        )
    }

    // ── 部署阶段 ──────────────────────────────────────────────
    if (phase === GamePhase.DEPLOY && pickState && deployState) {
        const myPicked = myFaction === Faction.WARM ? pickState.warmPicked : pickState.coolPicked
        const myDeployed = myFaction === Faction.WARM ? deployState.warmDeployed : deployState.coolDeployed

        function selectForSlot(slot: 'commander' | 'flankA' | 'flankB', gId: string) {
            setDeploySelection((prev) => {
                const clean = { ...prev }
                if (clean.commander === gId) clean.commander = undefined
                if (clean.flankA === gId) clean.flankA = undefined
                if (clean.flankB === gId) clean.flankB = undefined
                return { ...clean, [slot]: gId }
            })
        }

        function handleDeploy() {
            const { commander, flankA, flankB } = deploySelection
            if (!commander || !flankA || !flankB) return
            emit.deployGenerals({ commander, flankA, flankB })
        }

        const deployReady = deploySelection.commander && deploySelection.flankA && deploySelection.flankB

        return (
            <div className="pick-page">
                <div className="pick-header">
                    <div className="pick-title page-title">部署武将</div>
                    <div className="pick-turn-info">
                        你是 <span className={myFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>{myFaction === Faction.WARM ? '暖色方' : '冷色方'}</span>
                        ，将 3 名武将分配到阵营位置
                    </div>
                </div>

                <div className="deploy-main">
                    <div className="deploy-slots">
                        {(['flankA', 'commander', 'flankB'] as const).map((slot) => {
                            const label = { commander: '主帅', flankA: '前锋A', flankB: '前锋B' }[slot]
                            const assigned = myPicked.find((g) => g.id === deploySelection[slot])
                            const isCommander = slot === 'commander'
                            return (
                                <div key={slot} className={`deploy-slot ${assigned ? 'filled' : ''} ${isCommander ? 'deploy-slot-commander' : ''}`}>
                                    <div className="deploy-slot-label">{label}</div>
                                    <div className="deploy-slot-content">
                                        {assigned
                                            ? <div className="deploy-assigned">
                                                <div className="gpc-avatar small">
                                                    {GENERAL_IMAGE[assigned.id]
                                                        ? <img src={GENERAL_IMAGE[assigned.id]} alt={assigned.name} className="gpc-portrait-img" />
                                                        : <span className="gpc-avatar-placeholder">{assigned.name[0]}</span>
                                                    }
                                                </div>
                                                <span>{assigned.name}</span>
                                            </div>
                                            : <span className="deploy-empty">未选择</span>
                                        }
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="deploy-pool">
                        {myPicked.map((g) => (
                            <div key={g.id} className="deploy-general-card"
                                onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                onMouseMove={onMove}
                                onMouseLeave={onLeave}
                            >
                                <div className="gpc-avatar small">
                                    {GENERAL_IMAGE[g.id]
                                        ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="gpc-portrait-img" />
                                        : <span className="gpc-avatar-placeholder">{g.name[0]}</span>
                                    }
                                </div>
                                <div className="deploy-general-info">
                                    <div className="gpc-name">{g.name}</div>
                                    <div className="deploy-assign-btns">
                                        {(['flankA', 'commander', 'flankB'] as const).map((slot) => (
                                            <button
                                                key={slot}
                                                className={`btn deploy-assign-btn ${deploySelection[slot] === g.id ? 'active' : ''}`}
                                                onClick={() => selectForSlot(slot, g.id)}
                                            >
                                                {{ commander: '主帅', flankA: '前锋A', flankB: '前锋B' }[slot]}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="deploy-confirm-area">
                        {myDeployed
                            ? <div className="deploy-waiting">等待对方部署...</div>
                            : <button className="btn btn-primary deploy-confirm-btn" disabled={!deployReady} onClick={handleDeploy}>
                                确认部署
                            </button>
                        }
                    </div>
                </div>
                <TooltipBubble tooltip={tooltip} />
            </div>
        )
    }

    return null
}
