// ============================================================
// 节假日（休息日 / 调休上班日）数据解析与查询 —— 纯逻辑，可单测
//
// 数据格式兼容公开数据集 holiday-cn（每年一份 {year}.json）：
// {
//   "year": 2026,
//   "papers": ["国办发明电〔2025〕xx号"],
//   "days": [
//     { "name": "元旦", "date": "2026-01-01", "isOffDay": true  },  // 放假
//     { "name": "春节", "date": "2026-02-28", "isOffDay": false }   // 调休上班
//   ]
// }
// ============================================================

const DEFAULT_URL_TEMPLATE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json';
const FALLBACK_URL_TEMPLATE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json';

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// 解析单年数据 → { 'YYYY-MM-DD': { type: 'off' | 'work', name } }
function parseYearFile(json) {
  const out = {};
  if (!json || typeof json !== 'object') return out;
  const days = Array.isArray(json.days) ? json.days : [];
  for (const d of days) {
    if (!d || !isValidDate(d.date)) continue;
    out[d.date] = {
      type: d.isOffDay === false ? 'work' : 'off',
      name: typeof d.name === 'string' ? d.name : '',
    };
  }
  return out;
}

// 合并多年地图（后者覆盖前者）
function mergeHolidayMaps(list) {
  const out = {};
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    Object.assign(out, m);
  }
  return out;
}

// 查询某月的休息日/调休日：{ 'YYYY-MM-DD': { type, name } }
function monthHolidays(map, year, month) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  for (const [date, info] of Object.entries(map)) {
    if (date.startsWith(prefix)) out[date] = info;
  }
  return out;
}

// 按模板生成某年数据的下载地址
function urlForYear(template, year) {
  const t = template && typeof template === 'string' && template.includes('{year}')
    ? template
    : DEFAULT_URL_TEMPLATE;
  return t.replace(/\{year\}/g, String(year));
}

// 从地图里筛出覆盖的年份列表
function yearsOf(map) {
  const set = new Set();
  for (const date of Object.keys(map || {})) set.add(Number(date.slice(0, 4)));
  return [...set].sort((a, b) => a - b);
}

module.exports = {
  DEFAULT_URL_TEMPLATE,
  FALLBACK_URL_TEMPLATE,
  parseYearFile,
  mergeHolidayMaps,
  monthHolidays,
  urlForYear,
  yearsOf,
};
