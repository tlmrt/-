// MAA 日志进度解析单测：node test/maalog.test.js
const { parseMaaLog, describeMaaProgress, trimPartialFirstLine } = require('../src/maalog');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

// 真实日志片段（取自用户机器 D:\MAA-v6.16.0-win-x64\debug\gui.log）
const SAMPLE = [
  '[2026-09-12 09:21:25.815][INF][TaskQueueViewModel]     <2> 完成任务: 自动公招',
  '[2026-09-12 09:21:25.815][INF][AsstProxy]              <2> Completed Task Chain: Recruit, Task ID: 4',
  '[2026-09-12 09:21:26.317][INF][TaskQueueViewModel]     <2> 开始任务: 信用收支',
  '[2026-09-12 09:21:26.317][INF][AsstProxy]              <2> Start Task Chain: Mall, Task ID: 5',
  '[2026-09-12 09:22:21.512][INF][TaskQueueViewModel]     <2> 完成任务: 访问好友',
  '[2026-09-12 09:23:12.743][INF][TaskQueueViewModel]     <2> 完成任务: 信用收支',
  '[2026-09-12 09:23:12.744][INF][AsstProxy]              <2> Completed Task Chain: Mall, Task ID: 5',
  '[2026-09-12 09:23:13.280][INF][TaskQueueViewModel]     <2> 开始任务: 领取奖励',
  '[2026-09-12 09:23:13.281][INF][AsstProxy]              <2> Start Task Chain: Award, Task ID: 6',
].join('\n');

const DONE_SAMPLE = [
  '[2026-09-12 09:24:12.302][INF][TaskQueueViewModel]     <2> 开始任务: 更新数据 (仓库识别)',
  '[2026-09-12 09:24:12.302][INF][AsstProxy]              <2> Start Task Chain: Depot, Task ID: 8',
  '[2026-09-12 09:24:24.088][INF][TaskQueueViewModel]     <2> 完成任务: 更新数据 (仓库识别)',
  '[2026-09-12 09:24:24.098][INF][RunningState]           <2> Idle: false to true (called from ProcTaskChainMsg)',
  '[2026-09-12 09:24:24.101][INF][TaskQueueViewModel]     <2> 任务已全部完成！',
  '(用时 0h 23m 13s)',
  '理智将在 2026-09-13 04:36 回满。(19h 11m 后)',
].join('\n');

console.log('\n[1] 解析进行中的任务');
{
  const s = parseMaaLog(SAMPLE);
  ok('当前任务 = 领取奖励', s.currentTask === '领取奖励', JSON.stringify(s));
  ok('记录最近完成的子步骤（访问好友被识别为子步骤）', s.lastDoneTask === '信用收支' && s.lastSubStep === '' || s.lastSubStep === '访问好友', JSON.stringify({ done: s.lastDoneTask, sub: s.lastSubStep }));
  ok('未出现"全部完成"', s.allDone === false);
  ok('Task ID 与链条代码取最近的', s.taskId === 6 && s.chain === 'Award', JSON.stringify({ id: s.taskId, chain: s.chain }));
  ok('末行时间被记录', s.lastDate === '2026-09-12' && s.lastTime === '09:23:13');
}

console.log('\n[2] 子步骤不会被误判成任务完成');
{
  const s = parseMaaLog([
    '[2026-09-12 09:21:26.317][INF][TaskQueueViewModel]     <2> 开始任务: 信用收支',
    '[2026-09-12 09:22:21.512][INF][TaskQueueViewModel]     <2> 完成任务: 访问好友',
  ].join('\n'));
  ok('开始"信用收支"后完成"访问好友"→ 仍在进行', s.currentTask === '信用收支');
  ok('"访问好友"记为 subStep', s.lastSubStep === '访问好友');
}

console.log('\n[3] 全部完成与用时/理智');
{
  const s = parseMaaLog(DONE_SAMPLE);
  ok('识别全部完成', s.allDone === true);
  ok('当前任务清空', s.currentTask === '');
  ok('取到用时', s.elapsedText === '0h 23m 13s', s.elapsedText);
  ok('取到理智回满时间', s.staminaText === '2026-09-13 04:36', s.staminaText);
  ok('识别 Idle 状态', s.idle === true);
}

console.log('\n[4] 新链条开始时重置"全部完成"');
{
  const s = parseMaaLog([
    DONE_SAMPLE,
    '[2026-09-12 10:00:00.000][INF][AsstProxy]              <2> Start Task Chain: Fight, Task ID: 1',
    '[2026-09-12 10:00:00.001][INF][TaskQueueViewModel]     <2> 开始任务: 理智作战',
  ].join('\n'));
  ok('新一轮运行 → allDone 复位', s.allDone === false && s.currentTask === '理智作战', JSON.stringify({ done: s.allDone, cur: s.currentTask }));
  ok('Task ID 更新为 1', s.taskId === 1);
}

console.log('\n[5] 界面文案');
{
  const running = describeMaaProgress(parseMaaLog(SAMPLE), { running: true, logAgeSec: 12 });
  ok('进行中：第一行"正在：X"', running.line1 === '正在：领取奖励', running.line1);
  ok('进行中：tone=running', running.tone === 'running');

  const stale = describeMaaProgress(parseMaaLog(SAMPLE), { running: true, logAgeSec: 900 });
  ok('超 5 分钟无进展 → 提示可能卡住', stale.tone === 'stale' && stale.line2.includes('15 分钟没有新进展'), stale.line2);

  const done = describeMaaProgress(parseMaaLog(DONE_SAMPLE), { running: true, logAgeSec: 5 });
  ok('完成后显示用时与理智', done.tone === 'done' && done.line1.includes('全部完成') && done.line2.includes('0h 23m 13s'), JSON.stringify(done));

  const idle = describeMaaProgress(parseMaaLog(SAMPLE), { running: false });
  ok('未运行 → tone=idle 且无文案', idle.tone === 'idle' && idle.line1 === '');

  const starting = describeMaaProgress({}, { running: true, logAgeSec: 3 });
  ok('刚启动 → 正在启动…', starting.tone === 'starting' && starting.line1.includes('正在启动'));

  const blank = describeMaaProgress(null, {});
  ok('空输入安全', blank.tone === 'idle');
}

console.log('\n[6] 边界');
{
  ok('空文本安全', parseMaaLog('').currentTask === '' && parseMaaLog(null).allDone === false);
  ok('全角冒号也识别', parseMaaLog('开始任务：基建换班').currentTask === '基建换班');
  ok('无时间戳行不影响解析', parseMaaLog('任务已全部完成！').allDone === true);
  ok('截断首行会被丢弃', trimPartialFirstLine('半行乱码\n[TS] 开始任务: X').startsWith('[TS]'));
  ok('单行输入不丢内容', trimPartialFirstLine('任务已全部完成！').includes('全部完成'));
  const s = parseMaaLog('完成任务: 单独完成某任务');
  ok('没有进行中任务时，完成行只记 subStep 不误清空', s.currentTask === '' && s.lastSubStep === '单独完成某任务');
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
