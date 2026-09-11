// 一句话建任务（中文自然语言解析）单元测试：node test/nlp.test.js
// 基准时间固定为 2026-09-10 14:30（周四），保证结果可重复
const { parseQuickTask, parseDateExpr, parseTimeExpr } = require('../src/nlp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else {
    fail++;
    const tail = extra === undefined ? '' : '  (实际 ' + JSON.stringify(extra.实际) + ' ≠ 期望 ' + JSON.stringify(extra.期望) + ')';
    console.log('  ✘ ' + name + tail);
  }
}
function eq(name, actual, expect) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expect), { 实际: actual, 期望: expect });
}

const NOW = new Date(2026, 8, 10, 14, 30); // 2026-09-10 周四 14:30
const JAN = new Date(2026, 0, 15, 9, 0);   // 2026-01-15 周四 —— 验证「下个月」的月末收敛
const FEB = new Date(2026, 1, 10, 9, 0);   // 2026-02-10 —— 验证 2 月月底
const JAN31 = new Date(2026, 0, 31, 9, 0); // 2026-01-31

const P = (text, now = NOW) => parseQuickTask(text, now);

console.log('\n[1] 日期：相对日');
eq('今天 → 当天', P('今天').date, '2026-09-10');
eq('今日 → 当天', P('今日').date, '2026-09-10');
eq('明天 → 次日', P('明天').date, '2026-09-11');
eq('明日 → 次日', P('明日').date, '2026-09-11');
eq('后天 → 第三天', P('后天').date, '2026-09-12');
eq('大后天 → 第四天（不是「后天」）', P('大后天').date, '2026-09-13');

console.log('\n[2] 日期：星期');
eq('周一 → 下一个周一', P('周一').date, '2026-09-14');
eq('周五 → 明天（周五）', P('周五').date, '2026-09-11');
eq('周四 → 今天（今天就是周四）', P('周四').date, '2026-09-10');
eq('周日 → 下一个周日', P('周日').date, '2026-09-13');
eq('星期日 → 下一个周日', P('星期日').date, '2026-09-13');
eq('星期一 → 下一个周一', P('星期一').date, '2026-09-14');
eq('本周一 → 本周的周一（已过）', P('本周一').date, '2026-09-07');
eq('本周五 → 本周的周五', P('本周五').date, '2026-09-11');
eq('下周一 → 下周的周一', P('下周一').date, '2026-09-14');
eq('下周五 → 下周的周五', P('下周五').date, '2026-09-18');

console.log('\n[3] 日期：具体日期（无年份取未来的那一次）');
eq('10月1日 → 今年（还没到）', P('10月1日').date, '2026-10-01');
eq('10月1号 → 今年（还没到）', P('10月1号').date, '2026-10-01');
eq('10/1 → 今年（还没到）', P('10/1').date, '2026-10-01');
eq('10-1 → 今年（还没到）', P('10-1').date, '2026-10-01');
eq('12月25日 → 今年 12 月', P('12月25日').date, '2026-12-25');
eq('1月1日 → 今年已过，取明年（跨年）', P('1月1日').date, '2027-01-01');
eq('9月1日 → 今年已过，取明年', P('9月1日').date, '2027-09-01');
eq('2026-10-01 → 带年份直读', P('2026-10-01').date, '2026-10-01');
eq('2026/10/01 → 带年份直读', P('2026/10/01').date, '2026-10-01');
eq('2026年10月1日 → 带年份直读', P('2026年10月1日').date, '2026-10-01');

console.log('\n[4] 日期：月底 / 下个月（月末溢出收敛）');
eq('下个月5号 → 10 月 5 日', P('下个月5号').date, '2026-10-05');
eq('月底 → 本月最后一天', P('月底').date, '2026-09-30');
eq('下个月底 → 下月最后一天', P('下个月底').date, '2026-10-31');
eq('下个月5号（1/15 基准）→ 2 月 5 日', P('下个月5号', JAN).date, '2026-02-05');
eq('下个月31号（1/15 基准）→ 收敛到 2/28', P('下个月31号', JAN).date, '2026-02-28');
eq('下个月（1/31 基准）→ 收敛到 2/28', P('下个月', JAN31).date, '2026-02-28');
eq('月底（2 月基准）→ 2/28', P('月底', FEB).date, '2026-02-28');

console.log('\n[5] 时间：数字与全角冒号');
eq('15:00', P('15:00').time, '15:00');
eq('15：00（全角冒号）', P('15：00').time, '15:00');
eq('9:05 → 补零', P('9:05').time, '09:05');
eq('23:59', P('23:59').time, '23:59');
eq('不带时间 → 空串', P('明天开会').time, '');

console.log('\n[6] 时间：中文表达与上下午');
eq('下午3点 → 15:00', P('下午3点').time, '15:00');
eq('晚上8点半 → 20:30', P('晚上8点半').time, '20:30');
eq('早上9点15分 → 09:15', P('早上9点15分').time, '09:15');
eq('上午10点 → 10:00', P('上午10点').time, '10:00');
eq('凌晨1点 → 01:00', P('凌晨1点').time, '01:00');
eq('晚上八点半 → 20:30（中文数字）', P('晚上八点半').time, '20:30');
eq('3点半 → 03:30（无上下午直读 24 小时）', P('3点半').time, '03:30');
eq('3点一刻 → 03:15', P('3点一刻').time, '03:15');
eq('3点45分 → 03:45', P('3点45分').time, '03:45');
eq('3点 → 03:00', P('3点').time, '03:00');
eq('15点 → 15:00', P('15点').time, '15:00');
eq('早上7点整 → 07:00', P('早上7点整').time, '07:00');
eq('下午3:30 → 15:30（冒号 + 上下午）', P('下午3:30').time, '15:30');

console.log('\n[7] 时间：12 点边界');
eq('中午12点 → 12:00', P('中午12点').time, '12:00');
eq('凌晨12点 → 00:00', P('凌晨12点').time, '00:00');
eq('下午12点 → 12:00', P('下午12点').time, '12:00');
eq('晚上12点 → 00:00', P('晚上12点').time, '00:00');
eq('中午12点半 → 12:30', P('中午12点半').time, '12:30');

console.log('\n[8] 提前量（offsetMinutes 单位换算）');
eq('提前10分钟 → 10', P('提前10分钟').reminders, [{ offsetMinutes: 10 }]);
eq('提前30分钟 → 30', P('提前30分钟').reminders, [{ offsetMinutes: 30 }]);
eq('提前半小时 → 30', P('提前半小时').reminders, [{ offsetMinutes: 30 }]);
eq('提前1小时 → 60', P('提前1小时').reminders, [{ offsetMinutes: 60 }]);
eq('提前2个小时 → 120', P('提前2个小时').reminders, [{ offsetMinutes: 120 }]);
eq('提前1天 → 1440', P('提前1天').reminders, [{ offsetMinutes: 1440 }]);
eq('提前一周 → 10080', P('提前一周').reminders, [{ offsetMinutes: 10080 }]);
eq('提前1个星期 → 10080', P('提前1个星期').reminders, [{ offsetMinutes: 10080 }]);
eq('提前1个月 → 43200', P('提前1个月').reminders, [{ offsetMinutes: 43200 }]);
eq('提前十分钟 → 10（中文数字）', P('提前十分钟').reminders, [{ offsetMinutes: 10 }]);
eq('多段提前量按从大到小排序', P('提前1天再提前10分钟').reminders, [{ offsetMinutes: 1440 }, { offsetMinutes: 10 }]);
eq('没有提前量 → 空数组', P('明天开会').reminders, []);
eq('reminders 条目只有 offsetMinutes 字段', Object.keys(P('提前10分钟').reminders[0]), ['offsetMinutes']);

console.log('\n[9] 重复规则');
eq('每天 → daily', P('每天').repeat, 'daily');
eq('每日 → daily', P('每日').repeat, 'daily');
eq('工作日 → weekdays', P('工作日').repeat, 'weekdays');
eq('每个工作日 → weekdays', P('每个工作日').repeat, 'weekdays');
eq('每周 → weekly', P('每周').repeat, 'weekly');
eq('每周三 → weekly', P('每周三').repeat, 'weekly');
eq('每周三 → 日期落在下一个周三', P('每周三').date, '2026-09-16');
eq('每星期天 → weekly', P('每星期天').repeat, 'weekly');
eq('每星期天 → 日期落在下一个周日', P('每星期天').date, '2026-09-13');
eq('每月 → monthly', P('每月').repeat, 'monthly');
eq('每月5号 → monthly', P('每月5号').repeat, 'monthly');
eq('每月5号 → 日期落在下一个 5 号', P('每月5号').date, '2026-10-05');
eq('不写重复 → none', P('明天开会').repeat, 'none');

console.log('\n[10] 组合句（时间 / 日期 / 提前量 / 重复 一起剥掉）');
{
  const r = P('明天下午3点开会提前10分钟');
  eq('  title = 开会', r.title, '开会');
  eq('  date = 明天', r.date, '2026-09-11');
  eq('  time = 15:00', r.time, '15:00');
  eq('  reminders = [10]', r.reminders, [{ offsetMinutes: 10 }]);
  eq('  ok = true', r.ok, true);
}
{
  const r = P('每周一 9:00 站会 提前5分钟');
  eq('  title = 站会', r.title, '站会');
  eq('  repeat = weekly', r.repeat, 'weekly');
  eq('  date = 下一个周一', r.date, '2026-09-14');
  eq('  time = 09:00', r.time, '09:00');
  eq('  reminders = [5]', r.reminders, [{ offsetMinutes: 5 }]);
}
{
  const r = P('10月1日 09:00 国庆出行 提前1天');
  eq('  title = 国庆出行', r.title, '国庆出行');
  eq('  date = 10/1', r.date, '2026-10-01');
  eq('  time = 09:00', r.time, '09:00');
  eq('  reminders = [1440]', r.reminders, [{ offsetMinutes: 1440 }]);
}
{
  const r = P('后天晚上8点半看电影提前30分钟');
  eq('  title = 看电影', r.title, '看电影');
  eq('  date = 后天', r.date, '2026-09-12');
  eq('  time = 20:30', r.time, '20:30');
  eq('  reminders = [30]', r.reminders, [{ offsetMinutes: 30 }]);
}
eq('多余空格被压缩', P('明天   下午3点   开会').title, '开会');
eq('标题保留原有中文与词内空格', P('明天 写 周报').title, '写 周报');
eq('matched 记录日期原文', P('明天下午3点开会').matched.date, '明天');
eq('matched 记录时间原文', P('明天下午3点开会').matched.time, '下午3点');
eq('matched 记录提前量', P('明天下午3点开会提前10分钟').matched.offsets, [10]);
eq('matched 记录重复原文', P('每周一 9:00 站会').matched.repeat, '每周一');

console.log('\n[11] 边界与健壮性');
{
  const r = P('明天下午3点');
  eq('整句只有时间/日期 → ok: true', r.ok, true);
  eq('整句只有时间/日期 → title: ""', r.title, '');
  eq('整句只有时间/日期 → 仍给出日期', r.date, '2026-09-11');
  eq('整句只有时间/日期 → 仍给出时间', r.time, '15:00');
}
{
  const r = P('下午3点');
  eq('只有时间 → title: ""', r.title, '');
  eq('只有时间 → 日期用 now 当天', r.date, '2026-09-10');
}
{
  const r = P('看个电影');
  eq('无法解析 → ok 仍为 true（标题可用）', r.ok, true);
  eq('无法解析 → 原样保留标题', r.title, '看个电影');
  eq('无法解析 → 不崩且无时间', r.time, '');
  eq('无法解析 → 日期用 now 当天', r.date, '2026-09-10');
  eq('无法解析 → 无提前量', r.reminders, []);
}
eq('空串 → ok: false', P('').ok, false);
eq('空串 → title: ""', P('').title, '');
eq('只有空白 → ok: false', P('   ').ok, false);
eq('null 不崩', P(null).ok, false);
eq('undefined 不崩', P(undefined).ok, false);
eq('数字入参不崩', P(123).title, '123');

{
  // 纯函数：不得修改传入的 Date
  const before = NOW.getTime();
  P('明天下午3点开会提前10分钟', NOW);
  parseDateExpr('下个月5号', NOW);
  parseTimeExpr('晚上8点半', NOW);
  eq('传入的 now 未被修改', NOW.getTime(), before);
}

{
  // 「一点」是量词还是时间？
  const r = P('买一点水果');
  eq('「买一点水果」不吞掉「一点」当时间', r.title, '买一点水果');
  eq('「买一点水果」不产生时间', r.time, '');
  eq('带半天词的「下午一点」才是时间', P('下午一点开会').time, '13:00');
  eq('「下午一点开会」标题正确', P('下午一点开会').title, '开会');
}

console.log('\n[12] parseDateExpr / parseTimeExpr（命令面板复用）');
eq('parseDateExpr 返回日期与剩余文本', parseDateExpr('明天下午3点开会', NOW), { date: '2026-09-11', rest: '下午3点开会' });
eq('parseDateExpr 只剥离日期', parseDateExpr('10月1日09:00出门', NOW), { date: '2026-10-01', rest: '09:00出门' });
eq('parseDateExpr 解析不到 → null', parseDateExpr('看个电影', NOW), null);
eq('parseDateExpr 空串 → null', parseDateExpr('', NOW), null);
eq('parseTimeExpr 返回时间与剩余文本', parseTimeExpr('下午3点开会', NOW), { time: '15:00', rest: '开会' });
eq('parseTimeExpr 全角冒号', parseTimeExpr('15：00 例会', NOW), { time: '15:00', rest: '例会' });
eq('parseTimeExpr 解析不到 → null', parseTimeExpr('看个电影', NOW), null);
eq('parseTimeExpr 空串 → null', parseTimeExpr('', NOW), null);
eq('两个函数都只返回约定的字段', Object.keys(parseTimeExpr('3点', NOW)), ['time', 'rest']);

console.log('\n[13] 输出结构');
{
  const r = P('明天下午3点开会提前10分钟');
  eq('parseQuickTask 字段齐全', Object.keys(r), ['ok', 'title', 'date', 'time', 'repeat', 'reminders', 'matched']);
  eq('date 格式为 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(r.date), true);
  eq('time 格式为 HH:mm', /^\d{2}:\d{2}$/.test(r.time), true);
  eq('repeat 取值合法', ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(r.repeat), true);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
