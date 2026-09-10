// ============================================================
// EveStudio Calendar — 主进程
// 窗口 / 托盘 / 本地数据 / 提醒调度 / IPC
// ============================================================
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { computeAlertsInWindow } = require('./reminder');
const { buildMonthFestivals, festivalMeta, normalizeFestivalPrefs, DEFAULT_FESTIVAL_PREFS } = require('./festivals');

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
const DEFAULT_FESTIVAL_PREFS = { showLunar: true, countries: ['cn'], hidden: [] };
let dayImgMap = {}; // { 'YYYY-MM-DD': fileName } 单日贴纸图
let segments = [];  // 独立时间段 [{id,date,start,end,title,color}]，进行中时该日格子显示液体
let widgetRecs = []; // 桌面小组件 [{id,date,x,y,alwaysOnTop}]
const widgetWins = new Map(); // 小组件 id -> BrowserWindow

const DATA_DIR = () => app.getPath('userData');
const TASKS_FILE = () => path.join(DATA_DIR(), 'tasks.json');
const PREFS_FILE = () => path.join(DATA_DIR(), 'prefs.json');
const DAYIMG_FILE = () => path.join(DATA_DIR(), 'dayimages.json');
const IMG_DIR = () => path.join(DATA_DIR(), 'images');
const PLUGIN_DIR = () => path.join(DATA_DIR(), 'plugins');
const SEG_FILE = () => path.join(DATA_DIR(), 'segments.json');
const WIDGET_FILE = () => path.join(DATA_DIR(), 'widgets.json');

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

// ---------------- 独立时间段 / 桌面小组件：持久化 ----------------
function saveSegments() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(SEG_FILE(), JSON.stringify({ segments }, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存时间段失败', e);
  }
}

function saveWidgets() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(WIDGET_FILE(), JSON.stringify({ widgets: widgetRecs }, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存小组件失败', e);
  }
}

// 某任务在某天是否发生（与渲染层 taskOccursOn 保持一致，供小组件取数）
function taskOccursOnDate(task, dateStr) {
  const rule = task.repeat || 'none';
  if (rule === 'none') return task.date === dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (rule === 'daily') return true;
  if (rule === 'weekdays') { const w = date.getDay(); return w >= 1 && w <= 5; }
  if (rule === 'weekly') {
    const [sy, sm, sd] = task.date.split('-').map(Number);
    return date.getDay() === new Date(sy, sm - 1, sd).getDay();
  }
  if (rule === 'monthly') {
    const day = Number(task.date.split('-')[2]);
    const dim = new Date(y, m, 0).getDate();
    return d === Math.min(day, dim) || d === day;
  }
  return false;
}

// 某天的小组件数据（日期 / 任务 / 时间段）
function widgetDataFor(dateStr) {
  const list = tasks
    .filter((t) => taskOccursOnDate(t, dateStr))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    .map((t) => ({ id: t.id, title: t.title, time: t.time, priority: t.priority, note: t.note }));
  const segs = segments.filter((s) => s.date === dateStr);
  return { date: dateStr, tasks: list, segments: segs };
}

function broadcastToWidgets(channel, payload) {
  for (const w of widgetWins.values()) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
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
  broadcastToWidgets('widget:update');
  return { ok: true, task: { ...t } };
});

ipcMain.handle('tasks:delete', (e, id) => {
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  broadcastToWidgets('widget:update');
  return { ok: true };
});

// ---------------- 节日与农历（计算逻辑在 festivals.js，可单测） ----------------
function festivalPrefs() {
  return normalizeFestivalPrefs(prefs.festivals);
}

ipcMain.handle('festivals:meta', () => {
  const meta = festivalMeta();
  return { ...meta, prefs: festivalPrefs() };
});

ipcMain.handle('festivals:month', (e, { year, month }) => {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) return {};
  return buildMonthFestivals(y, m, festivalPrefs());
});

// ---------------- 独立时间段 ----------------
ipcMain.handle('segments:list', () => segments.map((s) => ({ ...s })));

ipcMain.handle('segments:save', (e, seg) => {
  if (!seg || !seg.date || !seg.start || !seg.end) return { ok: false };
  const item = {
    id: seg.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    date: String(seg.date),
    start: String(seg.start),
    end: String(seg.end),
    title: String(seg.title || ''),
    color: String(seg.color || '#4f6bff'),
  };
  const idx = segments.findIndex((s) => s.id === item.id);
  if (idx >= 0) segments[idx] = item; else segments.push(item);
  saveSegments();
  broadcastToWidgets('widget:update');
  return { ok: true, segment: { ...item } };
});

ipcMain.handle('segments:delete', (e, id) => {
  segments = segments.filter((s) => s.id !== id);
  saveSegments();
  broadcastToWidgets('widget:update');
  return { ok: true };
});

// ---------------- 桌面小组件 ----------------
ipcMain.handle('widget:list', () => widgetRecs.map((r) => ({ ...r })));

ipcMain.handle('widget:create', (e, { date, x, y }) => {
  if (!date) return { ok: false };
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: String(date),
    x: Number.isFinite(x) ? Math.round(x) : undefined,
    y: Number.isFinite(y) ? Math.round(y) : undefined,
    alwaysOnTop: false,
  };
  widgetRecs.push(rec);
  saveWidgets();
  spawnWidgetWin(rec);
  return { ok: true, id: rec.id };
});

ipcMain.handle('widget:data', (e, wid) => {
  const rec = widgetRecs.find((r) => r.id === wid);
  if (!rec) return null;
  return { ...widgetDataFor(rec.date), alwaysOnTop: !!rec.alwaysOnTop };
});

ipcMain.handle('widget:close', (e, wid) => {
  closeWidgetById(wid);
  return { ok: true };
});

ipcMain.handle('widget:toggleTop', (e, wid) => {
  const rec = widgetRecs.find((r) => r.id === wid);
  if (!rec) return { ok: false };
  rec.alwaysOnTop = !rec.alwaysOnTop;
  saveWidgets();
  const w = widgetWins.get(wid);
  if (w && !w.isDestroyed()) w.setAlwaysOnTop(rec.alwaysOnTop);
  return { ok: true, alwaysOnTop: rec.alwaysOnTop };
});

ipcMain.handle('widget:focusMain', (e, wid) => {
  const rec = widgetRecs.find((r) => r.id === wid);
  if (!rec) return { ok: false };
  ensureWindow();
  if (win) win.webContents.send('focus-date', rec.date);
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
// 支持两种写法（都很简单）：
//   ① 单文件插件：plugins/my-plugin.js —— 文件顶部用注释写元数据即可：
//        // @name 我的插件
//        // @version 1.0.0
//        // @description 一句话说明
//   ② 文件夹插件：plugins/my-plugin/plugin.json + renderer.js（适合多文件/带资源的插件）
// 插件脚本在页面加载后注入执行，可使用 window.api（IPC）、window.eveBus（事件总线）、window.eve（便捷 API）

// 解析单文件插件的头部注释元数据（// @key value 或 /* @key value *\/）
function parsePluginHeader(text) {
  const meta = {};
  const head = String(text || '').slice(0, 1500);
  const re = /@(name|version|description|author|renderer)\s+(.+)/g;
  let m;
  while ((m = re.exec(head))) meta[m[1]] = m[2].trim();
  return meta;
}

function pluginEnabled(id) {
  return !(prefs.plugins && prefs.plugins[id] === false); // 默认启用
}

function scanPlugins() {
  const out = [];
  try {
    fs.mkdirSync(PLUGIN_DIR(), { recursive: true });
    const entries = fs.readdirSync(PLUGIN_DIR(), { withFileTypes: true });

    // ① 单文件插件：plugins/*.js
    for (const ent of entries) {
      if (!ent.isFile() || !/\.js$/i.test(ent.name)) continue;
      const abs = path.join(PLUGIN_DIR(), ent.name);
      const id = ent.name.replace(/\.js$/i, '');
      let meta = {};
      try {
        meta = parsePluginHeader(fs.readFileSync(abs, 'utf-8').replace(/^\uFEFF/, ''));
      } catch (e) { /* 读取失败则用文件名兜底 */ }
      out.push({
        id: id,
        name: meta.name || id,
        version: meta.version || '0.1.0',
        description: meta.description || '（单文件插件）',
        author: meta.author || '',
        enabled: pluginEnabled(id),
        single: true,
        rendererUrl: absToFileUrl(abs),
      });
    }

    // ② 文件夹插件：plugins/<id>/plugin.json
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const id = ent.name;
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
          enabled: pluginEnabled(id),
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

ipcMain.handle('plugins:list', () => scanPlugins());
ipcMain.handle('plugins:enable', (e, { id, enabled }) => {
  if (!id) return { ok: false };
  prefs.plugins = { ...(prefs.plugins || {}) };
  prefs.plugins[id] = !!enabled;
  savePrefs();
  return { ok: true };
});

// 一键生成示例插件（单文件），方便照着改
ipcMain.handle('plugins:createDemo', async () => {
  try {
    fs.mkdirSync(PLUGIN_DIR(), { recursive: true });
    const src = path.join(__dirname, '..', 'extras', 'demo-hello.js');
    const dst = path.join(PLUGIN_DIR(), 'demo-hello.js');
    if (!fs.existsSync(src)) return { ok: false, error: '模板文件缺失' };
    fs.copyFileSync(src, dst);
    await shell.openPath(dst);
    return { ok: true, file: dst };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

// 打开插件开发教程（复制一份到插件目录后用系统默认程序打开，方便阅读与修改）
ipcMain.handle('plugins:openGuide', async () => {
  try {
    const src = path.join(__dirname, '..', 'docs', 'PLUGIN_GUIDE.md');
    if (!fs.existsSync(src)) return { ok: false, error: '教程文件缺失' };
    fs.mkdirSync(PLUGIN_DIR(), { recursive: true });
    const dst = path.join(PLUGIN_DIR(), '插件开发教程.md');
    fs.copyFileSync(src, dst);
    await shell.openPath(dst);
    return { ok: true, file: dst };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
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

  // 调试快捷键（菜单栏已移除，这里补上开发者工具与刷新，方便插件开发）
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    if (input.control && input.shift && key === 'i') {
      win.webContents.toggleDevTools();
      ev.preventDefault();
    } else if (input.control && key === 'r') {
      win.webContents.reload();
      ev.preventDefault();
    }
  });

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

// ---------------- 桌面小组件窗口 ----------------
function spawnWidgetWin(rec) {
  if (widgetWins.has(rec.id)) {
    const old = widgetWins.get(rec.id);
    if (old && !old.isDestroyed()) { old.show(); return old; }
  }
  const w = new BrowserWindow({
    width: 232,
    height: 196,
    x: Number.isFinite(rec.x) ? rec.x : undefined,
    y: Number.isFinite(rec.y) ? rec.y : undefined,
    minWidth: 168,
    minHeight: 120,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: !!rec.alwaysOnTop,
    backgroundColor: '#00000000',
    title: '日历小组件',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  widgetWins.set(rec.id, w);
  w.loadFile(path.join(__dirname, 'renderer', 'widget.html'), { query: { wid: rec.id } });

  // 位置持久化（拖动后保存）
  let moveTimer = null;
  w.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      try {
        const b = w.getBounds();
        const r = widgetRecs.find((x) => x.id === rec.id);
        if (r) { r.x = b.x; r.y = b.y; saveWidgets(); }
      } catch (e) { /* noop */ }
    }, 400);
  });

  w.on('closed', () => {
    widgetWins.delete(rec.id);
  });
  return w;
}

function restoreWidgets() {
  for (const rec of widgetRecs) {
    if (rec && rec.id && rec.date) spawnWidgetWin(rec);
  }
}

// 小组件开关（关闭 = 移除并持久化） —— 供 IPC 使用
function closeWidgetById(id) {
  const w = widgetWins.get(id);
  if (w && !w.isDestroyed()) w.close();
  widgetWins.delete(id);
  const before = widgetRecs.length;
  widgetRecs = widgetRecs.filter((r) => r.id !== id);
  if (widgetRecs.length !== before) saveWidgets();
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
  if (!prefs.festivals || typeof prefs.festivals !== 'object') prefs.festivals = { ...DEFAULT_FESTIVAL_PREFS };
  if (!Array.isArray(prefs.festivals.countries) || !prefs.festivals.countries.length) prefs.festivals.countries = ['cn'];
  if (!Array.isArray(prefs.festivals.hidden)) prefs.festivals.hidden = [];
  if (!Array.isArray(tasks)) tasks = [];
  dayImgMap = loadJSON(DAYIMG_FILE(), {});
  if (!dayImgMap || typeof dayImgMap !== 'object' || Array.isArray(dayImgMap)) dayImgMap = {};
  segments = (loadJSON(SEG_FILE(), { segments: [] }).segments) || [];
  if (!Array.isArray(segments)) segments = [];
  widgetRecs = (loadJSON(WIDGET_FILE(), { widgets: [] }).widgets) || [];
  if (!Array.isArray(widgetRecs)) widgetRecs = [];

  createTray();
  // 开机自启（--hidden）时不弹主窗口，只在后台托盘运行并计时提醒；
  // 需要时点托盘图标 / 再次启动应用会唤出窗口
  if (!startHidden) createWindow();
  restoreWidgets(); // 恢复上次留在桌面的小组件

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
