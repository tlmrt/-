// ============================================================
// 解析 MAA 的运行日志，得出"现在进行到哪一步" —— 纯逻辑，可单测
//
// 数据来源：MAA 目录下 debug/gui.log（UTF-8，行格式固定）：
//   [2026-09-12 09:23:13.280][INF][TaskQueueViewModel]  <2> 开始任务: 领取奖励
//   [2026-09-12 09:23:13.281][INF][AsstProxy]           <2> Start Task Chain: Award, Task ID: 6
//   [2026-09-12 09:22:21.512][INF][TaskQueueViewModel]  <2> 完成任务: 访问好友     ← 子步骤
//   [2026-09-12 09:23:34.428][INF][TaskQueueViewModel]  <2> 完成任务: 领取奖励     ← 链条完成
//   [2026-09-12 09:24:24.101][INF][TaskQueueViewModel]  <2> 任务已全部完成！
//   理智将在 2026-09-13 04:36 回满。(19h 11m 后)
// ============================================================

const RE_START = /开始任务[:：]\s*(.+?)\s*$/;
const RE_DONE = /完成任务[:：]\s*(.+?)\s*$/;
const RE_ALL_DONE = /任务已全部完成/;
const RE_ELAPSED = /用时\s*([0-9]+\s*h\s*[0-9]+\s*m\s*[0-9]+\s*s|[0-9]+\s*[hms]\s*(?:[0-9]+\s*[ms]\s*)*(?:[0-9]+\s*s)?)/;
const RE_CHAIN_START = /Start Task Chain:\s*([A-Za-z_]+),\s*Task ID:\s*(\d+)/;
const RE_CHAIN_DONE = /Completed Task Chain:\s*([A-Za-z_]+)/;
const RE_IDLE = /Idle:\s*(\w+)\s*to\s*(\w+)/;
const RE_STAMINA = /理智将在\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*回满/;
const RE_TS = /^\[(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

// 把日志文本解析成进度状态。text 可以是日志尾部的片段（首行允许不完整）。
function parseMaaLog(text) {
  const out = {
    currentTask: '',     // 正在执行的任务（用户配置里的中文名）
    lastSubStep: '',     // 最近完成的子步骤名（如"访问好友"）
    lastDoneTask: '',    // 最近一次完整完成的任务
    allDone: false,      // 出现过"任务已全部完成"
    elapsedText: '',     // 形如 '0h 23m 13s'
    taskId: 0,           // 最近一次 Start Task Chain 的 Task ID
    chain: '',           // 最近一次 Start Task Chain 的代码（Fight/Award…）
    idle: false,         // 最近的 Idle 状态
    staminaText: '',     // 理智回满时间
    lastTime: '',        // 最后一条带时间戳的行的时间（HH:mm:ss）
    lastDate: '',
  };
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const ts = RE_TS.exec(line);
    if (ts) { out.lastDate = ts[1]; out.lastTime = ts[2]; }

    // 链条开始：记下 Task ID 与代码
    const cs = RE_CHAIN_START.exec(line);
    if (cs) {
      out.chain = cs[1];
      out.taskId = Number(cs[2]) || out.taskId;
      out.allDone = false;   // 有新链条开始 → 本次运行重新计数
      continue;
    }
    if (RE_CHAIN_DONE.test(line)) continue;

    // 中文步骤
    const st = RE_START.exec(line);
    if (st) {
      out.currentTask = st[1];
      out.lastSubStep = '';
      out.allDone = false;
      continue;
    }
    const dn = RE_DONE.exec(line);
    if (dn) {
      const name = dn[1];
      if (out.currentTask && name === out.currentTask) {
        out.lastDoneTask = name;
        out.currentTask = '';      // 这个任务做完了
        out.lastSubStep = '';
      } else if (name !== out.currentTask) {
        out.lastSubStep = name;    // 子步骤完成（如"访问好友"）
      }
      continue;
    }

    if (RE_ALL_DONE.test(line)) {
      out.allDone = true;
      out.currentTask = '';
      out.lastSubStep = '';
      const el = RE_ELAPSED.exec(line);
      if (el) out.elapsedText = el[1].replace(/\s+/g, ' ').trim();
      else {
        // "用时" 与耗时可能被换行分开
        const next = lines[i + 1] || '';
        const el2 = RE_ELAPSED.exec(next);
        if (el2) out.elapsedText = el2[1].replace(/\s+/g, ' ').trim();
      }
      continue;
    }

    const idle = RE_IDLE.exec(line);
    if (idle) { out.idle = idle[2] === 'true'; continue; }

    const stam = RE_STAMINA.exec(line);
    if (stam) { out.staminaText = stam[1]; continue; }
  }
  return out;
}

// 生成给界面用的人话描述
// opts: { running, logAgeSec, now }
function describeMaaProgress(state, opts) {
  const s = state || {};
  const o = opts || {};
  const running = !!o.running;
  const age = Number(o.logAgeSec);
  const res = { line1: '', line2: '', tone: 'idle' };

  if (!running) {
    res.tone = 'idle';
    return res;
  }
  if (s.currentTask) {
    res.tone = 'running';
    res.line1 = `正在：${s.currentTask}`;
    const bits = [];
    if (s.lastSubStep) bits.push(`刚完成：${s.lastSubStep}`);
    else if (s.taskId) bits.push(`第 ${s.taskId} 步`);
    if (Number.isFinite(age) && age > 300) {
      bits.push(`已 ${Math.floor(age / 60)} 分钟没有新进展`);
      res.tone = 'stale';
    }
    res.line2 = bits.join(' · ');
    return res;
  }
  if (s.allDone) {
    res.tone = 'done';
    res.line1 = '本次任务已全部完成';
    const bits = [];
    if (s.elapsedText) bits.push(`用时 ${s.elapsedText}`);
    if (s.staminaText) bits.push(`理智 ${s.staminaText.slice(5)} 回满`);
    res.line2 = bits.join(' · ');
    return res;
  }
  if (Number.isFinite(age) && age > 300) {
    res.tone = 'stale';
    res.line1 = 'MAA 在运行，但日志已很久没更新';
    res.line2 = `已 ${Math.floor(age / 60)} 分钟无新进展，可能在等模拟器或已卡住`;
    return res;
  }
  res.tone = 'starting';
  res.line1 = 'MAA 正在启动…';
  res.line2 = '等待任务开始';
  return res;
}

// 从日志文件尾部截取时，去掉可能被截断的首行
function trimPartialFirstLine(text) {
  const s = String(text == null ? '' : text);
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(i + 1) : s;
}

module.exports = { parseMaaLog, describeMaaProgress, trimPartialFirstLine };
