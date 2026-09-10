// 提醒引擎单元测试：node test/reminder.test.js
const { computeAlertsInWindow } = require('../src/reminder');
const dayjs = require('dayjs');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}
function eq(name, actual, expect) {
  const a = JSON.stringify(actual), e = JSON.stringify(expect);
  ok(name + (a === e ? '' : `  (实际 ${a} ≠ 期望 ${e})`), a === e);
}

const NOW = Date.now();
const from = NOW - 60 * 1000;
const to = NOW + 15 * 1000;
const mkTask = (over) => Object.assign({
  id: 't1', title: '测试', date: '2026-09-09', time: '09:00',
  repeat: 'none', reminders: [{ id: 'r1', offsetMinutes: 0 }],
}, over);

console.log('\n[1] 单次任务（none）');

{
  // 命中：开始时刻落在当前 tick 窗口
  const target = dayjs(NOW).add(10, 's').startOf('minute');
  const t = mkTask({ date: target.format('YYYY-MM-DD'), time: target.format('HH:mm') });
  const alerts = computeAlertsInWindow(t, from, to);
  eq('到点任务应命中 1 条提醒', alerts.map(a => a.key), [target.format('YYYYMMDDHHmm') + '_0']);
  eq('alertAt 即开始时刻', alerts.length ? alerts[0].alertAt : null, target.valueOf());
}

{
  // 5 分钟前的单次任务不命中（超过补发窗口）
  const past = dayjs(NOW).subtract(5, 'minute');
  const t = mkTask({ date: past.format('YYYY-MM-DD'), time: past.format('HH:mm') });
  const alerts = computeAlertsInWindow(t, from, to);
  eq('过去的任务不应命中', alerts.length, 0);
}

{
  // 90 秒前（超过 60s 补发窗口）不命中
  const past = dayjs(NOW).subtract(90, 's').startOf('minute');
  const t = mkTask({ date: past.format('YYYY-MM-DD'), time: past.format('HH:mm') });
  const alerts = computeAlertsInWindow(t, from, to);
  eq('90 秒前不补发', alerts.length, 0);
}

console.log('\n[2] 每天重复（daily，起始于 300 天前）');

{
  const target = dayjs(NOW).add(10, 's').startOf('minute');
  const start = target.subtract(300, 'day');
  const t = mkTask({ repeat: 'daily', date: start.format('YYYY-MM-DD'), time: start.format('HH:mm') });
  const alerts = computeAlertsInWindow(t, from, to);
  ok('今天命中且只有 1 条', alerts.length === 1);
  eq('key 为今天时刻', alerts.map(a => a.key), [target.format('YYYYMMDDHHmm') + '_0']);
}

console.log('\n[3] 工作日重复（weekdays）');

{
  // 起始日是周六 → 首个工作日应为下周一
  const sat = dayjs(NOW).add(((6 - dayjs(NOW).day() + 7) % 7), 'day').hour(9).minute(0).second(0);
  const mon = sat.add(2, 'day'); // 下周一
  const t = mkTask({ repeat: 'weekdays', date: sat.format('YYYY-MM-DD'), time: '09:00' });
  // 周六当天窗口：不应命中
  const satAlerts = computeAlertsInWindow(t, sat.valueOf() - 1000, sat.valueOf() + 1000);
  eq('周六当天不提醒', satAlerts.length, 0);
  // 下周一 09:00 窗口：命中
  const monAlerts = computeAlertsInWindow(t, mon.valueOf() - 1000, mon.valueOf() + 1000);
  eq('下周一 09:00 命中', monAlerts.map(a => a.key), [mon.format('YYYYMMDDHHmm') + '_0']);
}

console.log('\n[4] 每周重复（weekly，起始于 14 天前）');

{
  const target = dayjs(NOW).add(10, 's').startOf('minute');
  const start = target.subtract(14, 'day'); // 同一星期几
  const t = mkTask({ repeat: 'weekly', date: start.format('YYYY-MM-DD'), time: start.format('HH:mm') });
  const alerts = computeAlertsInWindow(t, from, to);
  eq('本周对应时刻命中', alerts.map(a => a.key), [target.format('YYYYMMDDHHmm') + '_0']);
}

console.log('\n[5] 每月重复（monthly，月末 clamp）');

{
  const t = mkTask({ repeat: 'monthly', date: '2026-01-31', time: '09:00' });
  const feb = dayjs('2026-02-28T09:00:00');
  const a1 = computeAlertsInWindow(t, feb.valueOf() - 1000, feb.valueOf() + 1000);
  eq('1/31 起每月 → 2/28（clamp）命中', a1.map(x => x.key), ['202602280900_0']);

  const apr = dayjs('2026-04-30T09:00:00');
  const a2 = computeAlertsInWindow(t, apr.valueOf() - 1000, apr.valueOf() + 1000);
  eq('4/30（clamp 到 30）命中', a2.map(x => x.key), ['202604300900_0']);

  const may = dayjs('2026-05-31T09:00:00');
  const a3 = computeAlertsInWindow(t, may.valueOf() - 1000, may.valueOf() + 1000);
  eq('5/31（有 31 日）命中', a3.map(x => x.key), ['202605310900_0']);
}

console.log('\n[6] 多条提醒（准时 + 提前10分钟 + 提前1天）');

{
  const target = dayjs('2026-10-15T14:30:00');
  const t = mkTask({
    date: '2026-10-15', time: '14:30',
    reminders: [
      { id: 'a', offsetMinutes: 0 },
      { id: 'b', offsetMinutes: 10 },
      { id: 'c', offsetMinutes: 1440 },
    ],
  });
  // 宽窗口覆盖三条
  const wFrom = dayjs('2026-10-14T10:00:00').valueOf();
  const wTo = dayjs('2026-10-15T15:00:00').valueOf();
  const alerts = computeAlertsInWindow(t, wFrom, wTo);
  eq('三条提醒都生成', alerts.map(a => a.key).sort(), ['202610151430_0', '202610151430_10', '202610151430_1440'].sort());
}

console.log('\n[7] 重复任务 + 提前量（daily 每天 09:00，提前 30 分钟）');

{
  // 任务每天 09:00；某天 08:30 的提醒应在 [08:29:30, 08:30:30] 命中
  const day = dayjs('2026-11-02T08:30:00'); // 周一
  const t = mkTask({
    date: '2020-01-01', time: '09:00', repeat: 'daily',
    reminders: [{ id: 'a', offsetMinutes: 30 }],
  });
  const alerts = computeAlertsInWindow(t, day.valueOf() - 30000, day.valueOf() + 30000);
  eq('11-02 08:30 命中提前提醒', alerts.map(a => a.key), ['202611020900_30']);
}

console.log('\n[8] 提醒动作：弹通知 / 启动 MAA');

{
  const target = dayjs('2026-11-05T09:00:00');
  const t = mkTask({
    date: '2026-11-05', time: '09:00',
    reminders: [
      { id: 'a', offsetMinutes: 0, action: 'notify' },
      { id: 'b', offsetMinutes: 5, action: 'maa' },
    ],
  });
  const alerts = computeAlertsInWindow(t, target.valueOf() - 1000, target.valueOf() + 1000);
  eq('到点只命中通知那条', alerts.map(a => a.action), ['notify']);

  const maaWin = dayjs('2026-11-05T08:55:00');
  const a2 = computeAlertsInWindow(t, maaWin.valueOf() - 1000, maaWin.valueOf() + 1000);
  eq('提前 5 分钟命中 MAA 动作', a2.map(a => a.action), ['maa']);
  eq('MAA 动作 key 带 _maa 后缀', a2.map(a => a.key), ['202611050900_5_maa']);
  eq('通知动作 key 保持原格式', alerts.map(a => a.key), ['202611050900_0']);
}

{
  const target = dayjs('2026-12-01T20:00:00');
  const t = mkTask({
    date: '2026-12-01', time: '20:00',
    reminders: [
      { id: 'a', offsetMinutes: 0, action: 'notify' },
      { id: 'b', offsetMinutes: 0, action: 'maa' },
    ],
  });
  const alerts = computeAlertsInWindow(t, target.valueOf() - 1000, target.valueOf() + 1000);
  eq('同一时刻两种动作各命中一次', alerts.length, 2);
  eq('两者 key 不冲突', new Set(alerts.map(a => a.key)).size, 2);
  const legacy = computeAlertsInWindow(
    mkTask({ date: '2026-12-01', time: '20:00' }),
    target.valueOf() - 1000, target.valueOf() + 1000,
  );
  eq('旧数据（无 action）默认按通知处理', legacy.map(a => a.action), ['notify']);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
