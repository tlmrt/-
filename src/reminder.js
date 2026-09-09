// ============================================================
// 提醒引擎（纯逻辑，无 electron 依赖，可单测）
// ============================================================
const dayjs = require('dayjs');

// 任务模型：
// { id, title, date:'YYYY-MM-DD', time:'HH:mm', repeat:'none|daily|weekdays|weekly|monthly',
//   reminders:[{id, offsetMinutes}] }  // offsetMinutes = 提前多少分钟，0 = 准时
//
// alert 时刻 = occurrence 开始时刻 - offsetMinutes
// 返回 [{ taskId, key, alertAt(ms), title, task }]

function baseMoment(task) {
  const [y, mo, d] = task.date.split('-').map(Number);
  const [hh, mm] = task.time.split(':').map(Number);
  return dayjs(new Date(y, mo - 1, d, hh || 0, mm || 0));
}

function computeAlertsInWindow(task, fromMs, toMs) {
  const out = [];
  const base = baseMoment(task);
  const from = dayjs(fromMs);
  const to = dayjs(toMs);

  const occurrenceCandidates = (lo /*dayjs*/, hi /*dayjs*/) => {
    const res = [];
    const rule = task.repeat || 'none';
    if (rule === 'none') {
      if (base.isAfter(lo.subtract(1, 'millisecond')) && base.isBefore(hi.add(1, 'millisecond'))) res.push(base);
      return res;
    }

    let effBase = base;
    if (rule === 'weekdays') {
      // 若起始日落在周末，重复从下一个工作日开始
      while (effBase.day() === 0 || effBase.day() === 6) effBase = effBase.add(1, 'day');
    }

    if (rule === 'daily' || rule === 'weekdays') {
      let cur = effBase.clone();
      if (cur.isBefore(lo)) {
        const diffDays = Math.ceil(lo.diff(cur, 'day', true));
        cur = cur.add(diffDays, 'day').subtract(1, 'day');
      }
      for (let i = 0; i < 12 && cur.isBefore(hi.add(1, 'day')); i++) {
        if (cur.isBefore(lo)) { cur = cur.add(1, 'day'); continue; }
        if (rule === 'weekdays' && (cur.day() === 0 || cur.day() === 6)) { cur = cur.add(1, 'day'); continue; }
        res.push(cur.clone());
        cur = cur.add(1, 'day');
      }
    } else if (rule === 'weekly') {
      let cur = effBase.clone();
      const diffDays = lo.diff(effBase, 'day', true);
      const n = Math.ceil(diffDays / 7);
      cur = effBase.add(Math.max(0, n - 1) * 7, 'day');
      while (cur.isBefore(lo)) {
        const dd = ((effBase.day() - cur.day()) % 7 + 7) % 7;
        cur = cur.add(dd === 0 ? 7 : dd, 'day');
      }
      for (let i = 0; i < 4 && cur.isBefore(hi.add(1, 'day')); i++) {
        if (cur.isBefore(lo)) { cur = cur.add(7, 'day'); continue; }
        res.push(cur.clone());
        cur = cur.add(7, 'day');
      }
    } else if (rule === 'monthly') {
      const targetDay = effBase.date();
      const startYm = lo.year() * 12 + (lo.month() - 1);
      const endYm = hi.year() * 12 + hi.month();
      for (let ym = Math.max(startYm, effBase.year() * 12 + effBase.month()); ym <= endYm; ym++) {
        const y = Math.floor(ym / 12), m = ym % 12;
        const dim = dayjs(new Date(y, m + 1, 0)).date();
        const dd = Math.min(targetDay, dim);
        const cand = dayjs(new Date(y, m, dd, effBase.hour(), effBase.minute()));
        if (cand.isAfter(effBase.subtract(1, 'day')) && cand.isAfter(lo.subtract(1, 'millisecond')) && cand.isBefore(hi.add(1, 'millisecond'))) {
          res.push(cand);
        }
      }
    }
    return res;
  };

  const reminders = (task.reminders && task.reminders.length ? task.reminders : [{ id: 'r0', offsetMinutes: 0 }]);
  for (const r of reminders) {
    const off = Number(r.offsetMinutes) || 0;
    // alertAt = occ - off 落在 [from,to] ⟺ occ 落在 [from+off, to+off]
    const lo = from.add(off, 'minute');
    const hi = to.add(off, 'minute');
    for (const occ of occurrenceCandidates(lo, hi)) {
      const alertAt = occ.subtract(off, 'minute');
      if (alertAt.isBefore(from) || alertAt.isAfter(to)) continue;
      const key = occ.format('YYYYMMDDHHmm') + '_' + off;
      out.push({ taskId: task.id, key, alertAt: alertAt.valueOf(), title: task.title, task });
    }
  }
  return out;
}

module.exports = { computeAlertsInWindow, baseMoment };
