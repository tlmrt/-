// 节日与农历引擎单测：node test/festivals.test.js
const { buildMonthFestivals, festivalMeta, normalizeFestivalPrefs } = require('../src/festivals');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
function hasFest(map, date, name) {
  const item = map[date];
  return !!(item && item.festivals && item.festivals.includes(name));
}

console.log('\n[1] 中国节日（默认配置）');
{
  const feb = buildMonthFestivals(2026, 2, { showLunar: true, countries: ['cn'], hidden: [] });
  ok('2026-02-17 是春节', hasFest(feb, '2026-02-17', '春节'));
  ok('2026-02-16 是除夕', hasFest(feb, '2026-02-16', '除夕'));
  ok('春节当天农历为「正月初一」', feb['2026-02-17'].lunarFull === '正月初一', feb['2026-02-17'].lunarFull);

  const sep = buildMonthFestivals(2026, 9, { showLunar: true, countries: ['cn'], hidden: [] });
  ok('2026-09-25 是中秋节', hasFest(sep, '2026-09-25', '中秋节'));

  const oct = buildMonthFestivals(2026, 10, { showLunar: true, countries: ['cn'], hidden: [] });
  ok('2026-10-01 是国庆节', hasFest(oct, '2026-10-01', '国庆节'));

  const jun = buildMonthFestivals(2026, 6, { showLunar: true, countries: ['cn'], hidden: [] });
  ok('2026-06-19 是端午节', hasFest(jun, '2026-06-19', '端午节'), JSON.stringify(jun['2026-06-19']));

  const apr = buildMonthFestivals(2026, 4, { showLunar: true, countries: ['cn'], hidden: [] });
  ok('2026-04-05 是清明节（节气）', hasFest(apr, '2026-04-05', '清明节'), JSON.stringify(apr['2026-04-05']));
}

console.log('\n[2] 浮动的星期类节日（第 n 个星期 X）');
{
  const us = buildMonthFestivals(2026, 11, { showLunar: false, countries: ['us'], hidden: [] });
  ok('2026-11-26 是感恩节（11 月第 4 个周四）', hasFest(us, '2026-11-26', '感恩节'), JSON.stringify(us['2026-11-26']));
  ok('2026-11-05 不是感恩节', !hasFest(us, '2026-11-05', '感恩节'));
  const us1 = buildMonthFestivals(2026, 1, { showLunar: false, countries: ['us'], hidden: [] });
  ok('2026-01-19 是马丁·路德·金日（第 3 个周一）', hasFest(us1, '2026-01-19', '马丁·路德·金日'), JSON.stringify(us1['2026-01-19']));

  const jp = buildMonthFestivals(2026, 1, { showLunar: false, countries: ['jp'], hidden: [] });
  ok('2026-01-12 是日本成人日（第 2 个周一）', hasFest(jp, '2026-01-12', '成人日'), JSON.stringify(jp['2026-01-12']));
}

console.log('\n[3] 多国同时启用 + 去重');
{
  const both = buildMonthFestivals(2026, 12, { showLunar: true, countries: ['cn', 'us', 'uk'], hidden: [] });
  const xmas = both['2026-12-25'];
  const count = xmas.festivals.filter((n) => n === '圣诞节').length;
  ok('圣诞节在多国规则下只出现一次', count === 1, JSON.stringify(xmas.festivals));
  ok('12-24 平安夜也在', xmas.festivals.length >= 1 && both['2026-12-24'].festivals.includes('平安夜'));
}

console.log('\n[4] 单个节日隐藏 与 农历开关');
{
  const hidden = buildMonthFestivals(2026, 10, { showLunar: true, countries: ['cn'], hidden: ['国庆节', '中秋节'] });
  ok('隐藏后当天不再出现国庆节', !hasFest(hidden, '2026-10-01', '国庆节'), JSON.stringify(hidden['2026-10-01'].festivals));
  ok('隐藏不影响其它日期', hasFest(hidden, '2026-10-01', '国庆节') === false);

  const noLunar = buildMonthFestivals(2026, 10, { showLunar: false, countries: ['cn'], hidden: [] });
  ok('关闭农历后不返回 lunar 字段', noLunar['2026-10-01'].lunar === undefined && noLunar['2026-10-01'].lunarFull === undefined);
}

console.log('\n[5] 元数据与配置归一化');
{
  const meta = festivalMeta();
  ok('包含 6 个国家 / 地区', meta.countries.length === 6, JSON.stringify(meta.countries.map((c) => c.code)));
  ok('中国节日清单非空', (meta.lists.cn || []).length > 10);

  const n1 = normalizeFestivalPrefs(null);
  ok('缺省配置为中国 + 显示农历', n1.countries[0] === 'cn' && n1.showLunar === true);
  const n2 = normalizeFestivalPrefs({ countries: [] });
  ok('国家列表为空时回退为默认', n2.countries.length === 1 && n2.countries[0] === 'cn');
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
