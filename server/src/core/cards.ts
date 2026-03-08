import {
    Card,
    CardSuit,
    CardCategory,
    BasicCardName,
    TrickCardName,
    TrickType,
    EquipmentCardName,
    EquipSlot,
} from 'sgs3v3-shared'

// ─────────────────────────────────────────────────────────────
// 卡牌模板工厂
// ─────────────────────────────────────────────────────────────

const S = CardSuit.SPADE
const H = CardSuit.HEART
const C = CardSuit.CLUB
const D = CardSuit.DIAMOND

let _cardId = 0
function nextId(): string { return `card_${++_cardId}` }

function basic(suit: CardSuit, value: number, name: BasicCardName): Card {
    return { id: nextId(), suit, value, category: CardCategory.BASIC, name }
}

function trick(suit: CardSuit, value: number, name: TrickCardName, type: TrickType = TrickType.INSTANT): Card {
    return { id: nextId(), suit, value, category: CardCategory.TRICK, name, trickType: type }
}

function weapon(suit: CardSuit, value: number, name: EquipmentCardName, range: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name, equipSlot: EquipSlot.WEAPON, attackRange: range }
}

function armor(suit: CardSuit, value: number, name: EquipmentCardName): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name, equipSlot: EquipSlot.ARMOR }
}

function plusHorse(suit: CardSuit, value: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name: EquipmentCardName.PLUS_HORSE, equipSlot: EquipSlot.PLUS_HORSE }
}

function minusHorse(suit: CardSuit, value: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name: EquipmentCardName.MINUS_HORSE, equipSlot: EquipSlot.MINUS_HORSE }
}

// ─────────────────────────────────────────────────────────────
// 108 张卡牌（基于用户实体牌）
// ─────────────────────────────────────────────────────────────

export function createDeck(): Card[] {
    _cardId = 0
    const ATK = BasicCardName.ATTACK
    const DDG = BasicCardName.DODGE
    const PCH = BasicCardName.PEACH

    return [
        // ══════════════════ 基本牌 (53) ══════════════════

        // 杀 (30)
        // 黑桃
        basic(S, 7, ATK), basic(S, 8, ATK), basic(S, 8, ATK),
        basic(S, 9, ATK), basic(S, 9, ATK), basic(S, 10, ATK), basic(S, 10, ATK),
        // 草花
        basic(C, 2, ATK), basic(C, 3, ATK), basic(C, 4, ATK), basic(C, 5, ATK),
        basic(C, 6, ATK), basic(C, 7, ATK), basic(C, 8, ATK), basic(C, 8, ATK),
        basic(C, 9, ATK), basic(C, 9, ATK), basic(C, 10, ATK), basic(C, 10, ATK),
        basic(C, 11, ATK), basic(C, 11, ATK),
        // 红桃
        basic(H, 10, ATK), basic(H, 10, ATK), basic(H, 11, ATK),
        // 方块
        basic(D, 6, ATK), basic(D, 7, ATK), basic(D, 8, ATK),
        basic(D, 9, ATK), basic(D, 10, ATK), basic(D, 13, ATK),

        // 闪 (15)
        // 方块
        basic(D, 2, DDG), basic(D, 2, DDG), basic(D, 3, DDG), basic(D, 4, DDG),
        basic(D, 5, DDG), basic(D, 6, DDG), basic(D, 7, DDG), basic(D, 8, DDG),
        basic(D, 9, DDG), basic(D, 10, DDG), basic(D, 11, DDG), basic(D, 11, DDG),
        // 红桃
        basic(H, 2, DDG), basic(H, 2, DDG), basic(H, 13, DDG),

        // 桃 (8)
        basic(H, 3, PCH), basic(H, 4, PCH), basic(H, 6, PCH), basic(H, 7, PCH),
        basic(H, 8, PCH), basic(H, 9, PCH), basic(H, 12, PCH), basic(D, 12, PCH),

        // ══════════════════ 锦囊牌 (37) ══════════════════

        // 过河拆桥 (6)
        trick(H, 12, TrickCardName.DISMANTLE),
        trick(C, 3, TrickCardName.DISMANTLE), trick(C, 4, TrickCardName.DISMANTLE),
        trick(S, 3, TrickCardName.DISMANTLE), trick(S, 4, TrickCardName.DISMANTLE),
        trick(S, 12, TrickCardName.DISMANTLE),

        // 顺手牵羊 (5)
        trick(S, 3, TrickCardName.STEAL), trick(S, 4, TrickCardName.STEAL),
        trick(S, 11, TrickCardName.STEAL),
        trick(D, 3, TrickCardName.STEAL), trick(D, 4, TrickCardName.STEAL),

        // 无中生有 (4)
        trick(H, 7, TrickCardName.DRAW_TWO), trick(H, 8, TrickCardName.DRAW_TWO),
        trick(H, 9, TrickCardName.DRAW_TWO), trick(H, 11, TrickCardName.DRAW_TWO),

        // 无懈可击 (5)
        trick(S, 11, TrickCardName.NEGATE),
        trick(C, 12, TrickCardName.NEGATE), trick(C, 13, TrickCardName.NEGATE),
        trick(H, 12, TrickCardName.NEGATE), trick(D, 12, TrickCardName.NEGATE),

        // 南蛮入侵 (3)
        trick(S, 7, TrickCardName.BARBARIANS), trick(S, 13, TrickCardName.BARBARIANS),
        trick(C, 7, TrickCardName.BARBARIANS),

        // 决斗 (3)
        trick(D, 1, TrickCardName.DUEL), trick(S, 1, TrickCardName.DUEL),
        trick(C, 1, TrickCardName.DUEL),

        // 借刀杀人 (2)
        trick(C, 12, TrickCardName.BORROW_SWORD), trick(C, 13, TrickCardName.BORROW_SWORD),

        // 五谷丰登 (2)
        trick(H, 3, TrickCardName.HARVEST), trick(H, 4, TrickCardName.HARVEST),

        // 万箭齐发 (1)
        trick(H, 1, TrickCardName.ARROWS),

        // 桃园结义 (1)
        trick(H, 1, TrickCardName.PEACH_GARDEN),

        // 乐不思蜀 (3)
        trick(S, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(C, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(H, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),

        // 兵粮寸断 (2)
        trick(C, 12, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),
        trick(S, 1, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),

        // ══════════════════ 装备牌 (18) ══════════════════

        // 武器 (10)
        weapon(D, 1, EquipmentCardName.CROSSBOW, 1),
        weapon(C, 1, EquipmentCardName.CROSSBOW, 1),
        weapon(S, 2, EquipmentCardName.DOUBLE_SWORDS, 2),
        weapon(S, 6, EquipmentCardName.QINGGANG_SWORD, 2),
        weapon(S, 2, EquipmentCardName.ICE_SWORD, 2),
        weapon(S, 12, EquipmentCardName.ZHANGBA_SPEAR, 3),
        weapon(S, 5, EquipmentCardName.GREEN_DRAGON, 3),
        weapon(D, 5, EquipmentCardName.STONE_AXE, 3),
        weapon(D, 12, EquipmentCardName.FANGTIAN_HALBERD, 4),
        weapon(H, 5, EquipmentCardName.KYLIN_BOW, 5),

        // 防具 (2)
        armor(S, 2, EquipmentCardName.EIGHT_TRIGRAMS),
        armor(C, 2, EquipmentCardName.NIOH_SHIELD),

        // +1 马 (3)
        plusHorse(H, 13), plusHorse(C, 5), plusHorse(S, 5),

        // -1 马 (3)
        minusHorse(H, 5), minusHorse(S, 13), minusHorse(D, 13),
    ]
}

/** 洗牌（Fisher-Yates） */
export function shuffleDeck(deck: Card[]): Card[] {
    const arr = [...deck]
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}
