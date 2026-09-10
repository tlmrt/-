// ============================================================
// 多国节日数据（离线内置）
// 规则类型：
//   { name, m, d }                      固定公历月日
//   { name, m, weekday, nth }           某月第 n 个星期 X（weekday: 0=周日 … 6=周六）
//   { name, lunar: [月, 日] }            农历月日（仅中国用）
//   { name, solarTerm: '清明' }          二十四节气名（清明等）
//   { name, special: 'chuxi' }           除夕（农历年最后一天）
// ============================================================

const COUNTRIES = [
  { code: 'cn', name: '中国' },
  { code: 'us', name: '美国' },
  { code: 'jp', name: '日本' },
  { code: 'kr', name: '韩国' },
  { code: 'uk', name: '英国' },
  { code: 'de', name: '德国' },
];

const RULES = {
  cn: [
    { name: '元旦', m: 1, d: 1 },
    { name: '情人节', m: 2, d: 14 },
    { name: '妇女节', m: 3, d: 8 },
    { name: '植树节', m: 3, d: 12 },
    { name: '愚人节', m: 4, d: 1 },
    { name: '劳动节', m: 5, d: 1 },
    { name: '青年节', m: 5, d: 4 },
    { name: '儿童节', m: 6, d: 1 },
    { name: '建党节', m: 7, d: 1 },
    { name: '建军节', m: 8, d: 1 },
    { name: '教师节', m: 9, d: 10 },
    { name: '国庆节', m: 10, d: 1 },
    { name: '平安夜', m: 12, d: 24 },
    { name: '圣诞节', m: 12, d: 25 },
    { name: '春节', lunar: [1, 1] },
    { name: '元宵节', lunar: [1, 15] },
    { name: '龙抬头', lunar: [2, 2] },
    { name: '端午节', lunar: [5, 5] },
    { name: '七夕', lunar: [7, 7] },
    { name: '中元节', lunar: [7, 15] },
    { name: '中秋节', lunar: [8, 15] },
    { name: '重阳节', lunar: [9, 9] },
    { name: '腊八节', lunar: [12, 8] },
    { name: '小年', lunar: [12, 23] },
    { name: '除夕', special: 'chuxi' },
    { name: '清明节', solarTerm: '清明' },
  ],
  us: [
    { name: '元旦', m: 1, d: 1 },
    { name: '马丁·路德·金日', m: 1, weekday: 1, nth: 3 },
    { name: '情人节', m: 2, d: 14 },
    { name: '总统日', m: 2, weekday: 1, nth: 3 },
    { name: '圣帕特里克节', m: 3, d: 17 },
    { name: '独立日', m: 7, d: 4 },
    { name: '万圣节', m: 10, d: 31 },
    { name: '退伍军人节', m: 11, d: 11 },
    { name: '感恩节', m: 11, weekday: 4, nth: 4 },
    { name: '平安夜', m: 12, d: 24 },
    { name: '圣诞节', m: 12, d: 25 },
  ],
  jp: [
    { name: '元旦', m: 1, d: 1 },
    { name: '成人日', m: 1, weekday: 1, nth: 2 },
    { name: '建国纪念日', m: 2, d: 11 },
    { name: '天皇诞生日', m: 2, d: 23 },
    { name: '春分日', m: 3, d: 20 },
    { name: '昭和日', m: 4, d: 29 },
    { name: '宪法纪念日', m: 5, d: 3 },
    { name: '绿之日', m: 5, d: 4 },
    { name: '儿童节', m: 5, d: 5 },
    { name: '海之日', m: 7, weekday: 1, nth: 3 },
    { name: '山之日', m: 8, d: 11 },
    { name: '敬老日', m: 9, weekday: 1, nth: 3 },
    { name: '秋分日', m: 9, d: 23 },
    { name: '体育日', m: 10, weekday: 1, nth: 2 },
    { name: '文化日', m: 11, d: 3 },
    { name: '勤劳感谢日', m: 11, d: 23 },
  ],
  kr: [
    { name: '元旦', m: 1, d: 1 },
    { name: '三一节', m: 3, d: 1 },
    { name: '儿童节', m: 5, d: 5 },
    { name: '显忠日', m: 6, d: 6 },
    { name: '光复节', m: 8, d: 15 },
    { name: '开天节', m: 10, d: 3 },
    { name: '韩文节', m: 10, d: 9 },
    { name: '圣诞节', m: 12, d: 25 },
  ],
  uk: [
    { name: '元旦', m: 1, d: 1 },
    { name: '情人节', m: 2, d: 14 },
    { name: '圣帕特里克节', m: 3, d: 17 },
    { name: '愚人节', m: 4, d: 1 },
    { name: '万圣节', m: 10, d: 31 },
    { name: '篝火之夜', m: 11, d: 5 },
    { name: '国殇纪念日', m: 11, d: 11 },
    { name: '平安夜', m: 12, d: 24 },
    { name: '圣诞节', m: 12, d: 25 },
    { name: '节礼日', m: 12, d: 26 },
  ],
  de: [
    { name: '元旦', m: 1, d: 1 },
    { name: '三王节', m: 1, d: 6 },
    { name: '劳动节', m: 5, d: 1 },
    { name: '德国统一日', m: 10, d: 3 },
    { name: '万圣节', m: 10, d: 31 },
    { name: '平安夜', m: 12, d: 24 },
    { name: '圣诞节', m: 12, d: 25 },
    { name: '节礼日', m: 12, d: 26 },
    { name: '跨年夜', m: 12, d: 31 },
  ],
};

module.exports = { COUNTRIES, RULES };
