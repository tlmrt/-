// 数据备份纯逻辑单测：node test/backup.test.js
const {
  BACKUP_FILE_KEYS,
  backupName,
  buildPayload,
  parseBackup,
  pruneList,
  hasBackupToday,
} = require('../src/backup');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

// 固定日期，保证可重复（本地时间 2026-09-10 09:05:03）
const FIXED = new Date(2026, 8, 10, 9, 5, 3);
const FIXED_NAME = 'backup-20260910-090503.json';

const day = (y, m, d, hh, mm, ss) => new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);

console.log('\n[1] 备份文件名生成');
{
  ok('固定时间 → backup-YYYYMMDD-HHmmss.json', backupName(FIXED) === FIXED_NAME, backupName(FIXED));
  ok('月/日/时/分/秒都补零', backupName(day(2026, 1, 2, 3, 4, 5)) === 'backup-20260102-030405.json', backupName(day(2026, 1, 2, 3, 4, 5)));
  ok('年末边界正确', backupName(day(2026, 12, 31, 23, 59, 59)) === 'backup-20261231-235959.json', backupName(day(2026, 12, 31, 23, 59, 59)));
  ok('跨零点（00:00:00）正确', backupName(day(2026, 9, 11, 0, 0, 0)) === 'backup-20260911-000000.json', backupName(day(2026, 9, 11, 0, 0, 0)));
  ok('10 月（两位数月份）不出错', backupName(day(2026, 10, 9, 8, 7, 6)) === 'backup-20261009-080706.json', backupName(day(2026, 10, 9, 8, 7, 6)));
  ok('非法入参不抛异常且仍返回合法名字', /^backup-\d{8}-\d{6}\.json$/.test(backupName('不是日期')));
  ok('无入参时也不抛异常', /^backup-\d{8}-\d{6}\.json$/.test(backupName()));
  ok('生成的名字能被 pruneList 认可为备份', pruneList([backupName(FIXED)], 7).keep.length === 1);
}

console.log('\n[2] 备份内容组装 buildPayload');
{
  const payload = buildPayload({ 'tasks.json': '[{"id":1,"title":"开会"}]', 'prefs.json': '{"theme":"dark"}' }, FIXED);
  ok('app 为「开源日历」', payload.app === '开源日历', payload.app);
  ok('format 为 1', payload.format === 1, String(payload.format));
  ok('at 为 ISO 时间（固定日期）', payload.at === FIXED.toISOString(), payload.at);
  ok('at 形如 2026-09-10T…Z', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.at), payload.at);
  ok('files 保留原始文本', payload.files['tasks.json'] === '[{"id":1,"title":"开会"}]');
  ok('files 里的中文/换行/引号原样保留',
    buildPayload({ 'prefs.json': '{\n  "name": "「开源日历」"\n}' }, FIXED).files['prefs.json'] === '{\n  "name": "「开源日历」"\n}');
  ok('非 .json 键被剔除', buildPayload({ 'tasks.json': '[]', 'notes.txt': 'x' }, FIXED).files['notes.txt'] === undefined);
  ok('无扩展名键被剔除', Object.keys(buildPayload({ 'readme': 'x' }, FIXED).files).length === 0);
  ok('路径穿越键被剔除', buildPayload({ '../evil.json': 'x' }, FIXED).files['../evil.json'] === undefined);
  ok('绝对路径键被剔除', buildPayload({ 'C:\\Windows\\x.json': 'x' }, FIXED).files['C:\\Windows\\x.json'] === undefined);
  ok('非字符串值被剔除', Object.keys(buildPayload({ 'tasks.json': 42, 'prefs.json': { a: 1 }, 'widgets.json': null }, FIXED).files).length === 0);
  ok('空文本 "" 被保留', buildPayload({ 'tasks.json': '' }, FIXED).files['tasks.json'] === '');
  ok('只统计被保留的键', Object.keys(buildPayload({ 'tasks.json': '[]', 'notes.txt': 'x', 'a/b.json': 'x' }, FIXED).files).length === 1);
  ok('空入参安全', Object.keys(buildPayload().files).length === 0 && buildPayload().app === '开源日历');
  ok('数组入参安全（不当成 filesMap）', Object.keys(buildPayload(['tasks.json']).files).length === 0);
  ok('返回对象可 JSON.stringify', typeof JSON.stringify(buildPayload({ 'tasks.json': '[]' }, FIXED)) === 'string');
  ok('BACKUP_FILE_KEYS 是 5 个数据文件',
    Array.isArray(BACKUP_FILE_KEYS) && BACKUP_FILE_KEYS.length === 5 &&
    BACKUP_FILE_KEYS.includes('tasks.json') && BACKUP_FILE_KEYS.includes('prefs.json') &&
    BACKUP_FILE_KEYS.includes('segments.json') && BACKUP_FILE_KEYS.includes('widgets.json') &&
    BACKUP_FILE_KEYS.includes('dayimages.json'),
    JSON.stringify(BACKUP_FILE_KEYS));
  ok('BACKUP_FILE_KEYS 全是 .json 且无重复',
    BACKUP_FILE_KEYS.every((k) => /\.json$/.test(k)) && new Set(BACKUP_FILE_KEYS).size === 5);
}

console.log('\n[3] parseBackup 正常路径');
{
  const src = { 'tasks.json': '[]', 'prefs.json': '{ "theme": "dark" }' };
  const text = JSON.stringify(buildPayload(src, FIXED));

  const fromText = parseBackup(text);
  ok('能解析字符串备份', fromText.ok === true, JSON.stringify(fromText));
  ok('fileCount 正确', fromText.fileCount === 2, String(fromText.fileCount));
  ok('at 正确还原', fromText.at === FIXED.toISOString());
  ok('format 正确还原', fromText.format === 1);
  ok('原始文本一字不改', fromText.files['prefs.json'] === '{ "theme": "dark" }', fromText.files['prefs.json']);

  const fromObj = parseBackup(buildPayload(src, FIXED));
  ok('能解析已解析对象', fromObj.ok === true && fromObj.fileCount === 2);
  ok('对象与字符串两条路结果一致', JSON.stringify(fromObj.files) === JSON.stringify(fromText.files));

  const empty = parseBackup({ app: '开源日历', format: 1, at: 'x', files: { 'tasks.json': '' } });
  ok('空文件文本 "" 被接受并原样保留', empty.ok === true && empty.files['tasks.json'] === '' && empty.fileCount === 1, JSON.stringify(empty));
  ok('空文本不会被误判成"缺失"', parseBackup(JSON.stringify(buildPayload({ 'tasks.json': '' }, FIXED))).ok === true);

  const legacy = parseBackup({ files: { 'tasks.json': '[]' } });
  ok('缺 at 时不报错，at 回退为空串', legacy.ok === true && legacy.at === '');
  ok('缺 format 时按当前格式版本处理', legacy.ok === true && legacy.format === 1);
  ok('键名含 . _ - 的合法备份文件名可通过',
    parseBackup({ files: { 'my-data_v2.backup.json': 'x' } }).files['my-data_v2.backup.json'] === 'x');
  ok('JSON 文本前后有空白也能解析', parseBackup('\n  ' + JSON.stringify(buildPayload(src, FIXED)) + '  \n').ok === true);
}

console.log('\n[4] parseBackup 错误与容错');
{
  const bad = parseBackup('{ 这不是 JSON }');
  ok('非法 JSON → ok:false', bad.ok === false);
  ok('非法 JSON → 有中文错误说明', typeof bad.error === 'string' && /[\u4e00-\u9fa5]/.test(bad.error) && bad.error.length > 6, bad.error);

  ok('空字符串 → ok:false', parseBackup('').ok === false);
  ok('null → ok:false', parseBackup(null).ok === false);
  ok('undefined → ok:false', parseBackup(undefined).ok === false);
  ok('数字 → ok:false', parseBackup(123).ok === false);
  ok('数组 → ok:false', parseBackup([]).ok === false);
  ok('JSON 文本是数组 → ok:false', parseBackup('[1,2,3]').ok === false);
  ok('JSON 文本是字符串字面量 → ok:false', parseBackup('"hello"').ok === false);

  const noFiles = parseBackup({ app: '开源日历', format: 1, at: 'x' });
  ok('缺 files → ok:false', noFiles.ok === false);
  ok('缺 files 的错误说明提到 files', /files/.test(noFiles.error), noFiles.error);

  ok('files 为 null → ok:false', parseBackup({ files: null }).ok === false);
  ok('files 为字符串 → ok:false', parseBackup({ files: 'tasks.json' }).ok === false);
  ok('files 为数组 → ok:false', parseBackup({ files: ['tasks.json'] }).ok === false);

  const mixed = parseBackup({
    app: '开源日历',
    format: 1,
    at: 'x',
    files: { 'tasks.json': 123, 'prefs.json': '{"a":1}', 'widgets.json': null, 'segments.json': ['x'] },
  });
  ok('files 里的非字符串值被安全过滤', mixed.ok === true && mixed.fileCount === 1 && mixed.files['prefs.json'] === '{"a":1}', JSON.stringify(mixed));
  ok('过滤后不留下被过滤的键', mixed.files['tasks.json'] === undefined && mixed.files['widgets.json'] === undefined);

  const nothing = parseBackup({ app: '开源日历', format: 1, files: { 'a.txt': 'x' } });
  ok('过滤后一个都不剩 → ok:false（空备份不可恢复）', nothing.ok === false && /数据文件/.test(nothing.error), nothing.error);

  const alien = parseBackup({ app: '别的应用', format: 1, files: { 'tasks.json': '[]' } });
  ok('别的应用的备份 → ok:false', alien.ok === false);
  ok('别的应用的错误说明提到本应用名', /开源日历/.test(alien.error), alien.error);

  ok('format 不是数字 → ok:false', parseBackup({ format: '1', files: { 'tasks.json': '[]' } }).ok === false);
  const future = parseBackup({ app: '开源日历', format: 99, files: { 'tasks.json': '[]' } });
  ok('format 比当前程序新 → ok:false 并提示升级', future.ok === false && /升级/.test(future.error), future.error);
  ok('format 更旧（0）仍可解析', parseBackup({ format: 0, files: { 'tasks.json': '[]' } }).ok === true);
}

console.log('\n[5] 安全：只接受安全的 .json 文件名');
{
  const evil = {
    app: '开源日历',
    format: 1,
    files: {
      'tasks.json': '好数据',
      '../evil.json': '穿越',
      '..\\evil.json': '穿越',
      '../../prefs.json': '穿越',
      '/etc/passwd.json': '绝对路径',
      '\\\\server\\share\\x.json': 'UNC',
      'C:\\Windows\\System32\\evil.json': '绝对路径',
      'sub/dir/tasks.json': '子目录',
      'sub\\tasks.json': '子目录',
      'tasks.json:ads': 'NTFS 数据流',
      '.hidden.json': '隐藏但安全',
    },
  };
  const r = parseBackup(evil);
  ok('含路径穿越的备份仍能解析（危险键被剔除）', r.ok === true, JSON.stringify(r));
  ok('"../evil.json" 被剔除', r.files['../evil.json'] === undefined);
  ok('"..\\\\evil.json" 被剔除（Windows 分隔符）', r.files['..\\evil.json'] === undefined);
  ok('"../../prefs.json" 被剔除', r.files['../../prefs.json'] === undefined);
  ok('"/etc/passwd.json" 被剔除', r.files['/etc/passwd.json'] === undefined);
  ok('UNC 路径被剔除', r.files['\\\\server\\share\\x.json'] === undefined);
  ok('绝对路径 "C:\\Windows\\…" 被剔除', r.files['C:\\Windows\\System32\\evil.json'] === undefined);
  ok('"sub/dir/tasks.json" 被剔除', r.files['sub/dir/tasks.json'] === undefined);
  ok('"sub\\tasks.json" 被剔除', r.files['sub\\tasks.json'] === undefined);
  ok('NTFS 数据流 "tasks.json:ads" 被剔除', r.files['tasks.json:ads'] === undefined);
  ok('合法的 ".hidden.json" 保留', r.files['.hidden.json'] === '隐藏但安全');
  ok('只留下 2 个合法文件（tasks.json + .hidden.json）', r.fileCount === 2, String(r.fileCount));
  ok('合法数据没被误删', r.files['tasks.json'] === '好数据');
  ok('恢复时的键都不含路径分隔符',
    Object.keys(r.files).every((k) => !/[\\/:]/.test(k)), Object.keys(r.files).join(','));
}

console.log('\n[6] pruneList 保留 / 删除计算');
{
  const names = [
    day(2026, 9, 4, 8, 0, 0), day(2026, 9, 5, 8, 0, 0), day(2026, 9, 6, 8, 0, 0),
    day(2026, 9, 7, 8, 0, 0), day(2026, 9, 8, 8, 0, 0), day(2026, 9, 9, 8, 0, 0),
    day(2026, 9, 10, 9, 5, 3),
  ].map(backupName);

  const under = pruneList(names.slice(0, 5), 7);
  ok('未超量：全部保留', under.keep.length === 5 && under.remove.length === 0, JSON.stringify(under));
  ok('恰好等于 keep：一份都不删', pruneList(names, 7).remove.length === 0);
  ok('未超量时原顺序（升序）保持', JSON.stringify(under.keep) === JSON.stringify(names.slice(0, 5)));

  const ten = names.concat([backupName(day(2026, 9, 11, 8, 0, 0)), backupName(day(2026, 9, 12, 8, 0, 0)), backupName(day(2026, 9, 13, 8, 0, 0))]);
  const over = pruneList(ten, 7);
  ok('超量：keep 为 7 份', over.keep.length === 7, String(over.keep.length));
  ok('超量：remove 为 3 份', over.remove.length === 3, JSON.stringify(over.remove));
  ok('删掉的是最旧的 3 份', JSON.stringify(over.remove) === JSON.stringify(ten.slice(0, 3)), JSON.stringify(over.remove));
  ok('保留的是最新的 7 份', JSON.stringify(over.keep) === JSON.stringify(ten.slice(3)));
  ok('keep 升序（最后一份是最新）', over.keep[over.keep.length - 1] === ten[ten.length - 1]);
  ok('remove 也是升序（先删最旧）', over.remove[0] === ten[0] && over.remove[2] === ten[2]);

  ok('keep 可自定义（keep=3 → 删 7 份）', pruneList(ten, 3).remove.length === 7);
  ok('不传 keep 时默认保留 7 份', pruneList(ten).keep.length === 7 && pruneList(ten).remove.length === 3);
  ok('keep 为非法值（0/-1/"x"/NaN）时退回默认 7',
    pruneList(ten, 0).remove.length === 3 && pruneList(ten, -1).remove.length === 3 &&
    pruneList(ten, 'x').remove.length === 3 && pruneList(ten, NaN).remove.length === 3);

  const sameDay = [backupName(day(2026, 9, 10, 8, 0, 0)), backupName(day(2026, 9, 10, 12, 0, 0)), backupName(day(2026, 9, 10, 23, 59, 59))];
  const same = pruneList(sameDay, 2);
  ok('同一天多份：保留时间最新的', same.keep.length === 2 && same.keep[1] === sameDay[2], JSON.stringify(same));
  ok('同一天多份：删掉当天最早的那份', same.remove[0] === sameDay[0]);
}

console.log('\n[7] pruneList 忽略垃圾文件名');
{
  const garbage = [
    'desktop.ini', 'Thumbs.db', null, undefined, 123, true, {}, [],
    'backup.json', 'backup-20260910.json', 'backup-20260910-0905.json',
    'backup-2026091-090503.json', 'backup-20260910-090503.json.bak',
    'BACKUP-20260910-090503.json', 'backup-20260910-090503.txt',
    'backup-20261340-090503.json', 'backup-20260910-250000.json',
    '备份-20260910-090503.json', './backup-20260910-090503.json',
  ];
  const real = [backupName(day(2026, 9, 9, 8, 0, 0)), backupName(day(2026, 9, 10, 9, 5, 3))];
  const r = pruneList(garbage.concat(real), 7);
  ok('垃圾名字一律被忽略', r.keep.length === 2 && r.remove.length === 0, JSON.stringify(r));
  ok('垃圾名字不会被当成备份保留', r.keep.every((n) => real.includes(n)), JSON.stringify(r.keep));
  ok('形如备份但日期不合法（月13/时25）也被忽略',
    pruneList(['backup-20261340-090503.json', 'backup-20260910-250000.json'], 7).keep.length === 0);
  ok('全是垃圾 → keep/remove 都为空', JSON.stringify(pruneList(garbage, 7)) === JSON.stringify({ keep: [], remove: [] }));
  ok('空数组安全', JSON.stringify(pruneList([], 7)) === JSON.stringify({ keep: [], remove: [] }));
  ok('非法入参（undefined / 非数组）安全',
    pruneList().keep.length === 0 && pruneList('backup-20260910-090503.json').keep.length === 0);
  ok('超量时只按真备份计数', pruneList(garbage.concat(real), 1).remove.length === 1 &&
    pruneList(garbage.concat(real), 1).remove[0] === real[0]);
  ok('不修改传入的数组（纯函数）',
    (() => { const arr = [real[1], 'desktop.ini', real[0]]; const copy = arr.slice(); pruneList(arr, 1); return JSON.stringify(arr) === JSON.stringify(copy); })());
}

console.log('\n[8] hasBackupToday 当天备份判定');
{
  const today = FIXED;                                    // 2026-09-10
  ok('当天已有备份 → true', hasBackupToday([backupName(today)], today) === true);
  ok('同一天不同时刻都算命中',
    hasBackupToday([backupName(day(2026, 9, 10, 0, 0, 0)), backupName(day(2026, 9, 10, 23, 59, 59))], today) === true);
  ok('只有昨天的备份 → false（跨天）', hasBackupToday([backupName(day(2026, 9, 9, 23, 59, 59))], today) === false);
  ok('只有明天的备份 → false（跨天）', hasBackupToday([backupName(day(2026, 9, 11, 0, 0, 0))], today) === false);
  ok('跨月不命中', hasBackupToday([backupName(day(2026, 8, 31, 23, 0, 0))], day(2026, 9, 1, 1, 0, 0)) === false);
  ok('跨年不命中', hasBackupToday([backupName(day(2025, 12, 31, 23, 0, 0))], day(2026, 1, 1, 0, 30, 0)) === false);
  ok('跨年当天命中', hasBackupToday([backupName(day(2026, 1, 1, 0, 30, 0))], day(2026, 1, 1, 9, 0, 0)) === true);
  ok('混着历史备份时仍命中当天', hasBackupToday([backupName(day(2026, 9, 8, 8, 0, 0)), backupName(today)], today) === true);
  ok('空数组 → false', hasBackupToday([], today) === false);
  ok('非数组入参安全', hasBackupToday(null, today) === false && hasBackupToday(undefined, today) === false);
  ok('垃圾名字不算当天备份',
    hasBackupToday(['desktop.ini', null, 123, 'backup-20260910.json', 'backup-20260910-090503.json.bak'], today) === false);
  ok('形如备份但当天日期非法（日 40）不算',
    hasBackupToday(['backup-20260940-090503.json'], today) === false);
  ok('别的天的真备份不算（明确列出一个）',
    hasBackupToday(['backup-20260909-090503.json'], today) === false);
  ok('不传日期时用当前时间（刚生成的备份 → true）', hasBackupToday([backupName()]) === true);
  ok('非法日期入参不抛异常', typeof hasBackupToday([backupName(today)], '不是日期') === 'boolean');
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
