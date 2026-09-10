// 节假日数据解析单测：node test/holidays.test.js
const {
  parseYearFile,
  mergeHolidayMaps,
  monthHolidays,
  urlForYear,
  yearsOf,
  holidaySourceList,
  MIRROR_URL_TEMPLATES,
  DEFAULT_URL_TEMPLATE,
} = require('../src/holidays');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 解析单年数据');
{
  const json = {
    year: 2026,
    papers: ['国办发明电〔2025〕x号'],
    days: [
      { name: '元旦', date: '2026-01-01', isOffDay: true },
      { name: '春节', date: '2026-02-17', isOffDay: true },
      { name: '春节', date: '2026-02-28', isOffDay: false },
      { name: '非法', date: '2026/03/01', isOffDay: true },
      { name: '无日期' },
    ],
  };
  const map = parseYearFile(json);
  ok('放假日记为 off', map['2026-01-01'] && map['2026-01-01'].type === 'off');
  ok('调休上班日记为 work', map['2026-02-28'] && map['2026-02-28'].type === 'work');
  ok('保留节日名称', map['2026-02-17'] && map['2026-02-17'].name === '春节');
  ok('非法 / 缺字段条目被忽略', Object.keys(map).length === 3, JSON.stringify(Object.keys(map)));
  ok('空输入返回空对象', Object.keys(parseYearFile(null)).length === 0 && Object.keys(parseYearFile({})).length === 0);
}

console.log('\n[2] 多年合并（后覆盖前）');
{
  const a = parseYearFile({ days: [{ name: '元旦', date: '2026-01-01', isOffDay: true }] });
  const b = parseYearFile({ days: [{ name: '元旦(修正)', date: '2026-01-01', isOffDay: false }] });
  const merged = mergeHolidayMaps([a, b]);
  ok('同名日期以后者为准', merged['2026-01-01'].type === 'work' && merged['2026-01-01'].name === '元旦(修正)');
  ok('合并忽略空值', Object.keys(mergeHolidayMaps([a, null, undefined])).length === 1);
}

console.log('\n[3] 按月查询');
{
  const map = {
    '2026-01-01': { type: 'off', name: '元旦' },
    '2026-02-17': { type: 'off', name: '春节' },
    '2026-02-28': { type: 'work', name: '春节' },
    '2027-02-06': { type: 'off', name: '春节' },
  };
  const feb = monthHolidays(map, 2026, 2);
  ok('只返回该月条目', Object.keys(feb).length === 2, JSON.stringify(Object.keys(feb)));
  ok('跨年不会混淆', !('2027-02-06' in feb));
  ok('单月查询自动补零', Object.keys(monthHolidays(map, 2026, 1)).length === 1);
  ok('空地图安全', Object.keys(monthHolidays(null, 2026, 2)).length === 0);
}

console.log('\n[4] 下载地址模板');
{
  ok('默认模板替换年份', urlForYear(DEFAULT_URL_TEMPLATE, 2027).includes('2027.json'));
  ok('自定义模板生效', urlForYear('https://example.com/d/{year}.json', 2025) === 'https://example.com/d/2025.json');
  ok('模板非法时回退默认', urlForYear('https://example.com/no-placeholder', 2025).includes('2025'));
}

console.log('\n[5] 覆盖年份统计');
{
  const map = { '2025-10-01': {}, '2026-01-01': {}, '2026-12-31': {}, '2027-05-01': {} };
  ok('去重并升序', JSON.stringify(yearsOf(map)) === JSON.stringify([2025, 2026, 2027]));
  ok('空地图返回空数组', yearsOf(null).length === 0);
}

console.log('\n[6] 多源回退列表（单源抽风也能更新）');
{
  const list = holidaySourceList(DEFAULT_URL_TEMPLATE, 2026);
  ok('首选源排第一', list[0].includes('cdn.jsdelivr.net') && list[0].endsWith('2026.json'), list[0]);
  ok('至少含 3 个候选源', list.length >= 3, String(list.length));
  ok('没有任何重复地址', new Set(list).size === list.length);
  const custom = holidaySourceList('https://example.com/d/{year}.json', 2025);
  ok('自定义模板仍是首选', custom[0] === 'https://example.com/d/2025.json');
  ok('自定义模板仍会带上镜像兜底', custom.length >= 3 && custom.some((u) => u.includes('jsdelivr')));
  ok('模板与镜像相同时不重复追加', holidaySourceList(MIRROR_URL_TEMPLATES[0], 2026).filter((u) => u === MIRROR_URL_TEMPLATES[0].replace('{year}', '2026')).length === 1);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
