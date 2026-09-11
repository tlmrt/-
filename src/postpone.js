// ============================================================
// 「稍后提醒」延迟队列 —— 纯逻辑，可单测
// 用户在提醒卡片上点「稍后 10 分钟/1 小时」时，把这条提醒推后；
// 主进程每次 tick 调用 duePostponed 取出到点项重新提醒。
// ============================================================

// 允许的延迟档位（分钟）
const POSTPONE_OPTIONS = [5, 10, 30, 60];

// 归一化一个延迟项；非法返回 null
function normalizePostpone(item, now) {
  if (!item || typeof item !== 'object') return null;
  const taskId = typeof item.taskId === 'string' && item.taskId ? item.taskId : null;
  if (!taskId) return null;
  const minutes = Number(item.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const base = Number(item.at);
  const at = Number.isFinite(base) && base > 0
    ? base
    : (Number(now) || Date.now()) + minutes * 60000;
  return {
    taskId,
    minutes,
    at,
    label: typeof item.label === 'string' ? item.label : '',
    count: Number.isFinite(Number(item.count)) ? Number(item.count) : 0,
  };
}

// 取出到点的延迟项：{ due: [...], rest: [...] }（不改动传入数组）
function duePostponed(list, now) {
  const t = Number(now) || Date.now();
  const due = [];
  const rest = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const item = normalizePostpone(raw, t);
    if (!item) continue;
    if (item.at <= t) due.push(item);
    else rest.push(item);
  }
  return { due, rest };
}

// 略过的次数（用于提示"这是第 2 次稍后提醒"）
function bumpCount(item) {
  const n = normalizePostpone(item, Date.now());
  if (!n) return null;
  n.count += 1;
  return n;
}

module.exports = { POSTPONE_OPTIONS, normalizePostpone, duePostponed, bumpCount };
