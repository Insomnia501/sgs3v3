import {
    GeneralDefinition,
    SkillType,
    SkillTrigger,
} from 'sgs3v3-shared'

/**
 * 武将数据库 — 32 个武将（统率三军 3v3）
 */
const GENERALS: GeneralDefinition[] = [
    // ══════════════════════════════════════════
    // 魏国 (9)
    // ══════════════════════════════════════════
    {
        id: 'caocao', name: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'caocao_jianxiong', name: '奸雄',
            description: '你受到伤害后，可获得造成此伤害的牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },
    {
        id: 'simayi', name: '司马懿', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'simayi_fankui', name: '反馈',
                description: '你受到1点伤害后，可获得伤害来源的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'simayi_guicai', name: '鬼才',
                description: '一名角色的判定牌生效前，你可打出一张手牌代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },
    {
        id: 'zhangliao', name: '张辽', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'zhangliao_tuxi', name: '突袭',
            description: '摸牌阶段，你可改为获得至多两名角色的各一张手牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },
    {
        id: 'guojia', name: '郭嘉', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guojia_tiandu', name: '天妒',
                description: '你的判定牌生效后，你可获得此牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'guojia_yiji', name: '遗计',
                description: '你受到1点伤害后，可观看牌堆顶两张牌，分别交给任意角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'zhenji', name: '甄姬', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'zhenji_luoshen', name: '洛神',
                description: '准备阶段，你可判定，若为黑色则获得此牌，可继续判定。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhenji_qingguo', name: '倾国',
                description: '你可将黑色手牌当【闪】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'xiahoyuan', name: '夏侯渊', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xiahoyuan_shensu', name: '神速',
            description: '可选一至两项：①跳过判定和摸牌阶段；②跳过出牌阶段弃一张装备牌。每选一项视为对一名角色使用一张无距离限制的【杀】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },
    {
        id: 'xuhuang', name: '徐晃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xuhuang_duanliang', name: '断粮',
            description: '你可将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用；可对距离2以内角色使用【兵粮寸断】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
    {
        id: 'xiahoudun', name: '夏侯惇', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xiahoudun_ganglie', name: '刚烈',
            description: '你受到1点伤害后，可判定：非红桃则伤害来源须弃两张手牌或受1点伤害。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },
    {
        id: 'wenpin', name: '文聘', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'wenpin_zhenwei', name: '镇卫',
            description: '锁定技，对方角色计算与其他己方角色的距离时，始终+1。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    // ══════════════════════════════════════════
    // 蜀国 (8)
    // ══════════════════════════════════════════
    {
        id: 'liubei', name: '刘备', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liubei_rende', name: '仁德',
            description: '出牌阶段，你可将任意张手牌给予其他角色。每通过此技能给出第2张牌时，回复1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'guanyu', name: '关羽', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'guanyu_wusheng', name: '武圣',
                description: '你可将红色牌当【杀】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'guanyu_zhongyi', name: '忠义',
                description: '限定技，出牌阶段，你可将一张红色手牌置于武将牌上至本轮结束。期间己方角色使用【杀】造成的伤害+1。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhangfei', name: '张飞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhangfei_paoxiao', name: '咆哮',
            description: '锁定技，你使用【杀】无次数限制。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
    {
        id: 'zhugeliang', name: '诸葛亮', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhugeliang_guanxing', name: '观星',
                description: '准备阶段，观看牌堆顶X张牌（X为存活角色数，最多5），以任意顺序置于牌堆顶或底。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhugeliang_kongcheng', name: '空城',
                description: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'zhaoyun', name: '赵云', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhaoyun_longdan', name: '龙胆',
                description: '你可将【杀】当【闪】使用或打出，也可将【闪】当【杀】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhaoyun_jiuzhu', name: '救主',
                description: '己方其他角色濒死时，若你体力>1，你可失去1点体力并弃一张牌，令其回复1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
        ],
    },
    {
        id: 'machao', name: '马超', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'machao_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'machao_tieqi', name: '铁骑',
                description: '你使用【杀】指定目标后，可判定：红色则目标不能使用【闪】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'huangyueying', name: '黄月英', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'huangyueying_jizhi', name: '集智',
                description: '你使用一张普通锦囊牌时，可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'huangyueying_qicai', name: '奇才',
                description: '锁定技，你使用锦囊牌无距离限制。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'jiangwei', name: '姜维', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jiangwei_tiaoxin', name: '挑衅',
                description: '出牌阶段限一次，指定一名你在其攻击范围内的角色，该角色须对你使用一张【杀】，否则你弃其一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiangwei_zhiji', name: '志继',
                description: '觉醒技，准备阶段，若你没有手牌，你须回复1点体力或摸两张牌，然后减1点体力上限，获得技能"观星"。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 吴国 (10)
    // ══════════════════════════════════════════
    {
        id: 'sunquan', name: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunquan_zhiheng', name: '制衡',
            description: '出牌阶段限一次，你可弃置任意张牌，然后摸等量的牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'ganning', name: '甘宁', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'ganning_qixi', name: '奇袭',
            description: '你可将一张黑色牌当【过河拆桥】使用。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
    {
        id: 'huanggai', name: '黄盖', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'huanggai_kurou', name: '苦肉',
            description: '出牌阶段，你可失去1点体力，然后摸两张牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'zhouyu', name: '周瑜', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhouyu_yingzi', name: '英姿',
                description: '锁定技，摸牌阶段你多摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'zhouyu_fanjian', name: '反间',
                description: '出牌阶段限一次，令一名其他角色选择一种花色，然后该角色获得你的一张手牌并展示之，若花色不同则你对其造成1点伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'daqiao', name: '大乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'daqiao_guose', name: '国色',
                description: '你可将一张方块牌当【乐不思蜀】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'daqiao_liuli', name: '流离',
                description: '你成为【杀】的目标时，可弃置一张牌，将此【杀】转移给你攻击范围内的另一名角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'sunshangxiang', name: '孙尚香', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'sunshangxiang_jieyin', name: '结姻',
                description: '出牌阶段限一次，你可弃置两张手牌并选择一名已受伤的男性角色，你与其各回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunshangxiang_xiaoji', name: '枭姬',
                description: '当你失去装备区里的一张牌时，你可摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
            },
        ],
    },
    {
        id: 'sunjian', name: '孙坚', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunjian_yinghun', name: '英魂',
            description: '准备阶段，若你已受伤，可令一名其他角色：摸X张牌然后弃一张牌；或摸一张牌然后弃X张牌（X为你已损失的体力值）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },
    {
        id: 'xiaoqiao', name: '小乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'xiaoqiao_tianxiang', name: '天香',
                description: '你受到伤害时，可弃置一张红桃手牌，将此伤害转移给另一名角色，然后该角色摸X张牌（X为其已损失的体力值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'xiaoqiao_hongyan', name: '红颜',
                description: '锁定技，你的黑桃牌视为红桃牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'sunce', name: '孙策', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunce_jiang', name: '激昂',
                description: '当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'sunce_hunzi', name: '魂姿',
                description: '觉醒技，准备阶段，若你的体力值为1，你减1点体力上限，然后获得技能"英姿"和"英魂"。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'zhugejin', name: '诸葛瑾', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhugejin_mingzhe', name: '明哲',
                description: '你的回合外，当你使用、打出或弃置一张红色牌时，你可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhugejin_huanshi', name: '缓释',
                description: '己方角色的判定牌生效前，你可打出一张牌代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'zhugejin_hongyuan', name: '弘援',
                description: '摸牌阶段，你可少摸一张牌，令至多两名其他己方角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 群雄 (5)
    // ══════════════════════════════════════════
    {
        id: 'huatuo', name: '华佗', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huatuo_jijiu', name: '急救',
                description: '你的回合外，你可将一张红色牌当【桃】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'huatuo_qingnang', name: '青囊',
                description: '出牌阶段限一次，你可弃置一张手牌，令一名角色回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'lvbu', name: '吕布', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'lvbu_wushuang', name: '无双',
            description: '锁定技，你使用【杀】时目标需打出两张【闪】才能抵消；你使用/成为【决斗】目标时，对方每次需打出两张【杀】。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
    {
        id: 'diaochan', name: '貂蝉', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'diaochan_lijian', name: '离间',
                description: '出牌阶段限一次，你可弃置一张牌，令两名男性角色进行决斗。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'diaochan_biyue', name: '闭月',
                description: '结束阶段，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'pangde', name: '庞德', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'pangde_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangde_mengjin', name: '猛进',
                description: '当你使用的【杀】被目标的【闪】抵消时，你可弃置其一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'jiaxu', name: '贾诩', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jiaxu_wansha', name: '完杀',
                description: '锁定技，你的回合内，不处于濒死状态的其他角色不能使用【桃】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'jiaxu_luanwu', name: '乱武',
                description: '限定技，出牌阶段，你可令所有其他角色依次选择：对距离最近的另一名角色使用一张【杀】，或失去1点体力。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiaxu_weimu', name: '帷幕',
                description: '锁定技，你不能被选择为黑色锦囊牌的目标。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
]

/** 获取所有可选武将 */
export function getGeneralPool(): GeneralDefinition[] {
    return GENERALS
}

/** 按 ID 获取武将定义 */
export function getGeneralById(id: string): GeneralDefinition | undefined {
    return GENERALS.find((g) => g.id === id)
}
