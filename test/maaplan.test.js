// 每周计划（pickDailyPlan / normalizeWeekly）单测：node test/maaplan.test.js
const { normalizeWeekly, pickDailyPlan, normalizeMaaPrefs } = require('../src/maa');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 每周计划归一化');
{
  const w = normalizeWeekly({
    1: { enabled: true, time: '9:05', configName: ' 工作日 ' },
    6: { enabled: false, time: '10:00', configName: '' },
    9: { enabled: true, time: '10:00' },          // 非法星期
    x: { enabled: true, time: '10:00' },          // 非数字键
    2: { enabled: true, time: '不讲理' },          // 非法时间 → ''
  });
  ok('合法项保留并补零', w['1'] && w['1'].time === '09:05' && w['1'].configName === '工作日');
  ok('未启用的项也保留（记住时间）', w['6'] && w['6'].enabled === false && w['6'].time === '10:00');
  ok('非法星期被剔除', !('9' in w) && !('x' in w));
  ok('非法时间归一为空串', w['2'] && w['2'].time === '');
  ok('空输入安全', Object.keys(normalizeWeekly(null)).length === 0 && Object.keys(normalizeWeekly([])).length === 0);
  ok('normalizeMaaPrefs 保留 weekly 字段', (() => {
    const p = normalizeMaaPrefs({ weekly: { 0: { enabled: true, time: '07:30', configName: '周末' } } });
    return p.weekly && p.weekly['0'] && p.weekly['0'].time === '07:30';
  })());
  ok('normalizeMaaPrefs 对非法 weekly 不崩', (() => {
    const p = normalizeMaaPrefs({ weekly: 'x' });
    return p.weekly && Object.keys(p.weekly).length === 0;
  })());
}

console.log('\n[2] 当天用哪套计划');
{
  const weekly = { 6: { enabled: true, time: '10:00', configName: '周末配置' } };
  const global = { dailyEnabled: true, dailyTime: '08:00', configName: '日常配置' };

  const sat = pickDailyPlan(weekly, global, 6);
  ok('周六用每周计划', sat.enabled && sat.time === '10:00' && sat.configName === '周末配置' && sat.source === 'weekly', JSON.stringify(sat));

  const wed = pickDailyPlan(weekly, global, 3);
  ok('周三回落到每天设置', wed.enabled && wed.time === '08:00' && wed.configName === '日常配置' && wed.source === 'global', JSON.stringify(wed));

  const noGlobal = pickDailyPlan(weekly, { dailyEnabled: false, dailyTime: '08:00' }, 3);
  ok('每天未开启且当天没计划 → 不启用', noGlobal.enabled === false && noGlobal.source === 'global');

  const weeklyOff = pickDailyPlan({ 6: { enabled: false, time: '10:00', configName: 'x' } }, global, 6);
  ok('每周计划未勾选时回落', weeklyOff.time === '08:00' && weeklyOff.source === 'global');

  const emptyTime = pickDailyPlan({ 6: { enabled: true, time: '', configName: 'x' } }, global, 6);
  ok('每周计划缺时间时回落', emptyTime.time === '08:00' && emptyTime.source === 'global');

  ok('空输入安全', (() => {
    const r = pickDailyPlan(null, null, 1);
    return r.enabled === false && r.source === 'global' && r.time === '';
  })());
  ok('weekday 用 0=周日', (() => {
    const r = pickDailyPlan({ 0: { enabled: true, time: '06:00', configName: '' } }, global, 0);
    return r.source === 'weekly' && r.weekday === 0;
  })());
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
