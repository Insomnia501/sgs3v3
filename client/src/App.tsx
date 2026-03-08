import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { connectSocket, registerSocketListeners } from './socket/client'
import { useGameStore } from './store/gameStore'
import { GamePhase } from 'sgs3v3-shared'
import LobbyPage from './pages/LobbyPage'
import GeneralPickPage from './pages/GeneralPickPage'
import GamePage from './pages/GamePage'
import GameOverPage from './pages/GameOverPage'

export default function App() {
    const { setGameState, setError, setPlayerId, setMyFaction, gameState } = useGameStore()
    const setWinnerFaction = useGameStore((s) => s.setWinnerFaction)

    useEffect(() => {
        connectSocket()

        registerSocketListeners({
            onRoomCreated: (data) => {
                setPlayerId(data.playerId)
                useGameStore.setState({ roomCode: data.roomCode })
            },
            onRoomJoined: (data) => {
                setPlayerId(data.playerId)
            },
            onGameStateUpdate: (data) => {
                setGameState(data.state)
                if (data.state.myFaction) setMyFaction(data.state.myFaction)
            },
            onGameOver: (data) => {
                setWinnerFaction(data.winnerFaction)
            },
            onError: (data) => {
                setError(data.message)
            },
        })
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
