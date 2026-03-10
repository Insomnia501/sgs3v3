/**
 * 悬停气泡数据：武将技能 & 游戏牌描述
 */

// ── 武将技能（按 generalId 索引）──
export const GENERAL_SKILLS: Record<string, { name: string; skills: { name: string; description: string }[] }> = {
    // 魏
    caocao:       { name: '曹操', skills: [{ name: '奸雄', description: '你受到伤害后，可获得造成此伤害的牌。' }] },
    simayi:       { name: '司马懿', skills: [{ name: '反馈', description: '你受到1点伤害后，可获得伤害来源的一张牌。' }, { name: '鬼才', description: '一名角色的判定牌生效前，你可打出一张手牌代替之。' }] },
    zhangliao:    { name: '张辽', skills: [{ name: '突袭', description: '摸牌阶段，你可改为获得至多两名角色的各一张手牌。' }] },
    guojia:       { name: '郭嘉', skills: [{ name: '天妒', description: '你的判定牌生效后，你可获得此牌。' }, { name: '遗计', description: '你受到1点伤害后，可观看牌堆顶两张牌，分别交给任意角色。' }] },
    zhenji:       { name: '甄姬', skills: [{ name: '洛神', description: '准备阶段，你可判定，若为黑色则获得此牌，可继续判定。' }, { name: '倾国', description: '你可将黑色手牌当【闪】使用或打出。' }] },
    xiahoyuan:    { name: '夏侯渊', skills: [{ name: '神速', description: '可选一至两项：①跳过判定和摸牌阶段；②跳过出牌阶段弃一张装备牌。每选一项视为对一名角色使用一张无距离限制的【杀】。' }] },
    xuhuang:      { name: '徐晃', skills: [{ name: '断粮', description: '你可将一张黑色基本牌或装备牌当【兵粮寸断】使用；可对距离2以内角色使用。' }] },
    xiahoudun:    { name: '夏侯惇', skills: [{ name: '刚烈', description: '你受到1点伤害后，可判定：非红桃则伤害来源须弃两张手牌或受1点伤害。' }] },
    wenpin:       { name: '文聘', skills: [{ name: '镇卫', description: '锁定技，对方角色计算与其他己方角色的距离时，始终+1。' }] },
    // 蜀
    liubei:       { name: '刘备', skills: [{ name: '仁德', description: '出牌阶段，你可将任意张手牌给予其他角色。每给出第2张时回复1点体力。' }] },
    guanyu:       { name: '关羽', skills: [{ name: '武圣', description: '你可将红色牌当【杀】使用或打出。' }, { name: '忠义', description: '限定技，出牌阶段置红牌至本轮结束，己方角色杀+1伤。' }] },
    zhangfei:     { name: '张飞', skills: [{ name: '咆哮', description: '锁定技，你使用【杀】无次数限制。' }] },
    zhugeliang:   { name: '诸葛亮', skills: [{ name: '观星', description: '准备阶段，观看牌堆顶X张牌（最多5），任意顺序置于牌堆顶或底。' }, { name: '空城', description: '锁定技，若你没有手牌，不能成为【杀】或【决斗】的目标。' }] },
    zhaoyun:      { name: '赵云', skills: [{ name: '龙胆', description: '你可将杀当闪、闪当杀使用或打出。' }, { name: '救主', description: '己方其他角色濒死时，若你体力>1，可失去1体力弃1牌令其回1血。' }] },
    machao:       { name: '马超', skills: [{ name: '马术', description: '锁定技，你计算与其他角色的距离-1。' }, { name: '铁骑', description: '你使用杀指定目标后，可判定：红色则目标不能使用闪。' }] },
    huangyueying: { name: '黄月英', skills: [{ name: '集智', description: '你使用一张非延时锦囊牌时，可摸一张牌。' }, { name: '奇才', description: '锁定技，你使用锦囊牌无距离限制。' }] },
    jiangwei:     { name: '姜维', skills: [{ name: '挑衅', description: '出牌阶段限一次，指定攻击范围内的角色，须对你出杀否则你弃其一牌。' }, { name: '志继', description: '觉醒技，准备阶段若无手牌，回1血或摸2牌，减1上限获得观星。' }] },
    // 吴
    sunquan:      { name: '孙权', skills: [{ name: '制衡', description: '出牌阶段限一次，弃置任意张手牌，摸等量的牌。' }] },
    ganning:      { name: '甘宁', skills: [{ name: '奇袭', description: '你可将一张黑色牌当【过河拆桥】使用。' }] },
    huanggai:     { name: '黄盖', skills: [{ name: '苦肉', description: '出牌阶段，你可失去1点体力，摸两张牌。' }] },
    zhouyu:       { name: '周瑜', skills: [{ name: '英姿', description: '锁定技，摸牌阶段你多摸一张牌。' }, { name: '反间', description: '出牌阶段限一次，令一名角色选花色→获你一牌→不同受1伤。' }] },
    daqiao:       { name: '大乔', skills: [{ name: '国色', description: '你可将一张方块牌当【乐不思蜀】使用。' }, { name: '流离', description: '你成为杀的目标时，可弃一牌将此杀转移给攻击范围内的另一名角色。' }] },
    sunshangxiang:{ name: '孙尚香', skills: [{ name: '结姻', description: '出牌阶段限一次，弃2牌选一名已受伤男性，各回1血。' }, { name: '枭姬', description: '当你失去装备区里的一张牌时，可摸两张牌。' }] },
    sunjian:      { name: '孙坚', skills: [{ name: '英魂', description: '准备阶段，若你已受伤，可令一名其他角色：摸X弃1或摸1弃X（X为已损失体力）。' }] },
    xiaoqiao:     { name: '小乔', skills: [{ name: '天香', description: '受到伤害时，可弃红桃牌将伤害转移给另一角色，其摸X牌（X为已损失体力）。' }, { name: '红颜', description: '锁定技，你的黑桃牌视为红桃牌。' }] },
    sunce:        { name: '孙策', skills: [{ name: '激昂', description: '当你使用或成为决斗/红杀的目标后，可摸一张牌。' }, { name: '魂姿', description: '觉醒技，准备阶段若体力为1，减1上限获得英姿和英魂。' }] },
    zhugejin:     { name: '诸葛瑾', skills: [{ name: '明哲', description: '回合外，使用/打出/弃置红色牌时可摸一张牌。' }, { name: '缓释', description: '己方角色的判定牌生效前，可打出一张牌代替之。' }, { name: '弘援', description: '准备阶段可少摸一张牌，令至多两名己方角色各摸一张牌。' }] },
    // 群
    huatuo:       { name: '华佗', skills: [{ name: '急救', description: '回合外，你可将一张红色牌当桃使用。' }, { name: '青囊', description: '出牌阶段限一次，弃1牌令一名角色回1血。' }] },
    lvbu:         { name: '吕布', skills: [{ name: '无双', description: '锁定技，杀需2闪抵消，决斗对方每次需出2杀。' }] },
    diaochan:     { name: '貂蝉', skills: [{ name: '离间', description: '出牌阶段限一次，弃1牌令两名男性角色决斗。' }, { name: '闭月', description: '结束阶段，你可摸一张牌。' }] },
    pangde:       { name: '庞德', skills: [{ name: '马术', description: '锁定技，你计算与其他角色的距离-1。' }, { name: '猛进', description: '你的杀被闪抵消时，可弃置目标一张牌。' }] },
    jiaxu:        { name: '贾诩', skills: [{ name: '完杀', description: '锁定技，你的回合内非濒死角色不能用桃。' }, { name: '乱武', description: '限定技，所有其他角色出杀或失1血。' }, { name: '帷幕', description: '锁定技，你不能成为黑色锦囊牌的目标。' }] },
}

// ── 游戏牌描述（不含杀、闪、桃）──
export const CARD_TOOLTIP: Record<string, { name: string; desc: string }> = {
    // 非延时锦囊
    draw_two:      { name: '无中生有', desc: '出牌阶段对自己使用，摸两张牌。' },
    dismantle:     { name: '过河拆桥', desc: '出牌阶段对一名其他角色使用，弃置该角色的一张牌（手牌或装备区）。' },
    steal:         { name: '顺手牵羊', desc: '出牌阶段对距离1以内的一名其他角色使用，获得该角色的一张牌。' },
    duel:          { name: '决斗', desc: '出牌阶段对一名其他角色使用，双方轮流打出【杀】，先不出者受到1点伤害。由目标先出。' },
    borrow_sword:  { name: '借刀杀人', desc: '对一名装备武器的其他角色使用，令其对你指定的另一名角色使用【杀】，否则将武器交给你。' },
    negate:        { name: '无懈可击', desc: '在一张锦囊牌对目标生效前使用，抵消该锦囊的效果。也可用于反制另一张无懈可击。' },
    barbarians:    { name: '南蛮入侵', desc: '对所有其他角色使用。每名目标须打出一张【杀】，否则受到1点伤害。' },
    arrows:        { name: '万箭齐发', desc: '对所有其他角色使用。每名目标须打出一张【闪】，否则受到1点伤害。' },
    peach_garden:  { name: '桃园结义', desc: '所有已受伤的角色各回复1点体力。' },
    harvest:       { name: '五谷丰登', desc: '翻开牌堆顶等量的牌，所有角色依次选择其中一张加入手牌。' },
    // 延时锦囊
    overindulgence:  { name: '乐不思蜀', desc: '对一名其他角色使用。该角色判定阶段判定，非♥则跳过出牌阶段。' },
    supply_shortage: { name: '兵粮寸断', desc: '对距离1以内的一名其他角色使用。该角色判定阶段判定，♣则跳过摸牌阶段。' },
    // 武器
    crossbow:         { name: '诸葛连弩', desc: '攻击范围1。出牌阶段使用【杀】无次数限制。' },
    double_swords:    { name: '雌雄双股剑', desc: '攻击范围2。对异性角色使用【杀】时，目标须弃一张手牌或让你摸一张牌。' },
    qinggang_sword:   { name: '青釭剑', desc: '攻击范围2。你使用【杀】时，无视目标的防具。' },
    ice_sword:        { name: '寒冰剑', desc: '攻击范围2。使用【杀】命中目标时，可不造成伤害，改为弃置目标两张牌。' },
    zhangba_spear:    { name: '丈八蛇矛', desc: '攻击范围3。你可将两张手牌当【杀】使用或打出。' },
    green_dragon:     { name: '青龙偃月刀', desc: '攻击范围3。【杀】被闪抵消时，可继续对其使用【杀】直至命中或放弃。' },
    stone_axe:        { name: '贯石斧', desc: '攻击范围3。【杀】被闪抵消时，可弃两张牌使此【杀】强制命中。' },
    fangtian_halberd: { name: '方天画戟', desc: '攻击范围4。使用最后一张手牌作为【杀】时，可额外指定至多两个目标。' },
    kylin_bow:        { name: '麒麟弓', desc: '攻击范围5。使用【杀】命中目标时，可弃置目标装备区的一匹马。' },
    // 防具
    eight_trigrams: { name: '八卦阵', desc: '需要使用【闪】时，可判定：红色则视为使用了一张【闪】。' },
    nioh_shield:    { name: '仁王盾', desc: '锁定技，黑色的【杀】对你无效。' },
    // 坐骑
    plus_horse:  { name: '+1马（防御马）', desc: '其他角色计算与你的距离+1。' },
    minus_horse: { name: '-1马（进攻马）', desc: '你计算与其他角色的距离-1。' },
}

// ── 不显示气泡的基本牌 ──
export const NO_TOOLTIP_CARDS = new Set(['attack', 'dodge', 'peach'])
