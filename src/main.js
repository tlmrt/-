// ============================================================
// EveStudio Calendar — 主进程
// 窗口 / 托盘 / 本地数据 / 提醒调度 / IPC
// ============================================================
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { computeAlertsInWindow } = require('./reminder');

const APP_ID = 'cn.evestudio.calendar';
app.setAppUserModelId(APP_ID);

// ---------------- 单实例锁 ----------------
// 自启 + 手动打开不应同时跑两个进程（否则会双托盘、重复提醒）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    ensureWindow();
  });

// ---------------- 状态 ----------------
let win = null;
let tray = null;
let popupWin = null; // 提醒兜底小窗
let isQuitting = false;
let tasks = []; // 全部任务
let prefs = { weekStart: 1, notifySound: true };
let dayImgMap = {}; // { 'YYYY-MM-DD': fileName } 单日贴纸图

const DATA_DIR = () => app.getPath('userData');
const TASKS_FILE = () => path.join(DATA_DIR(), 'tasks.json');
const PREFS_FILE = () => path.join(DATA_DIR(), 'prefs.json');
const DAYIMG_FILE = () => path.join(DATA_DIR(), 'dayimages.json');
const IMG_DIR = () => path.join(DATA_DIR(), 'images');
const PLUGIN_DIR = () => path.join(DATA_DIR(), 'plugins');

// ---------------- 数据持久化 ----------------
function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      // 剥离 UTF-8 BOM（防止用带 BOM 的编辑器/工具改写文件后解析失败）
      const text = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
      return JSON.parse(text);
    }
  } catch (e) {
    console.error('读取失败', file, e);
  }
  return fallback;
}

function saveTasks() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(TASKS_FILE(), JSON.stringify({ tasks }, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存任务失败', e);
  }
}

function savePrefs() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存偏好失败', e);
  }
}

// ---------------- 提醒调度 ----------------
// 任务模型见 reminder.js。已通知的提醒以 key 记录在 task._notifiedKeys，
// 防止同一提醒重复弹通知。

function cleanupKeys() {
  const cutoff = dayjs().subtract(90, 'day').valueOf();
  let changed = false;
  for (const t of tasks) {
    if (t._notifiedKeys && t._notifiedKeys.length) {
      const keep = t._notifiedKeys.filter((k) => {
        const m = /^(\d{12})_/.exec(k);
        return m && dayjs(m[1], 'YYYYMMDDHHmm').valueOf() >= cutoff;
      });
      if (keep.length !== t._notifiedKeys.length) { t._notifiedKeys = keep; changed = true; }
    }
  }
  if (changed) saveTasks();
}

function tick() {
  const now = Date.now();
  const from = now - 60 * 1000; // 补发窗口：最近 1 分钟（含启动错过）
  const to = now + 15 * 1000;   // 预瞄接下来 15 秒
  const due = [];
  for (const t of tasks) {
    for (const a of computeAlertsInWindow(t, from, to)) {
      if (!(t._notifiedKeys || []).includes(a.key)) {
        due.push(a);
      }
    }
  }
  if (due.length) {
    for (const a of due) {
      const t = a.task;
      t._notifiedKeys = t._notifiedKeys || [];
      t._notifiedKeys.push(a.key);
      fireNotification(t, a);
    }
    saveTasks();
  }
  if (Math.random() < 0.02) cleanupKeys();
}

function fireNotification(task, alert) {
  const nowTxt = dayjs(alert.alertAt).format('MM-DD HH:mm');
  const prioTxt = { high: '高', medium: '中', low: '低' }[task.priority] || '';
  const isRepeat = task.repeat && task.repeat !== 'none';
  const body = task.note
    ? `${nowTxt} · ${task.note}`
    : `${nowTxt} · ${isRepeat ? '重复任务' : '任务到点啦！'}`;

  if (Notification.isSupported()) {
    const n = new Notification({
      title: task.title || '日历提醒',
      body: `${body}${prioTxt ? ' [' + prioTxt + ']' : ''}`,
      silent: !prefs.notifySound,
    });
    n.on('click', () => focusTask(task.id));
    n.on('failed', () => showPopup(task, alert)); // 系统通知失败 → 兜底小窗
    n.show();
    console.log('[notify] fired', task.id, dayjs(alert.alertAt).format('YYYY-MM-DD HH:mm:ss'), task.title);
  }
  // 开发模式（未打包安装）下 Windows 常因应用没有开始菜单快捷方式而静默丢弃 toast，
  // 一律再弹一个置顶兜底小窗，保证提醒可见
  if (!app.isPackaged) showPopup(task, alert);
}

// 提醒兜底：置顶小窗，10 秒后自动消失
function showPopup(task, alert) {
  try { if (popupWin && !popupWin.isDestroyed()) { popupWin.close(); popupWin = null; } } catch (e) { /* noop */ }
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const acc = (prefs.theme && prefs.theme.accent) || '#4f6bff';
  const t = dayjs(alert.alertAt).format('M月D日 HH:mm');
  const prioClr = { high: '#ff5a5f', medium: '#ffa940', low: '#36b37e' }[task.priority] || '#36b37e';
  const prioTxt = { high: '高', medium: '中', low: '低' }[task.priority] || '';
  const isRepeat = task.repeat && task.repeat !== 'none';
  const body = task.note ? esc(task.note) : (isRepeat ? '重复任务' : '任务到点啦！');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;height:100vh;background:#fff;border-top:4px solid ${acc};padding:12px 16px;overflow:hidden}
    .tm{font-size:12px;color:#6b7280;padding-right:54px}.tl{font-size:17px;font-weight:700;color:#1f2430;margin-top:5px;word-break:break-all}.bd{font-size:13px;color:#4b5563;margin-top:7px;max-height:26px;overflow:hidden;text-overflow:ellipsis}
    .pr{position:absolute;right:12px;top:10px;font-size:11px;color:#fff;background:${prioClr};border-radius:20px;padding:2px 9px}
    </style></head><body>
    <div class="tm">${t} · 日历提醒</div>
    <div class="tl">${esc(task.title)}</div>
    <div class="bd">${body}</div>
    <div class="pr">${prioTxt}</div>
    </body></html>`;
  popupWin = new BrowserWindow({
    width: 410,
    height: 120,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    frame: true,
    title: '日历提醒',
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  popupWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  popupWin.once('ready-to-show', () => { popupWin.show(); popupWin.focus(); });
  setTimeout(() => { try { if (popupWin && !popupWin.isDestroyed()) popupWin.close(); } catch (e) { /* noop */ } }, 10000);
  popupWin.on('closed', () => { popupWin = null; });
}

function focusTask(taskId) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('focus-task', taskId);
}

// ---------------- IPC ----------------
function sanitizeTask(input) {
  const t = { ...input };
  delete t._notifiedKeys; // 通知记录由主进程管理
  if (t.reminders && !Array.isArray(t.reminders)) delete t.reminders;
  return t;
}

ipcMain.handle('tasks:list', () => tasks.map((t) => ({ ...t })));

ipcMain.handle('tasks:save', (e, input) => {
  const t = sanitizeTask(input);
  if (!t.id) t.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (!t.reminders || !t.reminders.length) t.reminders = [{ id: 'r_' + Math.random().toString(36).slice(2, 6), offsetMinutes: 0 }];
  t._notifiedKeys = t._notifiedKeys || [];
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx >= 0) {
    const old = tasks[idx];
    // 时间/重复/提醒设置变了 → 清空已通知记录，保证新安排会再次提醒
    const sig = (x) => [x.date, x.time, x.repeat, JSON.stringify(x.reminders || [])].join('|');
    if (sig(old) !== sig(t)) t._notifiedKeys = [];
    tasks[idx] = t;
  } else {
    tasks.push(t);
  }
  saveTasks();
  return { ok: true, task: { ...t } };
});

ipcMain.handle('tasks:delete', (e, id) => {
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  return { ok: true };
});

ipcMain.handle('prefs:get', () => ({ ...prefs }));
ipcMain.handle('prefs:set', (e, patch) => {
  prefs = { ...prefs, ...patch };
  savePrefs();
  return { ok: true, prefs: { ...prefs } };
});

// ---------------- 图片 ----------------
function saveDayImgs() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(DAYIMG_FILE(), JSON.stringify(dayImgMap, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存日期图片失败', e);
  }
}

// 防止路径穿越：只接受 images 目录内的文件名
function safeImageAbs(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  const base = path.basename(fileName);
  const abs = path.join(IMG_DIR(), base);
  return fs.existsSync(abs) ? abs : null;
}

function absToFileUrl(abs) {
  return 'file:///' + abs.replace(/\\/g, '/');
}

ipcMain.handle('img:pick', async () => {
  if (!win) return { ok: false };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  return copyMedia(filePaths[0]);
});

// 背景视频选择（mp4/webm/mov 等，复制进应用数据目录）
ipcMain.handle('vid:pick', async () => {
  if (!win) return { ok: false };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择背景视频',
    properties: ['openFile'],
    filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  return copyMedia(filePaths[0]);
});

// 背景幻灯片：多选图片（一次可多张，追加进列表，最多 100 张由渲染层控制）
ipcMain.handle('imgs:pick', async () => {
  if (!win) return { ok: false, files: [] };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择幻灯片图片（可多选）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (canceled || !filePaths.length) return { ok: false, files: [] };
  const files = [];
  for (const src of filePaths) {
    const r = copyMedia(src);
    if (r && r.ok) files.push({ fileName: r.fileName, url: r.url });
  }
  return { ok: true, files };
});

function copyMedia(src) {
  try {
    const ext = path.extname(src).toLowerCase();
    const fileName = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + ext;
    fs.mkdirSync(IMG_DIR(), { recursive: true });
    fs.copyFileSync(src, path.join(IMG_DIR(), fileName));
    const abs = path.join(IMG_DIR(), fileName);
    return { ok: true, fileName, absPath: abs, url: absToFileUrl(abs) };
  } catch (e) {
    console.error('复制媒体失败', e);
    return { ok: false, error: String(e && e.message) };
  }
}

ipcMain.handle('img:path', (e, fileName) => {
  const abs = safeImageAbs(fileName);
  return abs ? { ok: true, absPath: abs, url: absToFileUrl(abs) } : { ok: false };
});

ipcMain.handle('dayimg:get', () => {
  const out = {};
  for (const [date, fileName] of Object.entries(dayImgMap)) {
    const abs = safeImageAbs(fileName);
    if (abs) out[date] = absToFileUrl(abs);
  }
  return out;
});

ipcMain.handle('dayimg:set', (e, { date, fileName }) => {
  if (!date) return { ok: false };
  if (fileName === null || fileName === undefined || fileName === '') {
    delete dayImgMap[date];
  } else {
    if (!safeImageAbs(fileName)) return { ok: false };
    dayImgMap[date] = path.basename(fileName);
  }
  saveDayImgs();
  return { ok: true };
});

ipcMain.handle('bgimg:set', (e, fileName) => {
  if (fileName === null || fileName === undefined || fileName === '') {
    prefs.theme = { ...(prefs.theme || {}) };
    delete prefs.theme.bgImage;
  } else {
    if (!safeImageAbs(fileName)) return { ok: false };
    prefs.theme = { ...(prefs.theme || {}), bgImage: path.basename(fileName) };
  }
  savePrefs();
  return { ok: true };
});

ipcMain.handle('bgvideo:set', (e, fileName) => {
  if (fileName === null || fileName === undefined || fileName === '') {
    prefs.theme = { ...(prefs.theme || {}) };
    delete prefs.theme.bgVideo;
  } else {
    if (!safeImageAbs(fileName)) return { ok: false };
    prefs.theme = { ...(prefs.theme || {}), bgVideo: path.basename(fileName) };
  }
  savePrefs();
  return { ok: true };
});

// ---------------- 插件（开源扩展口） ----------------
// 插件目录：userData/plugins/<id>/，含 plugin.json（元数据）+ 可选 renderer.js（渲染层脚本）
// 渲染层脚本在页面加载后注入执行，可使用 window.api（IPC）与 window.eveBus（事件总线）

function scanPlugins() {
  const out = [];
  try {
    fs.mkdirSync(PLUGIN_DIR(), { recursive: true });
    const dirs = fs.readdirSync(PLUGIN_DIR(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const id of dirs) {
      const base = path.join(PLUGIN_DIR(), id);
      const metaFile = path.join(base, 'plugin.json');
      if (!fs.existsSync(metaFile)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8').replace(/^\uFEFF/, ''));
        const entry = {
          id: id,
          name: meta.name || id,
          version: meta.version || '0.0.0',
          description: meta.description || '',
          author: meta.author || '',
          enabled: !(prefs.plugins && prefs.plugins[id] === false), // 默认启用
        };
        if (meta.renderer) {
          const abs = path.join(base, meta.renderer);
          if (fs.existsSync(abs)) entry.rendererUrl = absToFileUrl(abs);
        }
        out.push(entry);
      } catch (e) {
        console.error('插件元数据解析失败', id, e);
      }
    }
  } catch (e) {
    console.error('扫描插件失败', e);
  }
  return out;
}

// 首次运行安装示例插件：已移除 —— 默认不装任何插件。
// 想体验插件：把 extras/demo-plugin/ 整个文件夹复制到用户插件目录 plugins/demo-greeting/，重启应用即可。

ipcMain.handle('plugins:list', () => scanPlugins());
ipcMain.handle('plugins:enable', (e, { id, enabled }) => {
  if (!id) return { ok: false };
  prefs.plugins = { ...(prefs.plugins || {}) };
  prefs.plugins[id] = !!enabled;
  savePrefs();
  return { ok: true };
});
ipcMain.handle('plugins:openDir', async () => {
  try {
    fs.mkdirSync(PLUGIN_DIR(), { recursive: true });
    await shell.openPath(PLUGIN_DIR());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

// ---------------- 窗口 / 托盘 ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '日历提醒',
    icon: iconPath(),
    backgroundColor: '#f5f7fb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // 关闭窗口 → 隐藏到托盘（不退出）
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => { win = null; });
}

function iconPath() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png');
  return fs.existsSync(p) ? p : undefined;
}

function createTray() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png');
  let image;
  if (fs.existsSync(p)) {
    image = nativeImage.createFromPath(p);
  } else {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('日历提醒');
  const menu = Menu.buildFromTemplate([
    { label: '打开日历', click: () => ensureWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!win) { ensureWindow(); return; }
    win.isVisible() ? win.hide() : (win.show(), win.focus());
  });
}

// 确保主窗口存在并显示（hidden 自启 / 托盘点击 / 第二实例都会用到）
function ensureWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 开机自启：Windows 注册表启动项（Run），带 --hidden 参数实现后台静默
function applyAutostart(enabled) {
  try {
    if (!app.isPackaged) {
      // 开发模式：注册 electron.exe + 项目路径
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        path: process.execPath,
        args: [path.resolve(__dirname, '..'), '--hidden'],
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        args: ['--hidden'],
      });
    }
    return true;
  } catch (e) {
    console.error('设置开机自启失败', e);
    return false;
  }
}

ipcMain.handle('autostart:get', () => {
  try {
    const s = app.getLoginItemSettings();
    return { enabled: !!(s && s.openAtLogin) };
  } catch (e) {
    return { enabled: false };
  }
});
ipcMain.handle('autostart:set', (e, flag) => ({ ok: applyAutostart(!!flag) }));

// ---------------- 启动 ----------------
const startHidden = process.argv.includes('--hidden');

app.whenReady().then(() => {
  // 去掉默认菜单栏（File Edit View…）
  Menu.setApplicationMenu(null);

  tasks = (loadJSON(TASKS_FILE(), { tasks: [] }).tasks) || [];
  prefs = { weekStart: 1, notifySound: true, ...loadJSON(PREFS_FILE(), {}) };
  if (!Array.isArray(tasks)) tasks = [];
  dayImgMap = loadJSON(DAYIMG_FILE(), {});
  if (!dayImgMap || typeof dayImgMap !== 'object' || Array.isArray(dayImgMap)) dayImgMap = {};

  createTray();
  // 开机自启（--hidden）时不弹主窗口，只在后台托盘运行并计时提醒；
  // 需要时点托盘图标 / 再次启动应用会唤出窗口
  if (!startHidden) createWindow();

  setInterval(tick, 10 * 1000);
  tick(); // 立即跑一次（含启动补发）

  app.on('activate', () => {
    ensureWindow();
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻：不退出
});

app.on('before-quit', () => { isQuitting = true; });

} // 单实例锁 else 块结束
