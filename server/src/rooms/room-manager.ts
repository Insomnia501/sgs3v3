import { v4 as uuidv4 } from 'uuid'
import {
    Faction,
    GamePhase,
    TurnPhase,
    Player,
    GameState,
    GeneralDefinition,
    PICK_SEQUENCE,
    SeatRole,
} from 'sgs3v3-shared'
import { createDeck, shuffleDeck } from '../core/cards'
import { getGeneralPool } from '../core/generals'
import { createGeneralInstance } from '../core/game-state'

/** 完整房间数据（内含 GameState） */
export interface Room {
    roomCode: string
    gameState: GameState
    lastActivity: number  // 最后活动时间戳
}

/** 全局房间表：roomCode → Room */
const rooms = new Map<string, Room>()

/** socketId → roomCode */
const socketToRoom = new Map<string, string>()

/** socketId → playerId（核心映射：通过 socket 确定玩家身份） */
const socketToPlayer = new Map<string, string>()

/** 房间超时时间：2小时 */
const ROOM_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** 清理间隔：10分钟 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

// ──────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────

function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
}

function makeUniqueRoomCode(): string {
    let code = generateRoomCode()
    while (rooms.has(code)) code = generateRoomCode()
    return code
}

// ──────────────────────────────────────────────────────────
// 创建房间
// ──────────────────────────────────────────────────────────

export function createRoom(socketId: string, nickname: string): { room: Room; playerId: string } {
    const roomCode = makeUniqueRoomCode()
    const playerId = uuidv4()

    const player: Player = {
        id: playerId,
        nickname,
        faction: Faction.WARM,
        connected: true,
    }

    const gameState: GameState = {
        roomId: roomCode,
        phase: GamePhase.WAITING,
        players: { [playerId]: player },
        warmPlayerId: playerId,
        coolPlayerId: '',
        generals: [],
        deck: [],
        discard: [],
        turnPhase: TurnPhase.TURN_START,
        activePlayerFaction: Faction.COOL,
        activeGeneralIndex: 0,
        attackUsedThisTurn: 0,
        pendingResponseQueue: [],
        roundState: {
            roundNumber: 0,
            firstMover: Faction.COOL,
            currentActionStep: 0,
        },
        log: [],
    }

    const room: Room = { roomCode, gameState, lastActivity: Date.now() }
    rooms.set(roomCode, room)
    socketToRoom.set(socketId, roomCode)
    socketToPlayer.set(socketId, playerId)

    return { room, playerId }
}

// ──────────────────────────────────────────────────────────
// 加入房间
// ──────────────────────────────────────────────────────────

export function joinRoom(
    socketId: string,
    roomCode: string,
    nickname: string
): { room: Room; playerId: string } | { error: string } {
    const room = rooms.get(roomCode)
    if (!room) return { error: '房间不存在' }
    if (room.gameState.phase !== GamePhase.WAITING) return { error: '游戏已开始' }

    const existingPlayers = Object.keys(room.gameState.players)
    if (existingPlayers.length >= 2) return { error: '房间已满' }

    const playerId = uuidv4()
    const player: Player = {
        id: playerId,
        nickname,
        faction: Faction.COOL,
        connected: true,
    }

    room.gameState.players[playerId] = player
    room.gameState.coolPlayerId = playerId
    socketToRoom.set(socketId, roomCode)
    socketToPlayer.set(socketId, playerId)

    return { room, playerId }
}

// ──────────────────────────────────────────────────────────
// 启动选将阶段
// ──────────────────────────────────────────────────────────

export function startPickPhase(room: Room): void {
    const pool: GeneralDefinition[] = getGeneralPool()
    // 随机打乱取 16 张
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 16)

    room.gameState.pickState = {
        pool: shuffled,
        pickStep: 0,
        warmPicked: [],
        coolPicked: [],
    }
    room.gameState.phase = GamePhase.GENERAL_PICK
}

// ──────────────────────────────────────────────────────────
// 处理选将
// ──────────────────────────────────────────────────────────

export function pickGeneral(
    room: Room,
    playerId: string,
    generalId: string
): { error: string } | { done: boolean } {
    const state = room.gameState
    const pick = state.pickState!
    const currentFaction = PICK_SEQUENCE[pick.pickStep]

    const playerFaction = state.players[playerId]?.faction
    if (!playerFaction) return { error: '玩家不存在' }
    if (playerFaction !== currentFaction) return { error: '还没到你选将' }

    const general = pick.pool.find((g) => g.id === generalId)
    if (!general) return { error: '武将不在可选池中' }

    const alreadyPicked = [...pick.warmPicked, ...pick.coolPicked].some((g) => g.id === generalId)
    if (alreadyPicked) return { error: '武将已被选走' }

    if (currentFaction === Faction.WARM) pick.warmPicked.push(general)
    else pick.coolPicked.push(general)
    pick.pickStep++

    if (pick.pickStep >= PICK_SEQUENCE.length) {
        state.phase = GamePhase.DEPLOY
        state.deployState = { warmDeployed: false, coolDeployed: false }
        return { done: true }
    }
    return { done: false }
}

// ──────────────────────────────────────────────────────────
// 部署武将
// ──────────────────────────────────────────────────────────

export function deployGenerals(
    room: Room,
    playerId: string,
    commanderId: string,
    flankAId: string,
    flankBId: string
): { error: string } | { allDeployed: boolean } {
    const state = room.gameState
    const deployState = state.deployState!
    const pick = state.pickState!
    const player = state.players[playerId]
    if (!player) return { error: '玩家不存在' }
    const faction = player.faction!

    const pickedByFaction = faction === Faction.WARM ? pick.warmPicked : pick.coolPicked

    const ids = [commanderId, flankAId, flankBId]
    for (const id of ids) {
        if (!pickedByFaction.find((g) => g.id === id)) {
            return { error: `武将 ${id} 不在己方已选武将中` }
        }
    }
    if (new Set(ids).size !== 3) return { error: '不能重复部署同一武将' }

    // 检查是否已经部署过
    const alreadyDeployed = state.generals.some((g) => g.faction === faction)
    if (alreadyDeployed) return { error: '已经部署过了' }

    // 按照 3v3 标准座次排列武将：
    //   整体座次：冷前A(0) → 冷主(1) → 冷前B(2) → 暖前B(3) → 暖主(4) → 暖前A(5)
    // 插入顺序保证最终数组按座次排列
    const roles: Array<{ id: string; role: SeatRole }> = [
        { id: commanderId, role: SeatRole.COMMANDER },
        { id: flankAId, role: SeatRole.FLANK_A },
        { id: flankBId, role: SeatRole.FLANK_B },
    ]

    for (const { id, role } of roles) {
        const def = pickedByFaction.find((g) => g.id === id)!
        state.generals.push(createGeneralInstance(def, playerId, faction, role))
    }

    if (faction === Faction.WARM) deployState.warmDeployed = true
    else deployState.coolDeployed = true

    const allDeployed = deployState.warmDeployed && deployState.coolDeployed

    if (allDeployed) {
        // 按标准座次重新排序 generals：冷前A, 冷主, 冷前B, 暖前B, 暖主, 暖前A
        state.generals = sortGeneralsBySeat(state.generals)

        // 主帅体力上限 +1
        for (const g of state.generals) {
            if (g.seatRole === SeatRole.COMMANDER) {
                g.maxHp += 1
                g.hp += 1
            }
        }

        // 初始化牌堆，发手牌
        state.deck = shuffleDeck(createDeck())
        for (const general of state.generals) {
            general.hand = drawCards(state, 4)
        }
        state.phase = GamePhase.PLAYING
        state.turnPhase = TurnPhase.TURN_START
        state.activePlayerFaction = Faction.COOL
        state.activeGeneralIndex = -1 // 等待选择行动单元

        // 初始化第一个大回合 — 等待冷色方选择先手/让先
        state.roundState = {
            roundNumber: 0,
            firstMover: Faction.COOL,
            waitingForYield: true,
            currentActionStep: 0,
        }
    }

    return { allDeployed }
}

/**
 * 按 3v3 标准座次排列武将
 * 顺序：冷前A(0) → 冷主帅(1) → 冷前B(2) → 暖前B(3) → 暖主帅(4) → 暖前A(5)
 */
function sortGeneralsBySeat(generals: ReturnType<typeof createGeneralInstance>[]) {
    const seatOrder: Array<{ faction: Faction; role: SeatRole }> = [
        { faction: Faction.COOL, role: SeatRole.FLANK_A },
        { faction: Faction.COOL, role: SeatRole.COMMANDER },
        { faction: Faction.COOL, role: SeatRole.FLANK_B },
        { faction: Faction.WARM, role: SeatRole.FLANK_B },
        { faction: Faction.WARM, role: SeatRole.COMMANDER },
        { faction: Faction.WARM, role: SeatRole.FLANK_A },
    ]

    return seatOrder
        .map(({ faction, role }) =>
            generals.find((g) => g.faction === faction && g.seatRole === role)
        )
        .filter((g): g is NonNullable<typeof g> => g !== undefined)
}

// ──────────────────────────────────────────────────────────
// 辅助：从牌堆摸牌
// ──────────────────────────────────────────────────────────

export function drawCards(state: GameState, count: number) {
    const drawn = []
    for (let i = 0; i < count; i++) {
        if (state.deck.length === 0) {
            state.deck = [...state.discard].sort(() => Math.random() - 0.5)
            state.discard = []
        }
        if (state.deck.length > 0) {
            drawn.push(state.deck.shift()!)
        }
    }
    return drawn
}

// ──────────────────────────────────────────────────────────
// 查询接口
// ──────────────────────────────────────────────────────────

export function getRoom(roomCode: string): Room | undefined {
    return rooms.get(roomCode)
}

export function getRoomBySocketId(socketId: string): Room | undefined {
    const roomCode = socketToRoom.get(socketId)
    if (!roomCode) return undefined
    return rooms.get(roomCode)
}

/** 核心：通过 socketId 获取对应的 playerId */
export function getPlayerIdBySocketId(socketId: string): string | undefined {
    return socketToPlayer.get(socketId)
}

export function removeSocketMapping(socketId: string): void {
    socketToRoom.delete(socketId)
    socketToPlayer.delete(socketId)
}

/** 更新房间最后活动时间 */
export function touchRoom(room: Room): void {
    room.lastActivity = Date.now()
}

/** 删除房间并清理关联的 socket 映射 */
export function deleteRoom(roomCode: string): void {
    rooms.delete(roomCode)
    // 清理指向该房间的 socket 映射
    for (const [socketId, rc] of socketToRoom.entries()) {
        if (rc === roomCode) {
            socketToRoom.delete(socketId)
            socketToPlayer.delete(socketId)
        }
    }
    console.log(`[Room] Deleted room ${roomCode}`)
}

/** 清理超时房间 */
export function cleanupInactiveRooms(): number {
    const now = Date.now()
    let count = 0
    for (const [roomCode, room] of rooms.entries()) {
        if (now - room.lastActivity > ROOM_TIMEOUT_MS) {
            deleteRoom(roomCode)
            count++
        }
    }
    if (count > 0) {
        console.log(`[Cleanup] Removed ${count} inactive room(s). Active rooms: ${rooms.size}`)
    }
    return count
}

/** 启动定期清理定时器 */
export function startCleanupTimer(): void {
    setInterval(() => {
        cleanupInactiveRooms()
    }, CLEANUP_INTERVAL_MS)
    console.log(`[Cleanup] Auto-cleanup timer started (interval: ${CLEANUP_INTERVAL_MS / 60000}min, timeout: ${ROOM_TIMEOUT_MS / 3600000}h)`)
}
