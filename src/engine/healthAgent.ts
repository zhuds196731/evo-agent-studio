/**
 * 中医养生智能体 · 时辰经络 / 节气保健 / 用眼饮水久坐关怀
 *
 * 理论依据：
 * - 子午流注：十二时辰气血流注于十二经脉，某经当令时其脏腑功能最旺，宜顺时养护。
 * - 《素问·四气调神大论》：春夏养阳、秋冬养阴，起居与情志随四时生长收藏而调。
 * - 《素问·宣明五气》：久视伤血、久卧伤气、久坐伤肉、久立伤骨、久行伤筋。
 */

import type { HealthSettings } from '../types';

export interface MeridianHour {
  key: string;
  name: string;
  range: string;
  /** 该时辰起始小时（0-23） */
  startHour: number;
  meridian: string;
  organ: string;
  /** 一句话总纲 */
  summary: string;
  /** 宜（2-3 条） */
  advice: string[];
  /** 忌 */
  caution: string;
}

/** 十二时辰经络流注（子午流注） */
export const MERIDIAN_HOURS: MeridianHour[] = [
  {
    key: 'zi',
    name: '子时',
    range: '23:00–01:00',
    startHour: 23,
    meridian: '足少阳胆经',
    organ: '胆',
    summary: '胆经当令，一阳初生，宜熟睡以养胆气。',
    advice: ['务必入睡，此时不睡最伤胆气与少阳生发之机', '睡前放下手机，避免思虑扰动相火', '若熬夜，次日午时小憩可稍作弥补'],
    caution: '忌熬夜、宵夜、剧烈运动；子时不睡，日间易胆怯、决断力差。',
  },
  {
    key: 'chou',
    name: '丑时',
    range: '01:00–03:00',
    startHour: 1,
    meridian: '足厥阴肝经',
    organ: '肝',
    summary: '肝经当令，肝藏血而解毒，宜深度睡眠。',
    advice: ['保持深睡，肝血得归、目得所养', '睡眠环境宜暗，光线抑制褪黑素会扰肝', '右侧卧可减轻心脏压迫，利于肝血回流'],
    caution: '忌饮酒、情绪激动；长期丑时醒多为肝火或肝血不足，宜早调。',
  },
  {
    key: 'yin',
    name: '寅时',
    range: '03:00–05:00',
    startHour: 3,
    meridian: '手太阴肺经',
    organ: '肺',
    summary: '肺经当令，肺朝百脉，宜沉睡保暖。',
    advice: ['继续深睡，气血由肺输布全身', '注意肩颈与胸口保暖，勿受风寒', '老年人此际最易发生意外，起床宜缓'],
    caution: '忌早起贪凉、空腹外出；此时咳嗽加重者多为肺气不降。',
  },
  {
    key: 'mao',
    name: '卯时',
    range: '05:00–07:00',
    startHour: 5,
    meridian: '手阳明大肠经',
    organ: '大肠',
    summary: '大肠经当令，宜起床、饮温水、排便。',
    advice: ['空腹饮一杯温水，润肠通便', '养成定时排便习惯，勿久忍', '可轻揉腹部（顺时针）助大肠传导'],
    caution: '忌起床过猛、忌冰饮直灌；便秘者忌久蹲用力。',
  },
  {
    key: 'chen',
    name: '辰时',
    range: '07:00–09:00',
    startHour: 7,
    meridian: '足阳明胃经',
    organ: '胃',
    summary: '胃经当令，气血最盛，宜好好吃早餐。',
    advice: ['早餐要吃且宜温热，如粥、面、蛋、山药', '细嚼慢咽，七分饱', '饭后勤漱口、叩齿吞津以护胃气'],
    caution: '忌生冷、油腻、空腹咖啡；长期不吃早餐最伤胃气。',
  },
  {
    key: 'si',
    name: '巳时',
    range: '09:00–11:00',
    startHour: 9,
    meridian: '足太阴脾经',
    organ: '脾',
    summary: '脾经当令，运化最旺，是脑力工作的黄金时段。',
    advice: ['安排需要专注与思考的工作', '久坐 50 分钟起身活动，脾主肌肉，久坐伤肉', '上午加餐可选红枣、山药、坚果'],
    caution: '忌思虑过度（思伤脾）、忌甜腻碍脾、忌久坐不动。',
  },
  {
    key: 'wu',
    name: '午时',
    range: '11:00–13:00',
    startHour: 11,
    meridian: '手少阴心经',
    organ: '心',
    summary: '心经当令，一阴初生，宜小憩养心。',
    advice: ['午餐宜清淡，勿过饱', '午睡 20–30 分钟，养心安神', '闭目养神或按揉内关穴亦有助'],
    caution: '忌午饭后立即剧烈运动、忌大喜大怒、忌午睡过久（超 1 小时反致昏沉）。',
  },
  {
    key: 'wei',
    name: '未时',
    range: '13:00–15:00',
    startHour: 13,
    meridian: '手太阳小肠经',
    organ: '小肠',
    summary: '小肠经当令，分清泌浊，宜补水助代谢。',
    advice: ['分次小口饮温水，助营养输布与废物下行', '适合整理、沟通、处理事务性工作', '可轻揉后溪穴缓解颈肩僵硬'],
    caution: '忌牛饮、忌冰镇饮料伤小肠阳气。',
  },
  {
    key: 'shen',
    name: '申时',
    range: '15:00–17:00',
    startHour: 15,
    meridian: '足太阳膀胱经',
    organ: '膀胱',
    summary: '膀胱经当令，排毒黄金期，宜多饮水与适度运动。',
    advice: ['补足水分，促进代谢废物排出', '最适合运动锻炼，膀胱经循行腰背，宜拉伸舒展', '学习记忆效率亦高，可安排复盘'],
    caution: '忌憋尿；憋尿伤膀胱气化，久则可致湿热下注。',
  },
  {
    key: 'you',
    name: '酉时',
    range: '17:00–19:00',
    startHour: 17,
    meridian: '足少阴肾经',
    organ: '肾',
    summary: '肾经当令，肾藏精，宜收摄、宜静养。',
    advice: ['晚餐宜少、宜早、宜淡', '可散步、太极、八段锦等缓和运动', '宜搓腰揉耳（肾开窍于耳）以固肾'],
    caution: '忌房劳、过劳与高强度运动；此时剧烈出汗易耗肾精。',
  },
  {
    key: 'xu',
    name: '戌时',
    range: '19:00–21:00',
    startHour: 19,
    meridian: '手厥阴心包经',
    organ: '心包',
    summary: '心包经当令，护心安神，宜愉悦放松。',
    advice: ['与家人交流、听舒缓音乐，保持心境平和', '散步 15–20 分钟，助气血调和', '可按揉内关、劳宫穴宁心安神'],
    caution: '忌大怒、忌剧烈运动、忌过度用脑；此时情绪波动最易伤心。',
  },
  {
    key: 'hai',
    name: '亥时',
    range: '21:00–23:00',
    startHour: 21,
    meridian: '手少阳三焦经',
    organ: '三焦',
    summary: '三焦经当令，百脉通调，宜泡脚安眠。',
    advice: ['温水泡脚 15 分钟，引火归元、助眠', '调暗灯光，停止高强度脑力活动', '可梳理三焦经：沿手臂外侧中线轻拍'],
    caution: '忌熬夜、忌剧烈情绪起伏；亥时不收，百脉失养。',
  },
];

/** 按小时取当前时辰 */
export function meridianHourOf(date: Date = new Date()): MeridianHour {
  const hour = date.getHours();
  return (
    MERIDIAN_HOURS.find((item) => hour >= item.startHour && hour < item.startHour + 2) ??
    MERIDIAN_HOURS[0]
  );
}

/** 距离下一时辰切换还有多少分钟 */
export function minutesToNextHour(date: Date = new Date()): number {
  const hour = date.getHours();
  // 时辰每 2 小时一换，交界在奇数小时（23、1、3 … 21），下一个交界是紧随其后的奇数小时
  const nextBoundary = hour % 2 === 1 ? hour + 2 : hour + 1;
  const target = new Date(date);
  target.setHours(nextBoundary, 0, 0, 0);
  return Math.max(0, Math.round((target.getTime() - date.getTime()) / 60000));
}

export interface SolarTerm {
  key: string;
  name: string;
  season: '春' | '夏' | '秋' | '冬';
  summary: string;
  living: string;
  dietGood: string[];
  dietBad: string[];
  recipe: string;
  acupoint: string;
}

/**
 * 二十四节气保健要点。
 * 每个节气给出：总纲、起居情志、宜食、忌食、一款应季食疗、一组保健穴位。
 */
export const SOLAR_TERMS: SolarTerm[] = [
  {
    key: 'lichun', name: '立春', season: '春',
    summary: '阳气初生，宜顺应春生之气，助阳气升发。',
    living: '早睡早起，广步于庭，披发缓行以使志生；勿急减衣，春捂秋冻。',
    dietGood: ['辛甘发散之品：韭菜、豆芽、香菜、葱姜', '芽类蔬菜助生发', '红枣、山药健脾'],
    dietBad: ['酸涩收敛之物（过食酸不利阳气升发）', '生冷、油腻'],
    recipe: '韭菜炒鸡蛋或豆芽拌春韭，佐以姜丝温中助阳。',
    acupoint: '太冲（疏肝）、风池（防风）：各按揉 2 分钟。',
  },
  {
    key: 'yushui', name: '雨水', season: '春',
    summary: '降水渐多，湿气渐重，风邪夹湿，宜健脾祛湿。',
    living: '仍宜春捂，重点护好背、腹、足；居室适度通风除湿。',
    dietGood: ['健脾祛湿：薏米、赤小豆、茯苓、山药', '蜂蜜、大枣润燥', '早春养脾粥'],
    dietBad: ['生冷、黏腻、过甜', '冰冻饮品'],
    recipe: '薏米赤小豆茯苓粥，健脾渗湿而不伤正。',
    acupoint: '足三里（健脾）、阴陵泉（利湿）。',
  },
  {
    key: 'jingzhe', name: '惊蛰', season: '春',
    summary: '春雷始鸣，阳气升腾，肝阳易亢，宜顺肝之性、戒怒。',
    living: '保证睡眠，避免熬夜动火；情绪宜舒畅，忌抑郁与暴怒。',
    dietGood: ['清淡疏肝：菠菜、芹菜、荠菜、枸杞叶', '梨润肺生津', '菊花枸杞清肝明目'],
    dietBad: ['辛辣动火、油炸、烈酒', '过补温燥之品'],
    recipe: '芹菜百合炒木耳，佐菊花枸杞茶清肝润燥。',
    acupoint: '太冲、行间（平肝）、风池（疏风）。',
  },
  {
    key: 'chunfen', name: '春分', season: '春',
    summary: '昼夜均而寒暑平，宜调和阴阳，饮食寒热适中。',
    living: '作息规律，适度户外活动；注意天气乍暖还寒，增减衣物有度。',
    dietGood: ['寒热均衡，五味调和', '春笋、香椿、豆苗等时令蔬', '山药扁豆粥健脾'],
    dietBad: ['过寒过热偏嗜', '大补大泻之品'],
    recipe: '香椿拌豆腐，清鲜助阳而不燥。',
    acupoint: '合谷、太冲（合称四关，调气机）。',
  },
  {
    key: 'qingming', name: '清明', season: '春',
    summary: '清气上升，宜养肝清肝，舒畅情志。',
    living: '踏青散步以舒肝气；扫墓祭祖时情绪波动大，宜自我调适。',
    dietGood: ['柔肝养肝：枸杞、桑葚、菠菜、荠菜', '菊花茶清头目', '青团宜少食，糯米黏滞难化'],
    dietBad: ['发物（笋、鹅、海鲜）易动风者慎', '辛辣助火'],
    recipe: '荠菜豆腐羹，清肝和中。',
    acupoint: '肝俞、太溪（滋水涵木）。',
  },
  {
    key: 'guyu', name: '谷雨', season: '春',
    summary: '雨生百谷，湿气最重，脾最易困，宜健脾化湿。',
    living: '避免久居潮湿；运动微汗即可，勿大汗伤阳。',
    dietGood: ['健脾利湿：薏米、白扁豆、山药、陈皮', '鲤鱼、鲫鱼利水', '绿茶清利头目'],
    dietBad: ['生冷瓜果、甜腻', '过量饮酒助湿'],
    recipe: '陈皮白术鲫鱼汤，健脾行气化湿。',
    acupoint: '脾俞、中脘、丰隆（化痰湿要穴）。',
  },
  {
    key: 'lixia', name: '立夏', season: '夏',
    summary: '阳气渐长，心气当令，宜养心安神，勿贪凉。',
    living: '晚睡早起（不超 23 点），午间小憩；勿贪凉直吹空调。',
    dietGood: ['养心清心：莲子、百合、小麦、红枣', '赤小豆利水', '苦味清心（苦瓜、莲子心少量）'],
    dietBad: ['冰镇饮品直伤脾阳', '过辣动火'],
    recipe: '莲子百合银耳羹，养心安神润燥。',
    acupoint: '内关、神门（安神定志）。',
  },
  {
    key: 'xiaoman', name: '小满', season: '夏',
    summary: '暑湿渐盛，宜清热利湿，顾护脾胃。',
    living: '衣物透气，勤换洗；保持皮肤清洁，防湿疹痱子。',
    dietGood: ['清热利湿：冬瓜、丝瓜、黄瓜、绿豆', '薏米赤小豆汤', '荷叶茶升清'],
    dietBad: ['肥甘厚味、烧烤', '过量冰饮'],
    recipe: '冬瓜薏米排骨汤，清补不腻。',
    acupoint: '曲池（清热）、阴陵泉（利湿）。',
  },
  {
    key: 'mangzhong', name: '芒种', season: '夏',
    summary: '雨量充沛、湿热交蒸，宜清补、安神、防暑湿。',
    living: '保证午睡；出汗后及时擦干换衣，勿当风而卧。',
    dietGood: ['清淡易消化：绿豆、赤小豆、黄瓜、番茄', '青梅生津', '酸味敛汗生津'],
    dietBad: ['过咸伤肾', '辛辣、油腻'],
    recipe: '绿豆百合粥，清暑益气生津。',
    acupoint: '少府（清心火）、足三里（健脾胃）。',
  },
  {
    key: 'xiazhi', name: '夏至', season: '夏',
    summary: '阳极之至，一阴始生，宜护阳又勿伤阴，切忌贪凉。',
    living: '晚睡早起加午休；不可夜卧贪凉、不可冷水冲澡过度。',
    dietGood: ['清暑益气：西瓜（适量）、绿豆汤、乌梅汤', '生姜温中（夏月伏阴在内）', '苦瓜清心'],
    dietBad: ['大量冰饮、冰西瓜', '空腹饮冰'],
    recipe: '乌梅山楂桂花饮，生津止渴开胃。',
    acupoint: '百会（升阳）、涌泉（引火归元）。',
  },
  {
    key: 'xiaoshu', name: '小暑', season: '夏',
    summary: '温风至，暑气渐盛，宜清心防暑、健脾化湿。',
    living: '避免 11–15 点高温外出；补水少量多次，勿等口渴。',
    dietGood: ['绿豆、莲子、藕、丝瓜', '淡盐水或淡茶补充电解质', '黄鳝（小暑黄鳝赛人参）温补'],
    dietBad: ['过冷伤阳', '暴饮暴食'],
    recipe: '莲藕绿豆排骨汤，清暑健脾。',
    acupoint: '大椎（散暑热）、中脘（和胃）。',
  },
  {
    key: 'dashu', name: '大暑', season: '夏',
    summary: '湿热交蒸至极，宜清暑化湿、顾护阳气，冬病夏治正当时。',
    living: '防中暑，室内外温差勿过大；三伏天可做穴位敷贴（冬病夏治）。',
    dietGood: ['清热解暑：绿豆、冬瓜、苦瓜、荷叶', '益气养阴：西洋参、麦冬（适量）', '温阳：伏天可适度温补'],
    dietBad: ['烈日下饮冰', '大汗后冲冷水澡'],
    recipe: '荷叶冬瓜汤加陈皮，清暑化湿醒脾。',
    acupoint: '肺俞、膏肓（三伏贴常用）、足三里。',
  },
  {
    key: 'liqiu', name: '立秋', season: '秋',
    summary: '暑气渐收，燥气始起，宜润燥养肺，少辛增酸。',
    living: '早卧早起，收敛神气；秋冻有度，勿骤添厚衣。',
    dietGood: ['润燥：梨、银耳、百合、蜂蜜、芝麻', '酸味收敛：葡萄、山楂', '莲藕、山药健脾'],
    dietBad: ['辛辣发散（葱姜蒜过量）', '油炸烧烤'],
    recipe: '百合银耳雪梨羹，润肺生津。',
    acupoint: '太渊（补肺）、列缺（利咽）。',
  },
  {
    key: 'chushu', name: '处暑', season: '秋',
    summary: '暑气止而燥气生，宜滋阴润燥、健脾和胃。',
    living: '睡眠充足以养阴；早晚凉爽时宜户外锻炼。',
    dietGood: ['滋阴润燥：银耳、百合、梨、蜂蜜', '健脾：山药、莲子、芡实', '老鸭滋阴'],
    dietBad: ['辛辣燥热', '生冷伤脾'],
    recipe: '山药莲子老鸭汤，滋阴润燥健脾。',
    acupoint: '肺俞、足三里。',
  },
  {
    key: 'bailu', name: '白露', season: '秋',
    summary: '阴气渐重，露凝而白，燥邪当令，宜养阴润肺、注意保暖。',
    living: '早晚添衣，勿露腰腹与足踝；室内可用加湿器缓解秋燥。',
    dietGood: ['润肺生津：梨、百合、银耳、蜂蜜、杏仁', '温润：米酒、桂圆（少量）', '白露茶'],
    dietBad: ['辛辣、烧烤、燥热坚果过量', '生冷海鲜'],
    recipe: '杏仁雪梨炖银耳，润肺止咳。',
    acupoint: '迎香（润鼻）、太溪（滋阴）。',
  },
  {
    key: 'qiufen', name: '秋分', season: '秋',
    summary: '阴阳再平衡，燥凉并见，宜养阴润燥、收敛肺气。',
    living: '早卧早起；适度秋冻以增强耐寒力，体弱者不宜。',
    dietGood: ['酸味收敛：苹果、葡萄、山楂', '润燥：芝麻、核桃、蜂蜜', '山药粥'],
    dietBad: ['辛辣发散', '过量冷饮'],
    recipe: '芝麻核桃糊，润燥补肾。',
    acupoint: '太渊、三阴交（养阴）。',
  },
  {
    key: 'hanlu', name: '寒露', season: '秋',
    summary: '露气寒冷，燥邪转凉燥，宜养阴防燥、暖足护颈。',
    living: '足部保暖，"寒从脚起"；睡前热水泡脚；避免清晨雾中锻炼。',
    dietGood: ['温润：芝麻、核桃、银耳、蜂蜜', '健脾温中：栗子、山药、红薯', '菊花酒/菊花茶清肝明目'],
    dietBad: ['生冷、寒凉瓜果', '辛辣耗阴'],
    recipe: '栗子山药排骨汤，健脾补肾。',
    acupoint: '涌泉（暖肾）、大椎（御寒）。',
  },
  {
    key: 'shuangjiang', name: '霜降', season: '秋',
    summary: '阳气收敛，阴气始凝，宜平补、御寒、护脾胃。',
    living: '注意添衣保暖，尤其膝关节与腹部；宜静不宜躁。',
    dietGood: ['平补：牛肉、羊肉（适量）、栗子、南瓜', '润燥：梨、蜂蜜', '萝卜顺气化痰'],
    dietBad: ['生冷、寒凉', '空腹吃柿子（易结石）'],
    recipe: '萝卜炖牛肉，顺气补中。',
    acupoint: '足三里、关元（温补）。',
  },
  {
    key: 'lidong', name: '立冬', season: '冬',
    summary: '万物收藏，宜养藏、补肾温阳，早卧晚起。',
    living: '早卧晚起，必待日光；保暖以护阳气；情志宜内敛安静。',
    dietGood: ['温补：羊肉、牛肉、桂圆、核桃', '黑色入肾：黑豆、黑芝麻、黑木耳', '根茎类蔬菜'],
    dietBad: ['生冷寒凉', '过咸（咸伤肾）'],
    recipe: '当归生姜羊肉汤（当归补血汤意），温阳养血。',
    acupoint: '肾俞、关元、太溪（补肾要穴）。',
  },
  {
    key: 'xiaoxue', name: '小雪', season: '冬',
    summary: '天地闭塞，宜温补益肾、安神定志。',
    living: '日照减少，注意情绪调节防冬季抑郁；室内保湿通风。',
    dietGood: ['温补：羊肉、牛肉、栗子', '养心安神：香蕉、菠菜、全谷', '黑色食物补肾'],
    dietBad: ['生冷、寒凉', '过于燥热（进补过度致上火）'],
    recipe: '黑豆核桃排骨汤，补肾益精。',
    acupoint: '太溪、涌泉、神门。',
  },
  {
    key: 'daxue', name: '大雪', season: '冬',
    summary: '阴气最盛，宜大温大补、固护阳气，防心脑血管疾病。',
    living: '防寒保暖，尤其头颈足；晨起宜缓，避免骤然寒冷刺激。',
    dietGood: ['温阳：羊肉、鹿茸（慎用）、肉桂（少量）', '补肾：黑豆、黑芝麻、核桃', '高热量易消化食物'],
    dietBad: ['寒凉生冷', '过量饮酒（虽暖实耗）'],
    recipe: '桂圆红枣枸杞茶，温补气血。',
    acupoint: '命门、关元（温阳）、足三里。',
  },
  {
    key: 'dongzhi', name: '冬至', season: '冬',
    summary: '一阳来复，阴极阳生，是进补与养藏的关键节点。',
    living: '早卧晚起，减少消耗；可艾灸关元、足三里以助阳气生发。',
    dietGood: ['温补：羊肉、狗肉（按需）、饺子/汤圆（民俗暖身）', '坚果、黑色食物', '当归生姜类温养'],
    dietBad: ['寒凉、生冷', '过度劳累'],
    recipe: '当归生姜羊肉汤，冬至进补首选。',
    acupoint: '关元、气海、足三里（冬至艾灸效果好）。',
  },
  {
    key: 'xiaohan', name: '小寒', season: '冬',
    summary: '冷气积久，宜温经散寒、固本培元。',
    living: '最冷时节，重点保暖头、背、足；适度室内运动。',
    dietGood: ['温热：羊肉、鸡肉、桂圆、姜', '黑色补肾', '粥类养胃（腊八粥意）'],
    dietBad: ['生冷、寒凉', '黏硬难化之物'],
    recipe: '腊八粥（五谷杂粮+桂圆红枣），温补脾胃。',
    acupoint: '肾俞、命门、涌泉。',
  },
  {
    key: 'dahan', name: '大寒', season: '冬',
    summary: '寒极将转，宜温补收尾并兼顾疏肝，为春生做准备。',
    living: '继续保暖，同时开始适度增加活动量，顺应将到的春生之气。',
    dietGood: ['温补脾肾：羊肉、山药、栗子', '兼顾疏泄：萝卜、白菜顺气', '姜枣茶'],
    dietBad: ['寒凉生冷', '大补过度致内热'],
    recipe: '姜枣茶配山药小米粥，温中健脾。',
    acupoint: '足三里、太冲（补中兼疏）。',
  },
];

/**
 * 节气的通寿公式常数（21 世纪适用）。
 * 日期 = INT(Y × 0.2422 + C) − INT((Y−1) / 4)，Y 为年份后两位。
 * 精度 ±1 天，对养生提醒足够；超出 21 世纪退化为固定近似日。
 */
const TERM_CONSTANTS: Record<string, { month: number; c: number }> = {
  xiaohan: { month: 1, c: 5.4055 },
  dahan: { month: 1, c: 20.12 },
  lichun: { month: 2, c: 3.87 },
  yushui: { month: 2, c: 18.73 },
  jingzhe: { month: 3, c: 5.63 },
  chunfen: { month: 3, c: 20.646 },
  qingming: { month: 4, c: 4.81 },
  guyu: { month: 4, c: 20.1 },
  lixia: { month: 5, c: 5.52 },
  xiaoman: { month: 5, c: 21.04 },
  mangzhong: { month: 6, c: 5.678 },
  xiazhi: { month: 6, c: 21.37 },
  xiaoshu: { month: 7, c: 7.108 },
  dashu: { month: 7, c: 22.83 },
  liqiu: { month: 8, c: 7.5 },
  chushu: { month: 8, c: 23.13 },
  bailu: { month: 9, c: 7.646 },
  qiufen: { month: 9, c: 23.042 },
  hanlu: { month: 10, c: 8.318 },
  shuangjiang: { month: 10, c: 23.438 },
  lidong: { month: 11, c: 7.438 },
  xiaoxue: { month: 11, c: 22.36 },
  daxue: { month: 12, c: 7.18 },
  dongzhi: { month: 12, c: 21.94 },
};

/** 节气的自然顺序（从立春起，符合四季流转） */
const TERM_ORDER = [
  'lichun', 'yushui', 'jingzhe', 'chunfen', 'qingming', 'guyu',
  'lixia', 'xiaoman', 'mangzhong', 'xiazhi', 'xiaoshu', 'dashu',
  'liqiu', 'chushu', 'bailu', 'qiufen', 'hanlu', 'shuangjiang',
  'lidong', 'xiaoxue', 'daxue', 'dongzhi', 'xiaohan', 'dahan',
];

/** 计算某年某节气的具体日期 */
function solarTermDate(year: number, key: string): Date {
  const meta = TERM_CONSTANTS[key];
  if (year < 2000 || year > 2099 || !meta) {
    // 退化：用节气在自然顺序中的位置大致估算
    const index = TERM_ORDER.indexOf(key);
    return new Date(year, Math.floor(index / 2) + 1, index % 2 === 0 ? 6 : 21);
  }
  const Y = year % 100;
  const day = Math.floor(Y * 0.2422 + meta.c) - Math.floor((Y - 1) / 4);
  return new Date(year, meta.month - 1, day);
}

export interface SolarTermSpan {
  term: SolarTerm;
  startDate: Date;
  endDate: Date;
  /** 距下一个节气还有几天 */
  daysToNext: number;
  nextName: string;
}

/** 取当前所处的节气区间 */
export function currentSolarTerm(date: Date = new Date()): SolarTermSpan {
  const year = date.getFullYear();
  // 构造该年与相邻年的节气时间轴
  const timeline: { key: string; at: Date }[] = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const key of TERM_ORDER) timeline.push({ key, at: solarTermDate(y, key) });
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  let index = timeline.findIndex((item) => item.at.getTime() > date.getTime()) - 1;
  if (index < 0) index = 0;

  const current = timeline[index];
  const next = timeline[index + 1];
  const term = SOLAR_TERMS.find((item) => item.key === current.key)!;
  const nextTerm = SOLAR_TERMS.find((item) => item.key === next.key)!;
  return {
    term,
    startDate: current.at,
    endDate: next.at,
    daysToNext: Math.max(0, Math.ceil((next.at.getTime() - date.getTime()) / 86400000)),
    nextName: nextTerm.name,
  };
}

export interface CareReminder {
  key: 'eye' | 'water' | 'sit';
  label: string;
  /** 默认间隔（分钟） */
  defaultMinutes: number;
  title: string;
  /** 中医理论依据 */
  basis: string;
  /** 具体动作 */
  action: string[];
  /** 播报用语 */
  speech: string;
}

export const CARE_REMINDERS: CareReminder[] = [
  {
    key: 'eye',
    label: '用眼卫生',
    defaultMinutes: 30,
    title: '该让眼睛歇一歇了',
    basis: '《素问·宣明五气》言「久视伤血」，肝开窍于目、肝受血而能视，久视则耗肝血。',
    action: [
      '遵循 20-20-20 法则：每 20 分钟，看 20 英尺（约 6 米）外物体 20 秒',
      '闭目或轻轻热敷双眼 1 分钟',
      '按揉睛明、攒竹、太阳、四白穴各 10 圈',
      '有意识地多眨眼，保持泪膜湿润',
    ],
    speech: '用眼已有一段时间，久视伤血。请抬头远望二十秒，闭目养神，让肝血得以濡养双目。',
  },
  {
    key: 'water',
    label: '饮水提醒',
    defaultMinutes: 40,
    title: '该喝口水了',
    basis: '津液为气血之属，脾胃喜温恶寒。饮水宜温、宜少量多次，忌牛饮与冰饮伤脾阳。',
    action: [
      '小口慢饮温水 100–200 毫升，勿一次牛饮',
      '水温以 35–45℃ 为宜，忌冰镇',
      '晨起与申时（15–17 点膀胱经当令）补水效果最佳',
      '可佐以枸杞、菊花或麦冬代茶',
    ],
    speech: '该起身喝口水了。请小口慢饮温水，切勿牛饮或贪凉饮冷，以免损伤脾阳。',
  },
  {
    key: 'sit',
    label: '起身活动',
    defaultMinutes: 50,
    title: '该站起来动一动了',
    basis: '《素问·宣明五气》言「久坐伤肉」，脾主肌肉，久坐则气血运行不畅、脾气不运。',
    action: [
      '起身站立并走动 3–5 分钟',
      '做颈椎与腰椎舒缓：米字操、转腰、伸展',
      '踮脚跟 30 下，促下肢血液回流',
      '八段锦「两手托天理三焦」做 6 遍',
    ],
    speech: '久坐伤肉，气血运行不畅。请起身活动三五分钟，伸展筋骨，让脾气得以舒展。',
  },
];

/** 八字天干地支纪时（可选展示，增强传统感） */
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

export function ganzhiYear(date: Date = new Date()): string {
  const y = date.getFullYear();
  const ganIndex = (y - 4) % 10;
  const zhiIndex = (y - 4) % 12;
  return `${GAN[ganIndex]}${ZHI[zhiIndex]}（${ZODIAC[zhiIndex]}）年`;
}

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 中医智能体的默认设置 */
export const DEFAULT_HEALTH: HealthSettings = {
  enabled: true,
  care: {
    eye: { enabled: true, minutes: 30 },
    water: { enabled: true, minutes: 40 },
    sit: { enabled: true, minutes: 50 },
  },
  meridianNotice: true,
  solarTermNotice: true,
  voiceEnabled: false,
  voiceId: 'girl-warm',
  rate: 0.95,
  volume: 0.9,
  quietFrom: '22:30',
  quietTo: '07:00',
  ledColor: 'green',
};

/** 判断某时刻是否处于免打扰时段（支持跨零点） */
export function inQuietHours(
  date: Date,
  from: string,
  to: string,
): boolean {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const cur = date.getHours() * 60 + date.getMinutes();
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** 组装某时刻的完整养生提示（供播报与展示共用） */
export function composeHealthBrief(date: Date = new Date()): {
  hour: MeridianHour;
  span: SolarTermSpan;
  title: string;
  speech: string;
} {
  const hour = meridianHourOf(date);
  const span = currentSolarTerm(date);
  const title = `${hour.name}·${hour.organ}经当令 / ${span.term.name}`;
  const speech =
    `现在是${hour.name}，${hour.meridian}当令，${hour.summary}` +
    `当前节气${span.term.name}，${span.term.summary}`;
  return { hour, span, title, speech };
}
