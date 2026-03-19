import { create } from 'zustand'
import {
    GameStateClientView,
    GamePhase,
    Faction,
    GeneralClientView,
} from 'sgs3v3-shared'

interface AppState {
    // 连接状态
    playerId: string | null
    nickname: string
    roomCode: string | null
    myFaction: Faction | null
    isSpectator: boolean

    // 游戏状态
    gameState: GameStateClientView | null
    winnerFaction: Faction | null

    // 选牌状态（客户端 UI 交互）
    selectedCardIds: string[]
    selectedTargets: number[]

    // 错误信息
    error: string | null

    // Actions
    setPlayerId: (id: string) => void
    setNickname: (n: string) => void
    setRoomCode: (code: string) => void
    setMyFaction: (f: Faction) => void
    setIsSpectator: (v: boolean) => void
    setGameState: (state: GameStateClientView) => void
    setWinnerFaction: (f: Faction | null) => void
    setError: (msg: string | null) => void
    toggleCardSelection: (cardId: string) => void
    toggleTargetSelection: (index: number) => void
    clearSelection: () => void
}

export const useGameStore = create<AppState>((set) => ({
    playerId: null,
    nickname: '',
    roomCode: null,
    myFaction: null,
    isSpectator: false,
    gameState: null,
    winnerFaction: null,
    selectedCardIds: [],
    selectedTargets: [],
    error: null,

    setPlayerId: (id) => set({ playerId: id }),
    setNickname: (n) => set({ nickname: n }),
    setRoomCode: (code) => set({ roomCode: code }),
    setMyFaction: (f) => set({ myFaction: f }),
    setIsSpectator: (v) => set({ isSpectator: v }),
    setGameState: (state) => set({ gameState: state }),
    setWinnerFaction: (f) => set({ winnerFaction: f }),
    setError: (msg) => set({ error: msg }),

    toggleCardSelection: (cardId) =>
        set((s) => ({
            selectedCardIds: s.selectedCardIds.includes(cardId)
                ? s.selectedCardIds.filter((id) => id !== cardId)
                : [...s.selectedCardIds, cardId],
        })),

    toggleTargetSelection: (index) =>
        set((s) => ({
            selectedTargets: s.selectedTargets.includes(index)
                ? s.selectedTargets.filter((i) => i !== index)
                : [...s.selectedTargets, index],
        })),

    clearSelection: () => set({ selectedCardIds: [], selectedTargets: [] }),
}))
