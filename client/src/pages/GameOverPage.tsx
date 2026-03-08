import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { Faction } from 'sgs3v3-shared'

export default function GameOverPage() {
    const navigate = useNavigate()
    const { myFaction, winnerFaction } = useGameStore()

    const isWin = winnerFaction != null && winnerFaction === myFaction

    return (
        <div style={{
            width: '100vw', height: '100vh',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 24, background: 'var(--color-bg)',
        }}>
            <div className="page-title" style={{
                fontSize: 48,
                color: isWin ? '#ffd700' : '#ff4444',
            }}>
                {isWin ? '🎉 胜利！' : '💀 败北'}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}>
                {winnerFaction === Faction.WARM ? '暖色方' : '冷色方'}获得胜利
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/')}>
                返回大厅
            </button>
        </div>
    )
}
