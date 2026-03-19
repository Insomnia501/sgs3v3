import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { connectSocket, registerSocketListeners, emit, saveSession, loadSession, clearSession } from './socket/client'
import { useGameStore } from './store/gameStore'
import { GamePhase } from 'sgs3v3-shared'
import LobbyPage from './pages/LobbyPage'
import GeneralPickPage from './pages/GeneralPickPage'
import GamePage from './pages/GamePage'
import GameOverPage from './pages/GameOverPage'

export default function App() {
    const { setGameState, setError, setPlayerId, setMyFaction, setIsSpectator, gameState } = useGameStore()
    const setWinnerFaction = useGameStore((s) => s.setWinnerFaction)

    useEffect(() => {
        const s = connectSocket()

        registerSocketListeners({
            onRoomCreated: (data) => {
                setPlayerId(data.playerId)
                useGameStore.setState({ roomCode: data.roomCode })
                saveSession(data.playerId, data.roomCode)
            },
            onRoomJoined: (data) => {
                setPlayerId(data.playerId)
                // roomCode 在 joinRoom 时已知，从 store 获取
                const rc = useGameStore.getState().roomCode
                if (rc) saveSession(data.playerId, rc)
            },
            onSpectateJoin: (data) => {
                setIsSpectator(true)
                useGameStore.setState({ roomCode: data.roomCode })
            },
            onRejoinOk: (data) => {
                setPlayerId(data.playerId)
                useGameStore.setState({ roomCode: data.roomCode })
                saveSession(data.playerId, data.roomCode)
                console.log('[Rejoin] Successfully rejoined', data.roomCode)
            },
            onRejoinFail: (data) => {
                console.log('[Rejoin] Failed:', data.message)
                clearSession()
            },
            onGameStateUpdate: (data) => {
                setGameState(data.state)
                if (data.state.myFaction) setMyFaction(data.state.myFaction)
            },
            onGameOver: (data) => {
                setWinnerFaction(data.winnerFaction)
                clearSession()
            },
            onError: (data) => {
                setError(data.message)
            },
        })

        // 页面加载时检查是否有保存的会话（刷新恢复场景）
        // 只在 store 中没有 gameState 时尝试 rejoin（避免与正常 create/join 冲突）
        const session = loadSession()
        if (session && !useGameStore.getState().gameState) {
            console.log('[Rejoin] Page loaded with saved session, attempting rejoin...', session.roomCode)
            s.on('connect', function onFirstConnect() {
                s.off('connect', onFirstConnect) // 只执行一次
                emit.rejoinRoom({ roomCode: session.roomCode, playerId: session.playerId })
            })
        }
    }, [])

    // 根据游戏阶段自动路由
    const phase = gameState?.phase

    return (
        <Routes>
            <Route path="/" element={<LobbyPage />} />
            <Route
                path="/pick"
                element={
                    phase === GamePhase.GENERAL_PICK || phase === GamePhase.DEPLOY
                        ? <GeneralPickPage />
                        : <Navigate to="/" replace />
                }
            />
            <Route
                path="/game"
                element={
                    phase === GamePhase.PLAYING
                        ? <GamePage />
                        : phase === GamePhase.GAME_OVER
                            ? <Navigate to="/gameover" replace />
                            : <Navigate to="/" replace />
                }
            />
            <Route path="/gameover" element={<GameOverPage />} />
        </Routes>
    )
}
