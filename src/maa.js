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
  return {
    exePath: typeof s.exePath === 'string' ? s.exePath : '',
    argsTemplate: typeof s.argsTemplate === 'string' ? s.argsTemplate : '',
    workDir: typeof s.workDir === 'string' ? s.workDir : '',
    autoStartTask: typeof s.autoStartTask === 'string' && s.autoStartTask.trim() ? s.autoStartTask.trim() : '默认',
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

module.exports = { parseArgsString, renderArgs, normalizeMaaPrefs, isRunningFromPid };
