import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { connectSocket, registerSocketListeners, emit } from '../socket/client'
import { GamePhase } from 'sgs3v3-shared'
import './LobbyPage.css'

export default function LobbyPage() {
    const navigate = useNavigate()
    const { gameState, nickname, setNickname, roomCode, error, setError } = useGameStore()

    const [mode, setMode] = useState<'home' | 'join'>('home')
    const [inputCode, setInputCode] = useState('')
    const [waiting, setWaiting] = useState(false)

    useEffect(() => {
        if (!gameState) return
        if (gameState.phase === GamePhase.GENERAL_PICK || gameState.phase === GamePhase.DEPLOY) {
            navigate('/pick')
        } else if (gameState.phase === GamePhase.PLAYING) {
            navigate('/game')
        }
    }, [gameState?.phase])

    useEffect(() => {
        connectSocket()
        registerSocketListeners({
            onRoomCreated: () => setWaiting(true),
        })
        return () => setError(null)
    }, [])

    function handleCreate() {
        if (!nickname.trim()) return setError('请输入昵称')
        emit.createRoom({ nickname: nickname.trim() })
        setWaiting(true)
    }

    function handleJoin() {
        if (!inputCode.trim()) return setError('请输入房间码')
        const name = nickname.trim() || `玩家${Math.floor(Math.random() * 9000 + 1000)}`
        emit.joinRoom({ roomCode: inputCode.trim().toUpperCase(), nickname: name })
    }

    return (
        <div className="lobby-page">
            <div className="lobby-bg" />
            <div className="lobby-container">
                <div className="lobby-header">
                    <h1 className="page-title">三国杀</h1>
                    <div className="lobby-subtitle">3v3 对战模式</div>
                </div>

                <div className="card-panel lobby-card">
                    {error && (
                        <div className="error-toast" onClick={() => setError(null)}>{error}</div>
                    )}

                    {mode === 'home' && !waiting && (
                        <>
                            <div className="form-group">
                                <label className="form-label">昵称</label>
                                <input
                                    className="input"
                                    placeholder="请输入昵称（2~12字）"
                                    value={nickname}
                                    onChange={(e) => setNickname(e.target.value)}
                                    maxLength={12}
                                />
                            </div>
                            <div className="lobby-actions">
                                <button className="btn btn-primary lobby-btn" onClick={handleCreate}>创建房间</button>
                                <button className="btn btn-secondary lobby-btn" onClick={() => setMode('join')}>加入房间</button>
                            </div>
                        </>
                    )}

                    {mode === 'join' && (
                        <>
                            <div className="form-group">
                                <label className="form-label">昵称</label>
                                <input className="input" placeholder="请输入昵称" value={nickname}
                                    onChange={(e) => setNickname(e.target.value)} maxLength={12} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">房间码</label>
                                <input className="input" placeholder="输入 6 位房间码"
                                    value={inputCode} onChange={(e) => setInputCode(e.target.value.toUpperCase())} maxLength={6} />
                            </div>
                            <div className="lobby-actions">
                                <button className="btn btn-secondary lobby-btn" onClick={handleJoin}>加入</button>
                                <button className="btn lobby-btn" onClick={() => setMode('home')}>返回</button>
                            </div>
                        </>
                    )}

                    {waiting && (
                        <div className="waiting-room">
                            <div className="waiting-code-label">房间码</div>
                            <div className="waiting-code">{roomCode}</div>
                            <div className="waiting-text">等待对手加入...</div>
                            <div className="waiting-spinner" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
