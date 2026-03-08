import { io, Socket } from 'socket.io-client'
import {
    SocketEvents,
    C2S_CreateRoom,
    C2S_JoinRoom,
    C2S_PickGeneral,
    C2S_DeployGenerals,
    C2S_ChooseActionUnit,
    C2S_UseCard,
    C2S_UseSkill,
    C2S_Respond,
    C2S_Discard,
    C2S_YieldChoice,
    C2S_NegateRespond,
    S2C_RoomCreated,
    S2C_RoomJoined,
    S2C_GameStateUpdate,
    S2C_GameOver,
    S2C_Error,
} from 'sgs3v3-shared'

// ── Socket 单例 ──────────────────────────────────────────────

let socket: Socket | null = null

export function getSocket(): Socket {
    if (!socket) {
        socket = io({ autoConnect: false })
    }
    return socket
}

export function connectSocket(): Socket {
    const s = getSocket()
    if (!s.connected) s.connect()
    return s
}

// ── 发送事件（服务端通过 socketId 识别玩家，无需传 playerId） ──

export const emit = {
    createRoom: (data: C2S_CreateRoom) =>
        getSocket().emit(SocketEvents.CREATE_ROOM, data),

    joinRoom: (data: C2S_JoinRoom) =>
        getSocket().emit(SocketEvents.JOIN_ROOM, data),

    pickGeneral: (data: C2S_PickGeneral) =>
        getSocket().emit(SocketEvents.PICK_GENERAL, data),

    deployGenerals: (data: C2S_DeployGenerals) =>
        getSocket().emit(SocketEvents.DEPLOY_GENERALS, data),

    chooseActionUnit: (data: C2S_ChooseActionUnit) =>
        getSocket().emit(SocketEvents.CHOOSE_ACTION_UNIT, data),

    useCard: (data: C2S_UseCard) =>
        getSocket().emit(SocketEvents.USE_CARD, data),

    useSkill: (data: C2S_UseSkill) =>
        getSocket().emit(SocketEvents.USE_SKILL, data),

    respond: (data: C2S_Respond) =>
        getSocket().emit(SocketEvents.RESPOND, data),

    endTurn: () =>
        getSocket().emit(SocketEvents.END_TURN),

    discard: (data: C2S_Discard) =>
        getSocket().emit(SocketEvents.DISCARD, data),

    yieldChoice: (data: C2S_YieldChoice) =>
        getSocket().emit(SocketEvents.YIELD_CHOICE, data),

    negateRespond: (data: C2S_NegateRespond) =>
        getSocket().emit(SocketEvents.NEGATE_RESPOND, data),
}

// ── 监听事件 ────────────────────────────────────────────────

export type SocketEventHandlers = {
    onRoomCreated?: (data: S2C_RoomCreated) => void
    onRoomJoined?: (data: S2C_RoomJoined) => void
    onGameStateUpdate?: (data: S2C_GameStateUpdate) => void
    onGameOver?: (data: S2C_GameOver) => void
    onError?: (data: S2C_Error) => void
}

export function registerSocketListeners(handlers: SocketEventHandlers) {
    const s = getSocket()
    if (handlers.onRoomCreated) s.on(SocketEvents.ROOM_CREATED, handlers.onRoomCreated)
    if (handlers.onRoomJoined) s.on(SocketEvents.ROOM_JOINED, handlers.onRoomJoined)
    if (handlers.onGameStateUpdate) s.on(SocketEvents.GAME_STATE_UPDATE, handlers.onGameStateUpdate)
    if (handlers.onGameOver) s.on(SocketEvents.GAME_OVER, handlers.onGameOver)
    if (handlers.onError) s.on(SocketEvents.ERROR, handlers.onError)
}

export function unregisterSocketListeners(handlers: SocketEventHandlers) {
    const s = getSocket()
    if (handlers.onRoomCreated) s.off(SocketEvents.ROOM_CREATED, handlers.onRoomCreated)
    if (handlers.onRoomJoined) s.off(SocketEvents.ROOM_JOINED, handlers.onRoomJoined)
    if (handlers.onGameStateUpdate) s.off(SocketEvents.GAME_STATE_UPDATE, handlers.onGameStateUpdate)
    if (handlers.onGameOver) s.off(SocketEvents.GAME_OVER, handlers.onGameOver)
    if (handlers.onError) s.off(SocketEvents.ERROR, handlers.onError)
}
