// ============================================================
// 免打扰时段（夜间静默）—— 纯逻辑，可单测
// 时段内到点的提醒不弹通知、不响声音，只记入待汇总列表；
// 时段结束后由主进程发一条「夜间有 N 条提醒」的汇总。
// ============================================================

function pad2(n) { return String(n).padStart(2, '0'); }

// '23:05' → 分钟数；非法返回 null
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function toMinutes(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.getHours() * 60 + d.getMinutes();
}

// 归一化设置：{ enabled, start:'HH:mm', end:'HH:mm' }
function normalizeQuiet(q) {
  const o = q && typeof q === 'object' ? q : {};
  const s = parseHHMM(o.start);
  const e = parseHHMM(o.end);
  return {
    enabled: !!o.enabled && s !== null && e !== null && s !== e,
    start: s === null ? '23:00' : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`,
    end: e === null ? '07:00' : `${pad2(Math.floor(e / 60))}:${pad2(e % 60)}`,
  };
}

// 某时刻是否落在免打扰时段内（支持跨夜，例如 23:00 → 07:00）
function inQuietHours(quiet, date) {
  const n = normalizeQuiet(quiet);
  if (!n.enabled) return false;
  const now = toMinutes(date);
  const s = parseHHMM(n.start);
  const e = parseHHMM(n.end);
  if (s === e) return false;         // 起止相同 = 不启用
  if (s < e) return now >= s && now < e; // 同一天内
  return now >= s || now < e;            // 跨午夜
}

// 被静音的提醒汇总文案
function buildQuietSummary(muted) {
  const list = Array.isArray(muted) ? muted.filter(Boolean) : [];
  if (!list.length) return '';
  const head = `免打扰期间有 ${list.length} 条提醒`;
  const lines = list.slice(0, 5).map((m) => {
    const title = (m && m.title) || '未命名任务';
    const at = (m && m.at) || '';
    return at ? `${at} ${title}` : title;
  });
  return head + '：\n' + lines.join('\n') + (list.length > 5 ? `\n…等 ${list.length} 条` : '');
}

module.exports = { parseHHMM, normalizeQuiet, inQuietHours, buildQuietSummary };
