// 开机自启逻辑单测：node test/autostart.test.js
const { launchConfig, hasRunEntry, autostartState } = require('../src/autostart');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 启动命令行构造');
{
  const packed = launchConfig({ isPackaged: true, execPath: 'E:\\开源日历\\evestudio-calendar\\开源日历.exe' });
  ok('打包版：exe + --hidden', packed.path.endsWith('开源日历.exe') && packed.args.length === 1 && packed.args[0] === '--hidden', JSON.stringify(packed));

  const dev = launchConfig({ isPackaged: false, execPath: 'C:\\nodejs\\electron.exe', appRoot: 'D:\\工作区\\evestudio-calendar' });
  ok('开发模式：electron.exe + 项目目录 + --hidden',
    dev.path.endsWith('electron.exe') && dev.args[0] === 'D:\\工作区\\evestudio-calendar' && dev.args[1] === '--hidden',
    JSON.stringify(dev));

  const noRoot = launchConfig({ isPackaged: false, execPath: 'e.exe' });
  ok('开发模式缺项目目录时不产生空参数', noRoot.args.length === 1 && noRoot.args[0] === '--hidden');
  ok('空输入安全', launchConfig() && launchConfig().path === '');
}

console.log('\n[2] 注册表 Run 项核对');
{
  const reg = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    OneDrive    REG_SZ    "C:\\Users\\me\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background',
    '    cn.evestudio.calendar    REG_SZ    "E:\\开源日历\\evestudio-calendar\\开源日历.exe" --hidden',
  ].join('\r\n');

  ok('能找到本程序的启动项', hasRunEntry(reg, 'E:\\开源日历\\evestudio-calendar\\开源日历.exe') === true);
  ok('大小写不敏感', hasRunEntry(reg, 'e:\\开源日历\\EVESTUDIO-CALENDAR\\开源日历.EXE') === true);
  ok('引号不影响匹配', hasRunEntry('x REG_SZ "C:\\a b\\app.exe" --hidden', 'C:\\a b\\app.exe') === true);
  ok('别的程序不会被误判', hasRunEntry(reg, 'C:\\other\\MAA.exe') === false);
  ok('空输入返回 false', hasRunEntry('', 'C:\\a.exe') === false && hasRunEntry(reg, '') === false);
}

console.log('\n[3] 状态判定（Electron 判定 + 注册表兜底）');
{
  ok('Electron 认得 → 启用', autostartState({ openAtLogin: true }).enabled === true);
  ok('Electron 不认但注册表有 → 仍判为启用（本次修的 bug）',
    autostartState({ openAtLogin: false, runOutput: '  evestudio  REG_SZ "E:\\开源日历\\evestudio-calendar\\开源日历.exe" --hidden', execPath: 'E:\\开源日历\\evestudio-calendar\\开源日历.exe' }).enabled === true);
  const none = autostartState({ openAtLogin: false, runOutput: '    OneDrive REG_SZ "C:\\OneDrive.exe"', execPath: 'E:\\开源日历\\evestudio-calendar\\开源日历.exe' });
  ok('都没有 → 未启用', none.enabled === false);
  ok('来源标记正确', autostartState({ openAtLogin: true }).source === 'electron' && none.source === 'none');
  ok('空输入安全', autostartState().enabled === false);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
