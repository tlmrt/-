// MAA 联动参数处理单测：node test/maa.test.js
const { parseArgsString, renderArgs, normalizeMaaPrefs, normalizeTaskMaa, isRunningFromPid } = require('../src/maa');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 参数模板切分');
{
  ok('空格分隔', JSON.stringify(parseArgsString('--task 日常 --minimize')) === '["--task","日常","--minimize"]');
  ok('双引号保留空格', JSON.stringify(parseArgsString('--task "开始唤醒 日常"')) === '["--task","开始唤醒 日常"]');
  ok('单引号同样支持', JSON.stringify(parseArgsString("-task 'a b'")) === '["-task","a b"]');
  ok('多余空格被忽略', parseArgsString('   a    b   ').length === 2);
  ok('空字符串 → 空数组', parseArgsString('').length === 0 && parseArgsString(null).length === 0);
  ok('空引号产生空参数', JSON.stringify(parseArgsString('--x ""')) === '["--x",""]');
}

console.log('\n[2] 占位符渲染');
{
  const vars = { task: '开始唤醒', date: '2026-09-10', time: '22:00', title: '挂机', id: 'abc' };
  ok('替换 {task}', JSON.stringify(renderArgs('--task {task}', vars)) === '["--task","开始唤醒"]');
  ok('多个占位符', JSON.stringify(renderArgs('--run {task} --at {time}', vars)) === '["--run","开始唤醒","--at","22:00"]');
  ok('带引号模板', JSON.stringify(renderArgs('--task "{title}"', vars)) === '["--task","挂机"]');
  ok('未知占位符保留原样', JSON.stringify(renderArgs('--x {unknown}', vars)) === '["--x","{unknown}"]');
  ok('缺变量时省略该参数', JSON.stringify(renderArgs('--task {task}', {})) === '["--task"]');
  ok('空模板 → 空数组', renderArgs('', vars).length === 0);
}

console.log('\n[3] 配置归一化');
{
  const n = normalizeMaaPrefs({ exePath: 'C:/MAA/MAA.exe', argsTemplate: '--task {task}', autoStartTask: '  ' });
  ok('保留 exe 路径', n.exePath === 'C:/MAA/MAA.exe');
  ok('保留参数模板', n.argsTemplate === '--task {task}');
  ok('默认任务名（空值回退）', n.autoStartTask === '默认');
  const d = normalizeMaaPrefs(null);
  ok('空输入给默认值', d.exePath === '' && d.argsTemplate === '' && d.workDir === '');
  ok('任务列表去重去空', JSON.stringify(normalizeMaaPrefs({ tasks: ['A', ' A ', '', 'B', 'B'] }).tasks) === '["A","B"]');
  ok('任务列表上限 40 个', normalizeMaaPrefs({ tasks: Array.from({ length: 60 }, (_, i) => 'T' + i) }).tasks.length === 40);
  ok('自动停止默认 0（不自动停）', normalizeMaaPrefs({}).autoStopMin === 0);
  ok('自动停止上限 1440 分钟', normalizeMaaPrefs({ autoStopMin: 99999 }).autoStopMin === 1440);
  ok('自动停止负数归零', normalizeMaaPrefs({ autoStopMin: -5 }).autoStopMin === 0);
  ok('默认跳过已在运行的 MAA', normalizeMaaPrefs({}).skipIfRunning === true);
  ok('可关闭跳过行为', normalizeMaaPrefs({ skipIfRunning: false }).skipIfRunning === false);
}

console.log('\n[3.5] 任务级 MAA 联动配置');
{
  const t = normalizeTaskMaa({ enabled: true, task: ' 开始唤醒 ', autoStopMin: 30 }, '默认');
  ok('读取任务名并去除空格', t.task === '开始唤醒' && t.enabled === true && t.autoStopMin === 30);
  ok('空任务名回退到默认任务', normalizeTaskMaa({ enabled: true }, '收取信用').task === '收取信用');
  ok('缺省配置为关闭', normalizeTaskMaa(null).enabled === false && normalizeTaskMaa({}).enabled === false);
  ok('自动停止按任务独立设置', normalizeTaskMaa({ enabled: true, autoStopMin: 0 }).autoStopMin === 0);
}

console.log('\n[4] 运行状态判断');{
  ok('无 pid → 未运行', isRunningFromPid(0, () => true) === false);
  ok('pid 存活 → 运行中', isRunningFromPid(1234, () => true) === true);
  ok('pid 不存在 → 未运行', isRunningFromPid(1234, () => { throw new Error('ESRCH'); }) === false);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
