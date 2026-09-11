// 「稍后提醒」延迟队列单测：node test/postpone.test.js
const { POSTPONE_OPTIONS, normalizePostpone, duePostponed, bumpCount } = require('../src/postpone');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

const T0 = new Date(2026, 8, 10, 14, 30, 0).getTime();

console.log('\n[1] 延迟项归一化');
{
  const a = normalizePostpone({ taskId: 't1', minutes: 10 }, T0);
  ok('缺 at 时按 now+minutes 计算', a && a.at === T0 + 10 * 60000, JSON.stringify(a));
  ok('保留 label 与 count 默认 0', a && a.label === '' && a.count === 0);
  const b = normalizePostpone({ taskId: 't1', minutes: 5, at: T0 + 1000, label: '稍后', count: 2 }, T0);
  ok('已有 at 时原样保留', b && b.at === T0 + 1000 && b.label === '稍后' && b.count === 2);
  ok('缺 taskId 返回 null', normalizePostpone({ minutes: 10 }, T0) === null);
  ok('分钟非法返回 null', normalizePostpone({ taskId: 't1', minutes: 0 }, T0) === null
    && normalizePostpone({ taskId: 't1', minutes: -3 }, T0) === null
    && normalizePostpone({ taskId: 't1', minutes: 'x' }, T0) === null);
  ok('空值与垃圾输入安全', normalizePostpone(null, T0) === null && normalizePostpone('x', T0) === null);
  ok('档位常量包含 5/10/30/60', POSTPONE_OPTIONS.join(',') === '5,10,30,60');
}

console.log('\n[2] 到点判断');
{
  const list = [
    { taskId: 'a', minutes: 10, at: T0 - 1000 },   // 已到点
    { taskId: 'b', minutes: 10, at: T0 },          // 正好到点
    { taskId: 'c', minutes: 10, at: T0 + 1 },      // 未到
    { taskId: 'd', minutes: 10, at: T0 + 600000 },
  ];
  const { due, rest } = duePostponed(list, T0);
  ok('到点的进 due', due.length === 2 && due[0].taskId === 'a' && due[1].taskId === 'b');
  ok('未到点的留在 rest', rest.length === 2 && rest[0].taskId === 'c');
  ok('不改动原数组', list.length === 4);
  ok('缺 at 的项按 minutes 重算（未到点）', (() => {
    const r = duePostponed([{ taskId: 'x', minutes: 10 }], T0);
    return r.due.length === 0 && r.rest.length === 1 && r.rest[0].at === T0 + 600000;
  })());
  ok('过滤非法项', (() => {
    const r = duePostponed([null, 'x', { minutes: 5 }, { taskId: 'y', minutes: 5, at: T0 - 1 }], T0);
    return r.due.length === 1 && r.due[0].taskId === 'y' && r.rest.length === 0;
  })());
  ok('空输入安全', (() => {
    const r = duePostponed(null, T0);
    return r.due.length === 0 && r.rest.length === 0;
  })());
  ok('now 缺省也能跑', (() => {
    const r = duePostponed([{ taskId: 'z', minutes: 1, at: Date.now() - 10 }], undefined);
    return r.due.length === 1;
  })());
}

console.log('\n[3] 次数累加');
{
  const one = bumpCount({ taskId: 't', minutes: 10, at: T0, count: 0 });
  ok('count 累加', one && one.count === 1);
  const two = bumpCount(one);
  ok('再次累加', two && two.count === 2);
  ok('非法项返回 null', bumpCount(null) === null);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
