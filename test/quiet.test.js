// 免打扰时段单测：node test/quiet.test.js
const { parseHHMM, normalizeQuiet, inQuietHours, buildQuietSummary } = require('../src/quiet');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
const at = (h, m) => new Date(2026, 8, 10, h, m, 0);

console.log('\n[1] 时间解析');
{
  ok('正常解析', parseHHMM('23:05') === 23 * 60 + 5);
  ok('单位数小时', parseHHMM('7:30') === 7 * 60 + 30);
  ok('前后空格', parseHHMM('  08:00 ') === 480);
  ok('非法返回 null', parseHHMM('24:00') === null && parseHHMM('12:60') === null
    && parseHHMM('abc') === null && parseHHMM('') === null && parseHHMM(null) === null);
}

console.log('\n[2] 设置归一化');
{
  const n = normalizeQuiet({ enabled: true, start: '23:00', end: '7:00' });
  ok('补零', n.start === '23:00' && n.end === '07:00' && n.enabled === true);
  ok('默认值', (() => { const d = normalizeQuiet(); return d.start === '23:00' && d.end === '07:00' && d.enabled === false; })());
  ok('非法时间回退默认且不启用', (() => { const d = normalizeQuiet({ enabled: true, start: 'x', end: '07:00' }); return d.enabled === false && d.start === '23:00'; })());
  ok('起止相同视为不启用', normalizeQuiet({ enabled: true, start: '08:00', end: '08:00' }).enabled === false);
}

console.log('\n[3] 是否在免打扰时段内');
{
  const cross = { enabled: true, start: '23:00', end: '07:00' };
  ok('跨夜：23:30 在内', inQuietHours(cross, at(23, 30)) === true);
  ok('跨夜：02:00 在内', inQuietHours(cross, at(2, 0)) === true);
  ok('跨夜：07:00 出界（右开）', inQuietHours(cross, at(7, 0)) === false);
  ok('跨夜：22:59 不在内', inQuietHours(cross, at(22, 59)) === false);
  ok('跨夜：23:00 正好在内', inQuietHours(cross, at(23, 0)) === true);

  const same = { enabled: true, start: '12:00', end: '14:00' };
  ok('同日：13:00 在内', inQuietHours(same, at(13, 0)) === true);
  ok('同日：12:00 在内、14:00 出界', inQuietHours(same, at(12, 0)) === true && inQuietHours(same, at(14, 0)) === false);
  ok('同日：11:59 不在内', inQuietHours(same, at(11, 59)) === false);

  ok('未启用时永远不在内', inQuietHours({ enabled: false, start: '00:00', end: '23:59' }, at(12, 0)) === false);
  ok('空设置安全', inQuietHours(null, at(3, 0)) === false);
  ok('支持传时间戳', inQuietHours(cross, at(1, 0).getTime()) === true);
}

console.log('\n[4] 汇总文案');
{
  const s = buildQuietSummary([
    { title: '睡觉', at: '09-10 23:30' },
    { title: '吃药', at: '09-11 06:30' },
  ]);
  ok('包含条数与标题', s.includes('2 条提醒') && s.includes('睡觉') && s.includes('吃药'), s);
  ok('空列表返回空串', buildQuietSummary([]) === '' && buildQuietSummary(null) === '');
  ok('超过 5 条有省略提示', (() => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: 'T' + i, at: '09-11 0' + (i % 9) + ':00' }));
    const t = buildQuietSummary(many);
    return t.includes('8 条提醒') && t.includes('等 8 条');
  })());
  ok('缺字段不崩', buildQuietSummary([{}, null]).includes('未命名任务'));
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
