// ============================================================
// 一句话建任务：中文自然语言解析（nlp.js）
//   - 纯函数、无副作用（不修改传入的 Date）
//   - 零依赖：不 require electron / dayjs，可直接 node 单测
//   - 对外导出：parseQuickTask / parseDateExpr / parseTimeExpr
//
// 解析顺序：提前量 → 时间 → 日期 → 重复，剩下的文本作为标题
// ============================================================
'use strict';

// ------------------------------------------------------------
// 1. 基础工具
// ------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/** 拼 YYYY-MM-DD */
const fmtDate = (y, m, d) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

/** 拼 HH:mm */
const fmtTime = (h, mi) => `${pad2(h)}:${pad2(mi)}`;

/** 某年某月（m 为 1-12）的天数 */
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

/** 可比较的日期数字键 */
const keyOf = (y, m, d) => y * 10000 + m * 100 + d;

/** 取本地年月日；非法入参退回当前时间（不改动入参） */
function toParts(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** 按天偏移，自动进位 / 借位 */
function shiftDays(p, n) {
  const d = new Date(p.y, p.m - 1, p.d + n);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** 日号收敛到当月最后一天（月末溢出保护，如 1/31 加一月 → 2/28） */
const clampDay = (y, m, d) => Math.min(Math.max(1, d), daysInMonth(y, m));

/** 星期序号：0=周一 … 6=周日（与 Date#getDay 的 0=周日不同） */
const weekdayIndex = (y, m, d) => (new Date(y, m - 1, d).getDay() + 6) % 7;

/** 下一个月（1-12 进位） */
const nextMonthOf = (y, m) => (m >= 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });

// ---------- 中文数字 ----------
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 阿拉伯数字或中文数字 → Number，失败返回 NaN */
function parseNum(input) {
  if (input == null) return NaN;
  const t = String(input).trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '十') return 10;
  if (t[0] === '十') return 10 + (CN_DIGIT[t[1]] ?? 0); // 十一 … 十九
  if (t.includes('十')) {
    const [a, b] = t.split('十');
    return (CN_DIGIT[a] ?? 0) * 10 + (b ? (CN_DIGIT[b] ?? 0) : 0); // 二十 / 二十五
  }
  if (t.length === 1) return CN_DIGIT[t] ?? NaN;
  let v = 0;
  for (const ch of t) {
    const x = CN_DIGIT[ch];
    if (x === undefined) return NaN;
    v = v * 10 + x;
  }
  return v;
}

// 数字片段：阿拉伯数字或中文数字
const NUM = '(?:\\d{1,2}|[零一二两三四五六七八九十]{1,3})';

/** 找出正则的全部匹配（每次新建 RegExp，避免共享 lastIndex 的隐藏状态） */
function findAll(re, text) {
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out = [];
  let m;
  while ((m = rx.exec(text)) !== null) {
    out.push(m);
    if (m.index === rx.lastIndex) rx.lastIndex += 1; // 防御空匹配死循环
  }
  return out;
}

/** 挖掉一段文本，用空格占位（避免两侧文字直接粘在一起） */
const cutOut = (text, index, raw) => text.slice(0, index) + ' ' + text.slice(index + raw.length);

/** 压缩空白并 trim */
const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------
// 2. 时间解析
// ------------------------------------------------------------

const PERIOD = '(凌晨|清晨|早晨|早上|上午|中午|下午|傍晚|晚上|夜里|夜晚)';

// 15:00 / 15：00（全角冒号）/ 9:05 / 下午3:30
// （半天词与它后面的空白一起放进可选组，避免匹配结果带上开头的空格）
const TIME_COLON_RE = new RegExp('(?:' + PERIOD + '\\s*)?(\\d{1,2})\\s*[:：]\\s*(\\d{1,2})');

// 下午3点 / 晚上8点半 / 早上9点15分 / 3点一刻 / 晚上八点
// 中文数字前加护栏，避开「早一点 / 快一点」这类量词
const TIME_DIAN_RE = new RegExp(
  '(?:' + PERIOD + '\\s*)?' +
    '((?:\\d{1,2}|(?<![早快多少慢晚大])[零一二两三四五六七八九十]{1,3}))' +
    '\\s*点(?:\\s*(整|半|一刻|三刻|\\d{1,2}\\s*分?))?',
);

/** 半天词 → 24 小时制 */
function applyPeriod(period, h) {
  if (!period) return h; // 无半天词时按 24 小时直读：3点 = 03:00
  if (period === '凌晨' || period === '清晨') return h === 12 ? 0 : h; // 凌晨12点 = 00:00
  if (period === '早上' || period === '早晨' || period === '上午') return h === 12 ? 12 : h;
  if (period === '中午') return h === 12 ? 12 : h <= 5 ? h + 12 : h; // 中午12点 = 12:00、中午1点 = 13:00
  if (period === '下午') return h === 12 ? 12 : h < 12 ? h + 12 : h; // 下午12点 = 12:00
  return h === 12 ? 0 : h < 12 ? h + 12 : h; // 傍晚/晚上/夜里：晚上12点 = 00:00
}

/** 「3点半」的后缀 → 分钟 */
function minuteFromSuffix(suffix) {
  if (!suffix) return 0;
  const s = String(suffix).trim();
  if (s === '整') return 0;
  if (s === '半') return 30;
  if (s === '一刻') return 15;
  if (s === '三刻') return 45;
  const n = Number(s.replace(/\s*分$/, ''));
  return Number.isNaN(n) ? NaN : n;
}

/** 取最左的有效时间片段 */
function firstTimeMatch(text) {
  let best = null;
  const consider = (index, raw, h, mi, pri) => {
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return;
    if (!best || index < best.index || (index === best.index && pri < best.pri)) {
      best = { index, raw, time: fmtTime(h, mi), pri };
    }
  };

  for (const m of findAll(TIME_COLON_RE, text)) {
    consider(m.index, m[0], applyPeriod(m[1], Number(m[2])), Number(m[3]), 0);
  }

  for (const m of findAll(TIME_DIAN_RE, text)) {
    const period = m[1];
    const raw = m[2];
    // 光秃秃的「一点」歧义太大（买一点 / 快一点），只在带半天词时按时间算
    if (!period && raw === '一') continue;
    const h0 = parseNum(raw);
    if (Number.isNaN(h0)) continue;
    consider(m.index, m[0], applyPeriod(period, h0), minuteFromSuffix(m[3]), 1);
  }

  return best;
}

/**
 * 解析时间片段（供命令面板复用）
 * @returns {{time: string, rest: string}|null} 解析不到返回 null
 */
function parseTimeExpr(text, now = new Date()) {
  // now 不参与时间解析，仅保留参数以便与 parseDateExpr 统一签名
  void now;
  const src = typeof text === 'string' ? text : '';
  const hit = firstTimeMatch(src);
  if (!hit) return null;
  return { time: hit.time, rest: normalize(cutOut(src, hit.index, hit.raw)) };
}

// ------------------------------------------------------------
// 3. 日期解析
// ------------------------------------------------------------

// 相对日
const REL_DAY = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 };

// 星期字 → 内部序号（0=周一）
const WEEK_CN = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 七: 6 };

function weekdayFrom(ch) {
  if (Object.prototype.hasOwnProperty.call(WEEK_CN, ch)) return WEEK_CN[ch];
  const n = Number(ch);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n - 1;
  return NaN;
}

/** 带年份的完整日期：2026-10-01 / 2026/10/01 / 2026.10.01 / 2026年10月1日 */
const RE_FULL_DATE = /(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})(?:\s*[日号])?/;
/** 中文月日：10月1日 / 10月1号 / 十月一日 / 2026年10月1日 */
const RE_MD = new RegExp('(?:(\\d{4})\\s*年\\s*)?(' + NUM + ')\\s*月\\s*(' + NUM + ')\\s*[日号]');
/** 斜杠/短横月日：10/1、10-1 */
const RE_SLASH_MD = /(?<![\d\/\-])(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?![\d\/\-])/;
/** 月底 / 月末 / 下个月底 */
const RE_MONTH_END = /(?:(下个|下|本|这个)\s*)?月\s*(?:底|末)/;
/** 9月底（带月份的月末） */
const RE_MONTH_END_N = /(?<![\d])(\d{1,2})\s*月\s*(?:底|末)/;
/** 下个月5号 */
const RE_NEXT_MONTH_DAY = new RegExp('下个?月\\s*(' + NUM + ')\\s*[日号]?');
/** 下个月 */
const RE_NEXT_MONTH = /下个?月/;
/** 裸日号：5号 / 15日 */
const RE_DAY = /(?<!\d)(\d{1,2})\s*[日号]/;

/** 无年份的月日：今年已过则取明年 */
function monthDayFuture(ctx, mo, d0) {
  if (!(mo >= 1 && mo <= 12) || !(d0 >= 1)) return null;
  let y = ctx.today.y;
  let cand = { y, m: mo, d: clampDay(y, mo, d0) };
  if (keyOf(cand.y, cand.m, cand.d) < keyOf(ctx.today.y, ctx.today.m, ctx.today.d)) {
    y += 1;
    cand = { y, m: mo, d: clampDay(y, mo, d0) };
  }
  return cand;
}

const DATE_RULES = [
  // 今天 / 明天 / 后天 / 大后天
  {
    re: /(大后天|后天|明天|明日|今天|今日)/,
    build: (m, ctx) => shiftDays(ctx.today, REL_DAY[m[1]]),
  },
  // 周一 … 周日 / 星期一 / 本周五 / 下周一（「每周三」交给重复规则，故排除前面的「每」）
  {
    re: /(?<!每(?:个)?)(下下|下|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/,
    build: (m, ctx) => {
      const wd = weekdayFrom(m[2]);
      if (Number.isNaN(wd)) return null;
      const today = weekdayIndex(ctx.today.y, ctx.today.m, ctx.today.d);
      const pre = m[1] || '';
      let delta;
      if (pre === '下下') delta = 14 - today + wd;
      else if (pre === '下') delta = 7 - today + wd;
      else if (pre === '本' || pre === '这') delta = wd - today;
      else delta = (((wd - today) % 7) + 7) % 7; // 未来的那一次（含今天）
      return shiftDays(ctx.today, delta);
    },
  },
  // 2026-10-01 / 2026/10/01 / 2026年10月1日
  {
    re: RE_FULL_DATE,
    build: (m) => {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d0 = Number(m[3]);
      if (!(mo >= 1 && mo <= 12) || !(d0 >= 1)) return null;
      return { y, m: mo, d: clampDay(y, mo, d0) };
    },
  },
  // 10月1日 / 10月1号 / 十月一日
  {
    re: RE_MD,
    build: (m, ctx) => {
      const mo = parseNum(m[2]);
      const d0 = parseNum(m[3]);
      if (Number.isNaN(mo) || Number.isNaN(d0)) return null;
      if (m[1]) return { y: Number(m[1]), m: mo, d: clampDay(Number(m[1]), mo, d0) };
      return monthDayFuture(ctx, mo, d0);
    },
  },
  // 10/1、10-1
  {
    re: RE_SLASH_MD,
    build: (m, ctx) => monthDayFuture(ctx, Number(m[1]), Number(m[2])),
  },
  // 月底 / 下个月底
  {
    re: RE_MONTH_END,
    build: (m, ctx) => {
      let p = { y: ctx.today.y, m: ctx.today.m };
      if (/下/.test(m[1] || '')) p = nextMonthOf(p.y, p.m);
      return { y: p.y, m: p.m, d: daysInMonth(p.y, p.m) };
    },
  },
  // 9月底
  {
    re: RE_MONTH_END_N,
    build: (m, ctx) => {
      const mo = Number(m[1]);
      if (!(mo >= 1 && mo <= 12)) return null;
      const y = ctx.today.y;
      const last = { y, m: mo, d: daysInMonth(y, mo) };
      if (keyOf(last.y, last.m, last.d) < keyOf(ctx.today.y, ctx.today.m, ctx.today.d)) {
        const nx = nextMonthOf(y, mo);
        return { y: nx.y, m: nx.m, d: daysInMonth(nx.y, nx.m) };
      }
      return last;
    },
  },
  // 下个月5号
  {
    re: RE_NEXT_MONTH_DAY,
    build: (mt, ctx) => {
      const d0 = parseNum(mt[1]);
      if (Number.isNaN(d0)) return null;
      const { y, m } = nextMonthOf(ctx.today.y, ctx.today.m);
      return { y, m, d: clampDay(y, m, d0) };
    },
  },
  // 下个月（同一天，月末收敛）
  {
    re: RE_NEXT_MONTH,
    build: (mt, ctx) => {
      const { y, m } = nextMonthOf(ctx.today.y, ctx.today.m);
      return { y, m, d: clampDay(y, m, ctx.today.d) };
    },
  },
  // 裸日号：5号 / 15日（本月已过则顺延到下月）
  {
    re: RE_DAY,
    build: (mt, ctx) => {
      const d0 = Number(mt[1]);
      if (!(d0 >= 1 && d0 <= 31)) return null;
      const { y, m } = ctx.today;
      const cand = { y, m, d: clampDay(y, m, d0) };
      if (keyOf(cand.y, cand.m, cand.d) < keyOf(ctx.today.y, ctx.today.m, ctx.today.d)) {
        const nx = nextMonthOf(y, m);
        return { y: nx.y, m: nx.m, d: clampDay(nx.y, nx.m, d0) };
      }
      return cand;
    },
  },
];

/** 取最左的日期命中（同位置时按规则表顺序，先紧后松） */
function firstDateMatch(text, ctx) {
  let best = null;
  for (const rule of DATE_RULES) {
    for (const m of findAll(rule.re, text)) {
      const p = rule.build(m, ctx);
      if (!p) continue;
      if (!best || m.index < best.index) {
        best = { index: m.index, raw: m[0], date: fmtDate(p.y, p.m, p.d) };
      }
      break; // 同一条规则只取最左的有效匹配
    }
  }
  return best;
}

/**
 * 解析日期片段（供命令面板复用）
 * @returns {{date: string, rest: string}|null} 解析不到返回 null
 */
function parseDateExpr(text, now = new Date()) {
  const src = typeof text === 'string' ? text : '';
  const hit = firstDateMatch(src, { today: toParts(now) });
  if (!hit) return null;
  return { date: hit.date, rest: normalize(cutOut(src, hit.index, hit.raw)) };
}

// ------------------------------------------------------------
// 4. 提前量解析（提前 10 分钟 → offsetMinutes = 10）
// ------------------------------------------------------------

// 单位 → 分钟（长的写在前面，便于 endsWith 命中更具体的单位）
const OFFSET_UNITS = [
  ['个小时', 60],
  ['分钟', 1],
  ['小时', 60],
  ['钟头', 60],
  ['个星期', 10080],
  ['星期', 10080],
  ['个月', 43200],
  ['月', 43200],
  ['周', 10080],
  ['天', 1440],
  ['日', 1440],
  ['分', 1],
];

const OFFSET_RE = new RegExp(
  '提前\\s*(' +
    '半(?:\\s*个)?\\s*(?:小时|钟头)' + // 提前半小时
    '|半\\s*(?:分钟|分)' + // 提前半分钟
    '|(?:\\d{1,3}|[零一二两三四五六七八九十]{1,3})\\s*' + // 提前10分钟 / 提前十分钟
    '(?:个小时|分钟|小时|钟头|个星期|星期|个月|月|周|天|日|分)' +
    ')',
);

const matchUnit = (s) => OFFSET_UNITS.find(([u]) => s.endsWith(u)) || null;

/** 「10分钟」/「半小时」→ 分钟数 */
function parseOffsetBody(body) {
  const s = String(body).replace(/\s+/g, '');
  if (s.startsWith('半')) {
    const unitStr = s.slice(1).replace(/^个/, '');
    const u = matchUnit(unitStr);
    return u ? Math.round(u[1] / 2) : NaN;
  }
  const u = matchUnit(s);
  if (!u) return NaN;
  const n = parseNum(s.slice(0, s.length - u[0].length));
  return Number.isNaN(n) ? NaN : n * u[1];
}

/** 抽取全部提前量，返回去重后从大到小排序的分钟数 + 剩余文本 */
function extractOffsets(text) {
  const ms = findAll(OFFSET_RE, text);
  if (!ms.length) return null;
  const values = [];
  let rest = text;
  for (const m of ms) {
    const v = parseOffsetBody(m[1]);
    if (!Number.isNaN(v) && v >= 0) values.push(v);
  }
  if (!values.length) return null;
  // 从后往前挖，避免下标错位
  for (let i = ms.length - 1; i >= 0; i--) rest = cutOut(rest, ms[i].index, ms[i][0]);
  const offsets = Array.from(new Set(values)).sort((a, b) => b - a);
  return { offsets, rest: normalize(rest) };
}

// ------------------------------------------------------------
// 5. 重复规则解析
// ------------------------------------------------------------

const REPEAT_RULES = [
  // 每个工作日 / 工作日
  { re: /每(?:个)?\s*工作日(?!历)/, repeat: 'weekdays' },
  { re: /工作日(?!历)/, repeat: 'weekdays' },
  // 每天 / 每日 / 天天
  { re: /(每天|每日|天天)/, repeat: 'daily' },
  // 每周 / 每周三
  {
    re: new RegExp('每(?:个)?\\s*(?:周|星期|礼拜)(?:\\s*([一二三四五六日天1-7]))?'),
    repeat: 'weekly',
    // 每周三 → 同时把日期定到「未来的那一次周三」
    build: (m, ctx) => {
      const wd = weekdayFrom(m[1]);
      if (Number.isNaN(wd)) return null;
      const today = weekdayIndex(ctx.today.y, ctx.today.m, ctx.today.d);
      return shiftDays(ctx.today, (((wd - today) % 7) + 7) % 7);
    },
  },
  // 每月 / 每月5号
  {
    re: new RegExp('每(?:个)?\\s*月\\s*(?:(' + NUM + ')\\s*[日号])?'),
    repeat: 'monthly',
    build: (m, ctx) => {
      const d0 = parseNum(m[1]);
      if (Number.isNaN(d0)) return null;
      return monthDayFuture(ctx, ctx.today.m, d0);
    },
  },
];

/** 取最左的重复命中 */
function firstRepeatMatch(text, ctx) {
  let best = null;
  for (const rule of REPEAT_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    if (!best || m.index < best.index) {
      const p = rule.build ? rule.build(m, ctx) : null;
      best = {
        index: m.index,
        raw: m[0],
        repeat: rule.repeat,
        date: p ? fmtDate(p.y, p.m, p.d) : null,
      };
    }
  }
  return best;
}

// ------------------------------------------------------------
// 6. 对外主入口
// ------------------------------------------------------------

/**
 * 一句话建任务
 * @param {string} text 用户输入，如「明天下午3点开会提前10分钟」
 * @param {Date} now 基准时间（只读，不会修改）
 * @returns {{
 *   ok: boolean, title: string, date: string, time: string, repeat: string,
 *   reminders: Array<{offsetMinutes: number}>,
 *   matched: {date?: string, time?: string, repeat?: string, offsets?: number[]}
 * }}
 */
function parseQuickTask(text, now = new Date()) {
  const src = typeof text === 'string' ? text : text == null ? '' : String(text);
  const today = toParts(now);
  const ctx = { today };
  const matched = {};
  const offsetsHint = [];

  let rest = src;
  let date = fmtDate(today.y, today.m, today.d);
  let time = '';
  let repeat = 'none';
  let dateExplicit = false;
  let gotSomething = false;

  // 1) 提前量
  const offs = extractOffsets(rest);
  if (offs) {
    rest = offs.rest;
    matched.offsets = offs.offsets.slice();
    offsetsHint.push(...offs.offsets);
    gotSomething = true;
  }

  // 2) 时间
  const hitTime = firstTimeMatch(rest);
  if (hitTime) {
    rest = normalize(cutOut(rest, hitTime.index, hitTime.raw));
    matched.time = hitTime.raw;
    time = hitTime.time;
    gotSomething = true;
  }

  // 3) 日期
  const hitDate = firstDateMatch(rest, ctx);
  if (hitDate) {
    rest = normalize(cutOut(rest, hitDate.index, hitDate.raw));
    matched.date = hitDate.raw;
    date = hitDate.date;
    dateExplicit = true;
    gotSomething = true;
  }

  // 4) 重复
  const hitRepeat = firstRepeatMatch(rest, ctx);
  if (hitRepeat) {
    rest = normalize(cutOut(rest, hitRepeat.index, hitRepeat.raw));
    matched.repeat = hitRepeat.raw;
    repeat = hitRepeat.repeat;
    if (!dateExplicit && hitRepeat.date) date = hitRepeat.date;
    gotSomething = true;
  }

  const title = normalize(rest);
  if (title) gotSomething = true;

  return {
    ok: gotSomething,
    title,
    date,
    time,
    repeat,
    reminders: offsetsHint.map((offsetMinutes) => ({ offsetMinutes })),
    matched,
  };
}

module.exports = { parseQuickTask, parseDateExpr, parseTimeExpr };
