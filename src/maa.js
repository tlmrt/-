// ============================================================
// MAA（MaaAssistantArknights）联动 —— 参数模板与配置归一化（纯逻辑，可单测）
// ============================================================

// 把参数模板字符串切成数组，支持 "双引号" 与 '单引号'
function parseArgsString(s) {
  const str = String(s == null ? '' : s).trim();
  if (!str) return [];
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) { quote = null; } else { cur += ch; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

// 渲染占位符：{task} {date} {time} {title} {id}
function renderArgs(template, vars) {
  const v = vars || {};
  const src = String(template == null ? '' : template);
  const replaced = src.replace(/\{(task|date|time|title|id)\}/g, (_, key) => {
    const val = v[key];
    return val == null ? '' : String(val);
  });
  return parseArgsString(replaced);
}

function normalizeMaaPrefs(p) {
  const s = p && typeof p === 'object' ? p : {};
  const tasks = Array.isArray(s.tasks)
    ? [...new Set(s.tasks.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 40)
    : [];
  const autoStopMin = Number(s.autoStopMin);
  // 日期 → MAA 配置名（不同日子用不同的一键长草配置）
  const dateConfigs = {};
  if (s.dateConfigs && typeof s.dateConfigs === 'object' && !Array.isArray(s.dateConfigs)) {
    for (const [d, name] of Object.entries(s.dateConfigs)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof name === 'string' && name.trim()) {
        dateConfigs[d] = name.trim();
      }
    }
  }
  return {
    exePath: typeof s.exePath === 'string' ? s.exePath : '',
    argsTemplate: typeof s.argsTemplate === 'string' ? s.argsTemplate : '',
    workDir: typeof s.workDir === 'string' ? s.workDir : '',
    autoStartTask: typeof s.autoStartTask === 'string' && s.autoStartTask.trim() ? s.autoStartTask.trim() : '默认',
    tasks, // 可在日历里选择的 MAA 任务名清单
    autoStopMin: Number.isFinite(autoStopMin) && autoStopMin >= 0 ? Math.min(1440, Math.round(autoStopMin)) : 0,
    skipIfRunning: s.skipIfRunning !== false, // 已在运行时不重复启动
    dateConfigs, // { 'YYYY-MM-DD': 'MAA 配置名' }
  };
}

// 归一化任务的 MAA 联动配置
function normalizeTaskMaa(m, fallbackTask) {
  const s = m && typeof m === 'object' ? m : {};
  const task = typeof s.task === 'string' && s.task.trim() ? s.task.trim() : String(fallbackTask || '默认');
  const stop = Number(s.autoStopMin);
  return {
    enabled: !!s.enabled,
    task,
    autoStopMin: Number.isFinite(stop) && stop >= 0 ? Math.min(1440, Math.round(stop)) : 0,
  };
}

// 依据状态判断是否在运行
function isRunningFromPid(pid, aliveCheck) {
  if (!pid) return false;
  try {
    return !!aliveCheck(pid);
  } catch (e) {
    return false;
  }
}

module.exports = { parseArgsString, renderArgs, normalizeMaaPrefs, normalizeTaskMaa, isRunningFromPid };
