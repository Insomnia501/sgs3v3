import { Server as SocketIOServer, Socket } from 'socket.io'
import {
    SocketEvents,
    GamePhase,
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
} from 'sgs3v3-shared'
import {
    createRoom,
    joinRoom,
    rejoinRoom,
    startPickPhase,
    pickGeneral,
    deployGenerals,
    getRoomBySocketId,
    getPlayerIdBySocketId,
    removeSocketMapping,
    touchRoom,
    deleteRoom,
} from '../rooms/room-manager'
import { toClientView, checkGameOver, addLog } from '../core/game-state'
import { handleUseCard, handleUseSkill, handleRespond, handleNegateRespond, negateWindowTimeout, checkAndOpenNegateWindow, processAutoExecutePending } from '../core/game-actions'
import { handleEndTurn, handleDiscard, chooseActionUnit, startNewRound, handleYieldChoice } from '../core/turn-manager'
import { Room } from '../rooms/room-manager'

// ──────────────────────────────────────────────────────────
// 广播工具
// ──────────────────────────────────────────────────────────

function broadcastGameState(io: SocketIOServer, room: Room) {
    const { gameState, roomCode } = room
    touchRoom(room)  // 更新最后活动时间

    // 广播前检查是否需要为 AOE 的下一个目标开无懈窗口
    checkAndOpenNegateWindow(gameState)

    // 广播前自动处理 autoExecute 的 pending response（如苦肉摸牌、桃园结义回血）
    processAutoExecutePending(gameState)

    // 自动处理可能移除了 pending，暴露出下一个需要无懈窗口的目标
    checkAndOpenNegateWindow(gameState)

    for (const playerId of Object.keys(gameState.players)) {
        const view = toClientView(gameState, playerId)
        io.to(`player:${playerId}`).emit(SocketEvents.GAME_STATE_UPDATE, { state: view })
    }

    // 无懈可击窗口：无人有无懈时自动 3 秒后结算
    scheduleNegateTimeout(io, room)
}

// 无懈窗口超时管理
const negateTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleNegateTimeout(io: SocketIOServer, room: Room) {
    const { gameState, roomCode } = room
    // 清除旧定时器
    const oldTimer = negateTimers.get(roomCode)
    if (oldTimer) {
        clearTimeout(oldTimer)
        negateTimers.delete(roomCode)
    }

    const nw = gameState.negateWindow
    if (!nw) return

    // 只在无人有无懈时设置 3 秒超时
    if (!nw.anyoneHasNegate) {
        const timer = setTimeout(() => {
            negateTimers.delete(roomCode)
            if (!gameState.negateWindow) return
            negateWindowTimeout(gameState)
            if (!checkAndBroadcastGameOver(io, room)) {
                broadcastGameState(io, room)
            }
        }, 3000)
        negateTimers.set(roomCode, timer)
    }
}

function checkAndBroadcastGameOver(io: SocketIOServer, room: Room): boolean {
    const result = checkGameOver(room.gameState)
    if (result.over) {
        room.gameState.phase = GamePhase.GAME_OVER
        io.to(`room:${room.roomCode}`).emit(SocketEvents.GAME_OVER, {
            winnerFaction: result.winnerFaction,
            reason: result.reason,
        })
        broadcastGameState(io, room)
        // 30秒后删除房间（给客户端时间显示结果）
        setTimeout(() => {
            deleteRoom(room.roomCode)
        }, 30_000)
        return true
    }
    return false
}

// ──────────────────────────────────────────────────────────
// 注册事件处理器
// ──────────────────────────────────────────────────────────

export function registerSocketHandlers(io: SocketIOServer, socket: Socket) {
    // ─── 创建房间 ──────────────────────────────────────────
    socket.on(SocketEvents.CREATE_ROOM, (data: C2S_CreateRoom) => {
        try {
            const { room, playerId } = createRoom(socket.id, data.nickname)

            socket.join(`player:${playerId}`)
            socket.join(`room:${room.roomCode}`)

            socket.emit(SocketEvents.ROOM_CREATED, {
                roomCode: room.roomCode,
                playerId,
            })
            console.log(`[Room] Created: ${room.roomCode} by "${data.nickname}" (${playerId})`)
        } catch (e) {
            socket.emit(SocketEvents.ERROR, { message: '创建房间失败' })
        }
    })

    // ─── 加入房间 ──────────────────────────────────────────
    socket.on(SocketEvents.JOIN_ROOM, (data: C2S_JoinRoom) => {
        try {
            const result = joinRoom(socket.id, data.roomCode.toUpperCase(), data.nickname)
            if ('error' in result) {
                return socket.emit(SocketEvents.ERROR, { message: result.error })
            }

            const { room, playerId } = result
            socket.join(`player:${playerId}`)
            socket.join(`room:${room.roomCode}`)

            socket.emit(SocketEvents.ROOM_JOINED, { playerId })
            console.log(`[Room] "${data.nickname}" (${playerId}) joined ${room.roomCode}`)

            // 两人到齐，进入选将阶段
            startPickPhase(room)
            addLog(room.gameState, '两名玩家已就位，选将阶段开始！')
            broadcastGameState(io, room)
        } catch (e) {
            socket.emit(SocketEvents.ERROR, { message: '加入房间失败' })
        }
    })

    // ─── 重连房间 ──────────────────────────────────────────
    socket.on(SocketEvents.REJOIN_ROOM, (data: { roomCode: string; playerId: string }) => {
        try {
            const result = rejoinRoom(socket.id, data.roomCode, data.playerId)
            if ('error' in result) {
                return socket.emit(SocketEvents.REJOIN_FAIL, { message: result.error })
            }

            const { room } = result
            socket.join(`player:${data.playerId}`)
            socket.join(`room:${room.roomCode}`)

            addLog(room.gameState, `【${room.gameState.players[data.playerId]?.nickname}】重新连接`)

            socket.emit(SocketEvents.REJOIN_OK, {
                playerId: data.playerId,
                roomCode: room.roomCode,
            })

            // 发送当前游戏状态
            const view = toClientView(room.gameState, data.playerId)
            socket.emit(SocketEvents.GAME_STATE_UPDATE, { state: view })
            broadcastGameState(io, room)
        } catch (e) {
            socket.emit(SocketEvents.REJOIN_FAIL, { message: '重连失败' })
        }
    })

    // ─── 选将 ──────────────────────────────────────────────
    socket.on(SocketEvents.PICK_GENERAL, (data: C2S_PickGeneral) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return socket.emit(SocketEvents.ERROR, { message: '找不到房间或玩家信息' })
        if (room.gameState.phase !== GamePhase.GENERAL_PICK) return

        const result = pickGeneral(room, playerId, data.generalId)
        if ('error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        broadcastGameState(io, room)
    })

    // ─── 部署武将 ──────────────────────────────────────────
    socket.on(SocketEvents.DEPLOY_GENERALS, (data: C2S_DeployGenerals) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return socket.emit(SocketEvents.ERROR, { message: '找不到房间或玩家信息' })
        if (room.gameState.phase !== GamePhase.DEPLOY) return

        const result = deployGenerals(room, playerId, data.commander, data.flankA, data.flankB)
        if ('error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (result.allDeployed) {
            addLog(room.gameState, '双方部署完成，冷色方请选择先手/让先！')
        }
        broadcastGameState(io, room)
    })

    // ─── 先手/让先选择 ──────────────────────────────────
    socket.on(SocketEvents.YIELD_CHOICE, (data: C2S_YieldChoice) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return
        const state = room.gameState

        if (state.phase !== GamePhase.PLAYING) return

        const result = handleYieldChoice(state, playerId, data.yield)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 选择行动单元（主帅/边锋） ─────────────────────
    socket.on(SocketEvents.CHOOSE_ACTION_UNIT, (data: C2S_ChooseActionUnit) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return
        const state = room.gameState

        if (state.phase !== GamePhase.PLAYING) return

        const result = chooseActionUnit(state, playerId, data.unit, data.flankOrder)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 使用卡牌 ──────────────────────────────────────────
    socket.on(SocketEvents.USE_CARD, (data: C2S_UseCard) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return

        const result = handleUseCard(room.gameState, playerId, data)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 发动技能 ──────────────────────────────────────────
    socket.on(SocketEvents.USE_SKILL, (data: C2S_UseSkill) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return

        const result = handleUseSkill(room.gameState, playerId, data)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 响应（出闪/桃/无懈等） ────────────────────────────
    socket.on(SocketEvents.RESPOND, (data: C2S_Respond) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return

        const result = handleRespond(room.gameState, playerId, data)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 结束出牌阶段 ──────────────────────────────────────
    socket.on(SocketEvents.END_TURN, () => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return

        const result = handleEndTurn(room.gameState, playerId)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }
        broadcastGameState(io, room)
    })

    // ─── 弃牌阶段 ──────────────────────────────────────────
    socket.on(SocketEvents.DISCARD, (data: C2S_Discard) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return

        const result = handleDiscard(room.gameState, playerId, data.cardIds)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }
        broadcastGameState(io, room)
    })

    // ─── 无懈可击响应 ────────────────────────────────────────
    socket.on(SocketEvents.NEGATE_RESPOND, (data: C2S_NegateRespond) => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (!room || !playerId) return
        const state = room.gameState

        if (state.phase !== GamePhase.PLAYING) return

        const result = handleNegateRespond(state, playerId, data)
        if (result && 'error' in result) {
            return socket.emit(SocketEvents.ERROR, { message: result.error })
        }

        if (!checkAndBroadcastGameOver(io, room)) {
            broadcastGameState(io, room)
        }
    })

    // ─── 断线处理 ──────────────────────────────────────────
    socket.on('disconnect', () => {
        const room = getRoomBySocketId(socket.id)
        const playerId = getPlayerIdBySocketId(socket.id)
        if (room && playerId) {
            const player = room.gameState.players[playerId]
            if (player) {
                player.connected = false
                addLog(room.gameState, `【${player.nickname}】断线`)
                broadcastGameState(io, room)
            }
        }
        removeSocketMapping(socket.id)
    })
}
