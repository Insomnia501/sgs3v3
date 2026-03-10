import { useState, useRef, useCallback, useEffect } from 'react'
import { CARD_TOOLTIP, NO_TOOLTIP_CARDS, GENERAL_SKILLS } from '../data/tooltipData'
import type { GeneralDefinition } from 'sgs3v3-shared'

// ── 通用 Tooltip state hook ──

interface TooltipState {
    visible: boolean
    x: number
    y: number
    content: { title: string; items: { name: string; desc: string }[] } | null
}

export function useTooltip(delay = 1500) {
    const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, content: null })
    const timerRef = useRef<number | null>(null)
    const posRef = useRef({ x: 0, y: 0 })

    const clear = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        setTooltip(prev => prev.visible ? { ...prev, visible: false } : prev)
    }, [])

    const onEnter = useCallback((
        e: React.MouseEvent,
        content: { title: string; items: { name: string; desc: string }[] }
    ) => {
        posRef.current = { x: e.clientX, y: e.clientY }
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
            setTooltip({ visible: true, x: posRef.current.x, y: posRef.current.y, content })
        }, delay)
    }, [delay])

    const onMove = useCallback((e: React.MouseEvent) => {
        posRef.current = { x: e.clientX, y: e.clientY }
        // 如果已经显示则实时跟踪位置
        setTooltip(prev => prev.visible ? { ...prev, x: e.clientX, y: e.clientY } : prev)
    }, [])

    const onLeave = useCallback(() => { clear() }, [clear])

    // cleanup on unmount
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

    return { tooltip, onEnter, onMove, onLeave }
}

// ── 辅助函数 ──

/** 为武将生成 tooltip 内容（从 GeneralDefinition） */
export function generalTooltipContent(g: { name: string; skills: { name: string; description: string }[] }) {
    return {
        title: g.name,
        items: g.skills.map(s => ({ name: s.name, desc: s.description })),
    }
}

/** 按 generalId 查找武将技能生成 tooltip 内容（用于 GamePage） */
export function generalTooltipById(generalId: string) {
    const g = GENERAL_SKILLS[generalId]
    if (!g) return null
    return {
        title: g.name,
        items: g.skills.map(s => ({ name: s.name, desc: s.description })),
    }
}

/** 为游戏牌生成 tooltip 内容（基本牌返回 null） */
export function cardTooltipContent(cardName: string) {
    if (NO_TOOLTIP_CARDS.has(cardName)) return null
    const info = CARD_TOOLTIP[cardName]
    if (!info) return null
    return {
        title: info.name,
        items: [{ name: '', desc: info.desc }],
    }
}

// ── Tooltip 渲染组件 ──

export function TooltipBubble({ tooltip }: { tooltip: TooltipState }) {
    if (!tooltip.visible || !tooltip.content) return null

    // 计算位置：放在鼠标右上方，避免超出屏幕
    const style: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(tooltip.x + 12, window.innerWidth - 320),
        top: Math.max(tooltip.y - 20, 8),
        zIndex: 9999,
    }

    return (
        <div className="hover-tooltip" style={style}>
            <div className="hover-tooltip-title">{tooltip.content.title}</div>
            {tooltip.content.items.map((item, i) => (
                <div key={i} className="hover-tooltip-skill">
                    {item.name && <span className="hover-tooltip-skill-name">【{item.name}】</span>}
                    <span className="hover-tooltip-skill-desc">{item.desc}</span>
                </div>
            ))}
        </div>
    )
}
