// ============================================================
// 节日与农历计算（纯逻辑，无 electron 依赖，可单测）
// ============================================================
const { Solar } = require('lunar-javascript');
const { COUNTRIES, RULES } = require('./festivals-data');

const DEFAULT_FESTIVAL_PREFS = { showLunar: true, countries: ['cn'], hidden: [] };

function normalizeFestivalPrefs(f) {
  const src = f && typeof f === 'object' ? f : {};
  return {
    showLunar: src.showLunar !== false,
    countries: Array.isArray(src.countries) && src.countries.length ? src.countries : DEFAULT_FESTIVAL_PREFS.countries,
    hidden: Array.isArray(src.hidden) ? src.hidden : [],
  };
}

function ruleMatches(rule, y, m, d, lunar) {
  if (rule.special === 'chuxi') {
    // 除夕 = 农历腊月最后一天（次日为正月初一）
    if (lunar.getMonth() !== 12) return false;
    const next = Solar.fromYmd(y, m, d).next(1).getLunar();
    return next.getMonth() === 1 && next.getDay() === 1;
  }
  if (rule.solarTerm) return lunar.getJieQi() === rule.solarTerm;
  if (rule.lunar) return lunar.getMonth() === rule.lunar[0] && lunar.getDay() === rule.lunar[1];
  if (rule.weekday !== undefined) {
    const dt = new Date(y, m - 1, d);
    return rule.m === m && dt.getDay() === rule.weekday && (Math.floor((d - 1) / 7) + 1) === rule.nth;
  }
  return rule.m === m && rule.d === d;
}

// 某月的节日与农历：{ 'YYYY-MM-DD': { lunar, lunarFull, festivals: [names] } }
function buildMonthFestivals(year, month, festivalPrefs) {
  const fp = normalizeFestivalPrefs(festivalPrefs);
  const out = {};
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const solar = Solar.fromYmd(year, month, d);
    const lunar = solar.getLunar();
    const names = [];
    for (const code of fp.countries) {
      for (const rule of (RULES[code] || [])) {
        if (ruleMatches(rule, year, month, d, lunar)) names.push(rule.name);
      }
    }
    // 中国：并入库内置的农历/公历节日（覆盖面更全，自动去重）
    if (fp.countries.includes('cn')) {
      for (const n of lunar.getFestivals()) names.push(n);
      for (const n of solar.getFestivals()) names.push(n);
    }
    const uniq = [...new Set(names)].filter((n) => !fp.hidden.includes(n));
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const lunarDay = lunar.getDayInChinese();
    const lunarMonthCn = lunar.getMonthInChinese();
    const item = { festivals: uniq };
    if (fp.showLunar) {
      item.lunar = lunarDay === '初一' ? `${lunarMonthCn}月` : lunarDay;
      item.lunarFull = `${lunarMonthCn}月${lunarDay}`;
    }
    out[`${year}-${mm}-${dd}`] = item;
  }
  return out;
}

// 供设置界面使用的元数据
function festivalMeta() {
  const lists = {};
  for (const c of COUNTRIES) {
    lists[c.code] = [...new Set((RULES[c.code] || []).map((r) => r.name))];
  }
  return { countries: COUNTRIES, lists };
}

module.exports = { buildMonthFestivals, festivalMeta, normalizeFestivalPrefs, DEFAULT_FESTIVAL_PREFS };
