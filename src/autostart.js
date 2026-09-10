// ============================================================
// 开机自启：启动命令行构造 + 状态判定 —— 纯逻辑，可单测
//
// 为什么需要它：Electron 的 getLoginItemSettings() 在 Windows 上会拿
// 「可执行文件路径 + 参数」去比对注册表 Run 项，**参数对不上就回报未启用**。
// 我们写入时带的是 `开源日历.exe --hidden`，读取时若不传同样的 args，
// 就会永远显示"未勾选"（本次用户遇到的就是这个：注册表里项其实一直在）。
// 所以写入与读取必须共用同一份命令行配置，并额外用注册表原文兜底核对。
// ============================================================

// 生成写入/读取共用的启动命令行配置
// - 打包版：直接是应用 exe + --hidden（后台静默启动）
// - 开发模式：electron.exe + 项目目录 + --hidden
function launchConfig(opts) {
  const o = opts || {};
  const execPath = String(o.execPath || '');
  if (o.isPackaged) return { path: execPath, args: ['--hidden'] };
  const appRoot = String(o.appRoot || '');
  return { path: execPath, args: appRoot ? [appRoot, '--hidden'] : ['--hidden'] };
}

// 注册表 Run 输出里是否存在指向该 exe 的启动项（不区分大小写、容忍引号/斜杠差异）
function hasRunEntry(regOutput, execPath) {
  if (!regOutput || !execPath) return false;
  const norm = (s) => String(s).replace(/["']/g, '').replace(/\\+/g, '\\').toLowerCase();
  const hay = norm(regOutput);
  const needle = norm(execPath);
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  // 兜底：只比对文件名（例如注册表里写的是短路径或 8.3 名称）
  const base = needle.split('\\').pop();
  return !!base && hay.includes(base);
}

// 综合判断当前是否真的会在开机时启动
// source: electron=Electron 自己认得；registry=注册表里有但 Electron 没匹配上；none=没有
function autostartState(opts) {
  const o = opts || {};
  if (o.openAtLogin) return { enabled: true, source: 'electron' };
  if (hasRunEntry(o.runOutput, o.execPath)) return { enabled: true, source: 'registry' };
  return { enabled: false, source: 'none' };
}

module.exports = { launchConfig, hasRunEntry, autostartState };
