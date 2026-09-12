// ============================================================
// EveStudio Calendar — 主进程
// 窗口 / 托盘 / 本地数据 / 提醒调度 / IPC
// ============================================================
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const dayjs = require('dayjs');
const { computeAlertsInWindow } = require('./reminder');
const { buildMonthFestivals, festivalMeta, normalizeFestivalPrefs, DEFAULT_FESTIVAL_PREFS } = require('./festivals');
const {
  DEFAULT_URL_TEMPLATE: HOLIDAY_URL,
  parseYearFile,
  mergeHolidayMaps,
  monthHolidays,
  yearsOf,
  holidaySourceList,
} = require('./holidays');
const { parseRelease, shouldNotify, errText, describeNetError } = require('./updater');
const { launchConfig, autostartState } = require('./autostart');
const { POSTPONE_OPTIONS, normalizePostpone, duePostponed } = require('./postpone');
const { backupName, buildPayload, parseBackup, pruneList, hasBackupToday, BACKUP_FILE_KEYS } = require('./backup');
const { normalizeQuiet, inQuietHours, buildQuietSummary } = require('./quiet');
const { parseMaaLog, describeMaaProgress, trimPartialFirstLine } = require('./maalog');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { matchRoute, checkToken, extractToken, parseQuery } = require('./localapi');
const { renderArgs, normalizeMaaPrefs, normalizeTaskMaa, pickDailyPlan } = require('./maa');
const { buildEditableQueue, applyTaskPatch } = require('./maaconfig');

// ---------------- 诊断日志（最近 100 条 warn/error，供「诊断信息」面板查看） ----------------
const diagLog = [];
const APP_STARTED_AT = Date.now();
const __origError = console.error.bind(console);
const __origWarn = console.warn.bind(console);
function pushDiag(level, args) {
  try {
    const text = args.map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
    diagLog.push(`[${new Date().toLocaleTimeString()}] ${level}: ${text}`.slice(0, 400));
    if (diagLog.length > 100) diagLog.shift();
  } catch (e) { /* 忽略 */ }
}
console.error = (...args) => { pushDiag('ERROR', args); __origError(...args); };
console.warn = (...args) => { pushDiag('WARN', args); __origWarn(...args); };

const APP_ID = 'cn.evestudio.calendar';
// 只在打包版设置 AppUserModelID：
// 开发模式（electron .）下设置它会让 Electron 自动往开始菜单写一个「Electron」快捷方式，
// 用户若固定了那一个，打开后任务栏会显示 electron 而不是「开源日历」。
if (app.isPackaged) app.setAppUserModelId(APP_ID);
// 显示名改为「开源日历」，但内部名保持 evestudio-calendar 不变，
// 以确保用户数据目录（%APPDATA%\evestudio-calendar）在改名前后一致、数据不丢
app.setName('evestudio-calendar');
// 允许带声音的媒体自动播放：背景视频开启"播放视频声音"后，重启应用也能直接出声
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
let holidaysMap = {}; // 休息日/调休日 { 'YYYY-MM-DD': { type:'off'|'work', name } }
const widgetWins = new Map(); // 小组件 id -> BrowserWindow

const DATA_DIR = () => app.getPath('userData');
const TASKS_FILE = () => path.join(DATA_DIR(), 'tasks.json');
const PREFS_FILE = () => path.join(DATA_DIR(), 'prefs.json');
const DAYIMG_FILE = () => path.join(DATA_DIR(), 'dayimages.json');
const IMG_DIR = () => path.join(DATA_DIR(), 'images');
const PLUGIN_DIR = () => path.join(DATA_DIR(), 'plugins');
const SEG_FILE = () => path.join(DATA_DIR(), 'segments.json');
const WIDGET_FILE = () => path.join(DATA_DIR(), 'widgets.json');
const SOUND_DIR = () => path.join(DATA_DIR(), 'sounds');
const HOLIDAY_DIR = () => path.join(DATA_DIR(), 'holidays');
const UPDATE_DIR = () => path.join(DATA_DIR(), 'updates');

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
  rebuildSegmentsFromTasks(); // 时间段已并入任务，这里同步派生视图
}

function savePrefs() {
  try {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存偏好失败', e);
  }
}

// ---------------- 时间段（已并入任务：segment:true 的任务即为时间段） ----------------
// segments 现在是「从任务派生的内存视图」：渲染层（日历液体、周视图、小组件）仍然按老结构读取，
// 但数据源只有 tasks 一处，不再有独立的 segments.json。
function hhmmOf(v, fb) {
  return /^\d{1,2}:\d{2}$/.test(String(v == null ? '' : v).trim())
    ? String(v).trim().padStart(5, '0')
    : fb;
}

function rebuildSegmentsFromTasks() {
  const acc = (prefs.theme && prefs.theme.accent) || '#4f6bff';
  segments = tasks
    .filter((t) => t && t.segment === true && t.date && t.time && t.endTime)
    .map((t) => ({
      id: t.id,
      date: t.date,
      start: t.time,
      end: t.endTime,
      title: t.title || '',
      color: /^#[0-9a-fA-F]{6}$/.test(String(t.color || '')) ? t.color : acc,
    }));
  return segments.length;
}

// 老数据迁移：把独立的 segments.json 转成「时间段任务」（只做一次，旧文件改名留底）
function migrateSegmentsToTasks() {
  try {
    if (!fs.existsSync(SEG_FILE())) return { migrated: 0 };
    const raw = loadJSON(SEG_FILE(), { segments: [] });
    const old = Array.isArray(raw && raw.segments) ? raw.segments : [];
    let n = 0;
    for (const s of old) {
      if (!s || !s.date || !s.start) continue;
      const id = 'seg_' + (s.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
      if (tasks.some((t) => t.id === id)) continue;
      tasks.push({
        id,
        title: String(s.title || '时间段'),
        date: String(s.date),
        time: hhmmOf(s.start, '09:00'),
        endTime: hhmmOf(s.end, hhmmOf(s.start, '09:00')),
        segment: true,
        color: /^#[0-9a-fA-F]{6}$/.test(String(s.color || '')) ? s.color : '',
        repeat: 'none',
        priority: 'medium',
        tags: [],
        note: '',
        reminders: [],
        _notifiedKeys: [],
      });
      n += 1;
    }
    if (n) {
      saveTasks(); // 顺带重建派生视图
      console.log(`[migrate] 已把 ${n} 个独立时间段转成「时间段任务」`);
    }
    try { fs.renameSync(SEG_FILE(), SEG_FILE() + '.migrated.bak'); } catch (e) { /* 留底失败不影响 */ }
    return { migrated: n };
  } catch (e) {
    console.error('[migrate] 时间段迁移失败', e);
    return { migrated: 0, error: String(e && e.message ? e.message : e) };
  }
}

// 把一条时间段任务写进 tasks（供本地接口 /api/segments 复用）
function upsertSegmentTask(seg) {
  if (!seg || !seg.date || !seg.start) return { ok: false, error: '缺少日期或开始时间' };
  const id = seg.id && tasks.some((t) => t.id === seg.id)
    ? seg.id
    : (seg.id || ('seg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
  const endTime = hhmmOf(seg.end, hhmmOf(seg.start, '09:00'));
  const existing = tasks.find((t) => t.id === id);
  const base = existing || {
    id,
    repeat: 'none',
    priority: 'medium',
    tags: [],
    note: '',
    reminders: [],
    _notifiedKeys: [],
  };
  const item = sanitizeTask({
    ...base,
    id,
    title: String(seg.title || base.title || '时间段'),
    date: String(seg.date),
    time: hhmmOf(seg.start, '09:00'),
    endTime,
    segment: true,
    color: seg.color || base.color || '',
  });
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) tasks[idx] = item; else tasks.push(item);
  saveTasks();
  broadcastToWidgets('widget:update');
  return { ok: true, segment: { id, date: item.date, start: item.time, end: item.endTime, title: item.title, color: item.color } };
}

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
      if (a.action === 'maa') {
        // 提醒项的动作是"启动 MAA"：不弹通知，直接拉起 MAA
        maybeStartMaaForTask(t, { force: true });
      } else {
        fireNotification(t, a);
      }
    }
    saveTasks();
  }
  if (Math.random() < 0.02) cleanupKeys();
  checkPostponed();   // 「稍后提醒」到点重发
  checkMaaFinished(); // MAA 跑完发通知
  checkQuietEnd();    // 免打扰结束后的汇总
  checkMorningBrief(); // 每日早报
}

// ---------------- 免打扰时段 ----------------
let quietBuffer = [];      // 免打扰期间被静音的提醒
let quietWasActive = false;

function quietPrefs() {
  return normalizeQuiet(prefs.quiet);
}

// 免打扰结束后把期间静音的提醒汇总成一条通知
function checkQuietEnd() {
  const active = inQuietHours(quietPrefs(), new Date());
  if (active) { quietWasActive = true; return; }
  if (!quietWasActive) return;
  quietWasActive = false;
  if (!quietBuffer.length) return;
  const count = quietBuffer.length;
  const text = buildQuietSummary(quietBuffer);
  quietBuffer = [];
  console.log('[quiet] 免打扰结束，汇总', count, '条被静音的提醒');
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `免打扰期间有 ${count} 条提醒`,
        body: text.split('\n').slice(1, 4).join('\n'),
        silent: true,
      });
      n.on('click', () => ensureWindow());
      n.show();
    }
  } catch (e) {
    console.error('[quiet] 汇总通知失败', e);
  }
  notifyWebhook('quiet.summary', { count, items: text });
  if (win && !win.isDestroyed()) win.webContents.send('quiet:summary', { count, text });
}

// ---------------- 每日早报 ----------------
function morningPrefs() {
  const m = prefs.morning && typeof prefs.morning === 'object' ? prefs.morning : {};
  const time = /^\d{1,2}:\d{2}$/.test(String(m.time || '').trim()) ? String(m.time).trim().padStart(5, '0') : '08:00';
  return { enabled: !!m.enabled, time, lastDate: typeof m.lastDate === 'string' ? m.lastDate : '' };
}

function checkMorningBrief() {
  try {
    const mp = morningPrefs();
    if (!mp.enabled) return;
    const now = dayjs();
    const today = now.format('YYYY-MM-DD');
    if (mp.lastDate === today) return;
    if (now.isBefore(dayjs(`${today}T${mp.time}:00`))) return;

    const list = tasks
      .filter((t) => taskOccursOnDate(t, today))
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const h = holidaysMap[today];
    const holiTxt = h
      ? (h.type === 'work' ? `调休上班${h.name ? '（' + h.name + '）' : ''}` : `休息日${h.name ? '（' + h.name + '）' : ''}`)
      : '';
    const segs = segments.filter((s) => s.date === today);
    const parts = [list.length ? `今天有 ${list.length} 个任务` : '今天没有任务'];
    if (list.length) parts.push(`最近：${list[0].time} ${list[0].title}`);
    if (holiTxt) parts.push(holiTxt);
    if (segs.length) parts.push(`时间段 ${segs.length} 个（${segs[0].start}-${segs[0].end}${segs[0].title ? ' ' + segs[0].title : ''}）`);
    const body = parts.join(' · ');

    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: `早安 · ${now.format('M月D日')}`, body, silent: true });
        n.on('click', () => ensureWindow());
        n.show();
      }
    } catch (e) {
      console.error('[morning] 早报通知失败', e);
    }
    prefs.morning = { ...mp, lastDate: today };
    savePrefs();
    console.log('[morning] 已发早报：', body);
    notifyWebhook('morning.brief', { date: today, count: list.length, body });
    if (win && !win.isDestroyed()) win.webContents.send('morning:brief', { body, count: list.length });
  } catch (e) {
    console.error('[morning] 早报失败', e);
  }
}

function fireNotification(task, alert) {
  const quiet = inQuietHours(quietPrefs(), new Date());
  if (quiet) {
    quietBuffer.push({
      title: task.title || '未命名任务',
      at: dayjs(alert.alertAt).format('MM-DD HH:mm'),
      taskId: task.id,
    });
    if (quietBuffer.length > 50) quietBuffer.shift();
    console.log('[quiet] 免打扰时段，已静音一条提醒：', task.title);
  }
  const nowTxt = dayjs(alert.alertAt).format('MM-DD HH:mm');
  const prioTxt = { high: '高', medium: '中', low: '低' }[task.priority] || '';
  const isRepeat = task.repeat && task.repeat !== 'none';
  const body = task.note
    ? `${nowTxt} · ${task.note}`
    : `${nowTxt} · ${isRepeat ? '重复任务' : '任务到点啦！'}`;

  const snd = alertSoundPrefs();
  const useCustom = snd.mode === 'custom' && !!snd.file;

  if (!quiet && Notification.isSupported()) {
    const n = new Notification({
      title: task.title || '开源日历',
      body: `${body}${prioTxt ? ' [' + prioTxt + ']' : ''}`,
      // 用自定义语音时不再播系统提示音，避免两种声音叠在一起
      silent: !prefs.notifySound || useCustom,
    });
    n.on('click', () => showPopup(task, alert, { interactive: true })); // 点通知 → 打开提醒卡片（可「稍后提醒」）
    n.on('failed', () => showPopup(task, alert)); // 系统通知失败 → 兜底小窗
    n.show();
    console.log('[notify] fired', task.id, dayjs(alert.alertAt).format('YYYY-MM-DD HH:mm:ss'), task.title);
  }

  // 推送到外部软件（若配置了 webhook）
  notifyWebhook('reminder.fired', {
    task: { id: task.id, title: task.title, date: task.date, time: task.time, priority: task.priority },
    at: alert.alertAt,
    atText: dayjs(alert.alertAt).format('YYYY-MM-DD HH:mm'),
  });

  // 内置联动：任务配置了 MAA 时，自动启动 MAA
  maybeStartMaaForTask(task);

  // 自定义提醒语音：播放自选音频 +（可选）系统 TTS 朗读任务标题
  if (!quiet && (useCustom || snd.speak)) {
    playAlertVoice({
      file: useCustom ? snd.file : null,
      volume: snd.volume,
      speak: !!snd.speak,
      text: snd.speakText
        ? String(snd.speakText).replace(/\{title\}/g, task.title || '')
        : `提醒：${task.title || '你有任务到点'}`,
    });
  }

  // 开发模式（未打包安装）下 Windows 常因应用没有开始菜单快捷方式而静默丢弃 toast，
  // 一律再弹一个置顶兜底小窗，保证提醒可见（免打扰时段除外）
  if (!quiet && !app.isPackaged) showPopup(task, alert);
}

// 自定义提醒语音：把播放指令发给渲染层（<audio> 播文件、speechSynthesis 朗读）
function playAlertVoice(payload) {
  const send = (w) => {
    try {
      if (w && !w.isDestroyed()) w.webContents.send('alert-voice', payload);
    } catch (e) {
      console.error('发送提醒语音失败', e);
    }
  };
  if (win && !win.isDestroyed()) { send(win); return; }
  // 后台静默启动（--hidden）时主窗口尚未创建：临时创建一个隐藏窗口专门放声音
  createWindow(false);
  if (win) win.webContents.once('did-finish-load', () => send(win));
}

// 提醒兜底：置顶小窗，10 秒后自动消失
// ---------------- 提醒卡片（兜底小窗 + 点通知后的交互入口） ----------------
let popupCtx = null;      // 当前卡片对应的任务
let postponedList = [];   // 「稍后提醒」队列 [{taskId, minutes, at, label, count}]

function closePopup() {
  try { if (popupWin && !popupWin.isDestroyed()) popupWin.close(); } catch (e) { /* noop */ }
  popupWin = null;
  popupCtx = null;
}

// 把一条提醒推后 minutes 分钟
function postponeReminder(taskId, minutes, occKey) {
  const item = normalizePostpone({ taskId, minutes, at: Date.now() + minutes * 60000, label: occKey || '' }, Date.now());
  if (!item) return { ok: false, error: '参数不合法' };
  postponedList.push(item);
  console.log(`[postpone] 任务 ${taskId} 的提醒推后 ${minutes} 分钟（${new Date(item.at).toLocaleTimeString()}）`);
  return { ok: true, at: item.at };
}

// 每次 tick 检查有没有到点的「稍后提醒」
function checkPostponed() {
  if (!postponedList.length) return;
  const { due, rest } = duePostponed(postponedList, Date.now());
  postponedList = rest;
  for (const p of due) {
    const task = tasks.find((t) => t.id === p.taskId);
    if (!task) continue;
    fireNotification(task, { alertAt: Date.now(), key: p.label || 'postpone', postponed: p.count + 1 });
  }
}

function showPopup(task, alert, opts) {
  closePopup();
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const acc = (prefs.theme && prefs.theme.accent) || '#4f6bff';
  const t = dayjs(alert.alertAt).format('M月D日 HH:mm');
  const prioClr = { high: '#ff5a5f', medium: '#ffa940', low: '#36b37e' }[task.priority] || '#36b37e';
  const prioTxt = { high: '高', medium: '中', low: '低' }[task.priority] || '';
  const isRepeat = task.repeat && task.repeat !== 'none';
  const body = task.note ? esc(task.note) : (isRepeat ? '重复任务' : '任务到点啦！');
  const laterTxt = alert && alert.postponed ? ` · 第 ${alert.postponed} 次稍后` : '';
  popupCtx = { taskId: task.id, title: task.title, occKey: (alert && alert.key) || '', postponed: (alert && alert.postponed) || 0 };
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;height:100vh;background:#fff;border-top:4px solid ${acc};padding:10px 14px 12px;overflow:hidden;display:flex;flex-direction:column}
    .tm{font-size:12px;color:#6b7280;padding-right:54px}
    .tl{font-size:16px;font-weight:700;color:#1f2430;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bd{font-size:12.5px;color:#4b5563;margin-top:5px;max-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pr{position:absolute;right:12px;top:8px;font-size:11px;color:#fff;background:${prioClr};border-radius:20px;padding:2px 9px}
    .btns{margin-top:auto;display:flex;gap:6px;flex-wrap:wrap}
    button{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid #dfe3ee;background:#f7f8fc;color:#3b4252;cursor:pointer}
    button:hover{border-color:${acc};color:${acc}}
    button.primary{background:${acc};border-color:${acc};color:#fff}
    button.ghost{background:transparent;border-color:transparent;color:#8891a5}
    </style></head><body>
    <div class="tm">${t} · 开源日历${laterTxt}</div>
    <div class="tl">${esc(task.title)}</div>
    <div class="bd">${body}</div>
    <div class="pr">${prioTxt}</div>
    <div class="btns">
      <button class="primary" data-act="postpone" data-min="10">稍后 10 分钟</button>
      <button data-act="postpone" data-min="60">稍后 1 小时</button>
      <button data-act="open">打开日历</button>
      <button class="ghost" data-act="close">关闭</button>
    </div>
    <script>
      document.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          try { window.popupApi.act(b.getAttribute('data-act'), Number(b.getAttribute('data-min') || 0)); }
          catch (e) { window.close(); }
        });
      });
    </script>
    </body></html>`;
  popupWin = new BrowserWindow({
    width: 430,
    height: 178,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    frame: true,
    title: '开源日历 · 任务提醒',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'popup-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popupWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  popupWin.once('ready-to-show', () => { popupWin.show(); popupWin.focus(); });
  // 点通知打开时多留一会儿（用户可能正在看），兜底弹窗 45 秒后自动收起
  const autoMs = (opts && opts.interactive) ? 180000 : 45000;
  setTimeout(() => { if (popupWin && !popupWin.isDestroyed()) closePopup(); }, autoMs);
  popupWin.on('closed', () => { popupWin = null; });
}

ipcMain.handle('popup:data', () => (popupCtx ? { ...popupCtx } : null));
ipcMain.on('popup:action', (e, msg) => {
  const m = msg || {};
  const ctx = popupCtx;
  if (ctx && m.action === 'postpone') {
    const minutes = POSTPONE_OPTIONS.includes(Number(m.minutes)) ? Number(m.minutes) : 10;
    postponeReminder(ctx.taskId, minutes, ctx.occKey);
  } else if (ctx && m.action === 'open') {
    focusTask(ctx.taskId);
  }
  closePopup();
});

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
  // 归一化提醒项：offsetMinutes + action(notify|maa)
  if (Array.isArray(t.reminders)) {
    t.reminders = t.reminders.map((r, i) => ({
      id: (r && r.id) || ('r_' + i + '_' + Math.random().toString(36).slice(2, 6)),
      offsetMinutes: Number(r && r.offsetMinutes) || 0,
      action: r && r.action === 'maa' ? 'maa' : 'notify',
    }));
  }
  // 时间段任务：time = 开始时间，endTime = 结束时间（结束早于开始视为跨夜），在日历上显示液体倒计时
  t.segment = t.segment === true;
  if (t.segment) {
    t.time = hhmmOf(t.time, '09:00');
    t.endTime = hhmmOf(t.endTime, t.time);
    t.color = /^#[0-9a-fA-F]{6}$/.test(String(t.color || '')) ? t.color : '';
  } else {
    delete t.endTime;
    delete t.color;
  }
  return t;
}

// 共享的任务保存/删除逻辑（IPC 与本地 HTTP 接口都会用）
function saveTaskInternal(input) {
  const t = sanitizeTask(input);
  if (!t.id) t.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (!t.reminders || !t.reminders.length) t.reminders = [{ id: 'r_' + Math.random().toString(36).slice(2, 6), offsetMinutes: 0 }];
  // 任务的 MAA 联动配置（到点是否自动启动 MAA、运行哪个任务、多久后自动停）
  t.maa = normalizeTaskMaa(t.maa, maaPrefsLocal().autoStartTask);
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
  return { ...t };
}

function deleteTaskInternal(id) {
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  broadcastToWidgets('widget:update');
  return { ok: true };
}

ipcMain.handle('tasks:list', () => tasks.map((t) => ({ ...t })));

ipcMain.handle('tasks:save', (e, input) => {
  const t = saveTaskInternal(input);
  notifyWebhook('task.saved', { task: { id: t.id, title: t.title, date: t.date, time: t.time } });
  return { ok: true, task: { ...t } };
});

ipcMain.handle('tasks:delete', (e, id) => {
  const r = deleteTaskInternal(id);
  notifyWebhook('task.deleted', { id });
  return r;
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

// ---------------- 节假日（休息日 / 调休上班日） ----------------
const DEFAULT_HOLIDAY_PREFS = { showRest: true, showWorkday: true, urlTemplate: HOLIDAY_URL, updatedAt: null };

function holidayPrefs() {
  const h = prefs.holidays && typeof prefs.holidays === 'object' ? prefs.holidays : {};
  return {
    showRest: h.showRest !== false,
    showWorkday: h.showWorkday !== false,
    urlTemplate: typeof h.urlTemplate === 'string' && h.urlTemplate ? h.urlTemplate : HOLIDAY_URL,
    updatedAt: h.updatedAt || null,
  };
}

function loadHolidays() {
  const maps = [];
  try {
    fs.mkdirSync(HOLIDAY_DIR(), { recursive: true });
    for (const f of fs.readdirSync(HOLIDAY_DIR())) {
      if (!/\.json$/i.test(f)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(path.join(HOLIDAY_DIR(), f), 'utf-8').replace(/^\uFEFF/, ''));
        maps.push(parseYearFile(json));
      } catch (e) {
        console.error('节假日文件解析失败', f, e);
      }
    }
  } catch (e) {
    console.error('读取节假日目录失败', e);
  }
  holidaysMap = mergeHolidayMaps(maps);
  return holidaysMap;
}

function holidayStatus() {
  const hp = holidayPrefs();
  return {
    years: yearsOf(holidaysMap),
    count: Object.keys(holidaysMap).length,
    updatedAt: hp.updatedAt,
    dir: HOLIDAY_DIR(),
    urlTemplate: hp.urlTemplate,
    prefs: hp,
  };
}

ipcMain.handle('holidays:status', () => holidayStatus());

ipcMain.handle('holidays:month', (e, { year, month }) => {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) return {};
  return monthHolidays(holidaysMap, y, m);
});

// 在线更新：从公开数据集拉取「去年 / 今年 / 明年」的放假安排
ipcMain.handle('holidays:update', async () => {
  const hp = holidayPrefs();
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const results = [];
  try {
    fs.mkdirSync(HOLIDAY_DIR(), { recursive: true });
  } catch (e) {
    return { ok: false, results: [{ year: 0, ok: false, error: '无法创建数据目录' }] };
  }
  for (const yy of years) {
    // 每个年份依次尝试多个数据源（默认 jsdelivr + 各镜像 + raw），任一成功即用
    let saved = false;
    let lastErr = '所有数据源都不可用';
    for (const url of holidaySourceList(hp.urlTemplate, yy)) {
      try {
        const res = await httpFetch(url, { cache: 'no-cache' });
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
        const json = await res.json();
        const map = parseYearFile(json);
        if (!Object.keys(map).length) { lastErr = '数据为空或不兼容'; continue; }
        fs.writeFileSync(path.join(HOLIDAY_DIR(), `${yy}.json`), JSON.stringify(json, null, 2), 'utf-8');
        results.push({ year: yy, ok: true, count: Object.keys(map).length, source: url });
        saved = true;
        break;
      } catch (err) {
        lastErr = errText(err);
      }
    }
    if (!saved) results.push({ year: yy, ok: false, error: lastErr });
  }
  loadHolidays();
  prefs.holidays = { ...holidayPrefs(), updatedAt: Date.now() };
  savePrefs();
  const okCount = results.filter((r) => r.ok).length;
  return { ok: okCount > 0, results, status: holidayStatus() };
});

// 手动导入本地 JSON（保底：网络不可用时自己下载后导入）
ipcMain.handle('holidays:import', async () => {
  if (!win) return { ok: false, error: '窗口未就绪' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入节假日数据（JSON）',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8').replace(/^\uFEFF/, '');
    const json = JSON.parse(raw);
    const map = parseYearFile(json);
    const count = Object.keys(map).length;
    if (!count) return { ok: false, error: '文件里没有可识别的 days 数据' };
    const year = Number(json.year) || Number(Object.keys(map)[0].slice(0, 4));
    fs.mkdirSync(HOLIDAY_DIR(), { recursive: true });
    fs.writeFileSync(path.join(HOLIDAY_DIR(), `${year}.json`), JSON.stringify(json, null, 2), 'utf-8');
    loadHolidays();
    prefs.holidays = { ...holidayPrefs(), updatedAt: Date.now() };
    savePrefs();
    return { ok: true, year, count, status: holidayStatus() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('holidays:openDir', async () => {
  try {
    fs.mkdirSync(HOLIDAY_DIR(), { recursive: true });
    await shell.openPath(HOLIDAY_DIR());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

// ---------------- 统一的网络请求入口 ----------------
// 主进程里直接调 fetch() 用的是 Node 自带实现：它只认 Node 内置 CA 列表，
// 既不读 Windows 证书库、也不走系统代理。本机若装了 Steam++ / Watt Toolkit / Clash 之类的
// HTTPS 加速器（它们把 github.com 等域名指到 127.0.0.1 做中间人转发），Node fetch 会直接报
// "unable to verify the first certificate"，在界面上就表现为「检查更新失败」。
// 因此这里统一优先走 Electron 的 net.fetch（Chromium 网络栈：读 Windows 证书库 + 系统代理），
// 失败再回退 Node fetch，并把两边的失败原因合并上报，方便定位。
function chromiumFetchAvailable() {
  return !!(net && typeof net.fetch === 'function' && app.isReady());
}

async function httpFetch(url, init) {
  const opts = init || {};
  const failures = [];
  if (chromiumFetchAvailable()) {
    const co = { ...opts };
    delete co.cache; // Chromium 网络栈自行管理缓存，不接受该选项
    try {
      return await net.fetch(url, co);
    } catch (e) {
      const msg = errText(e);
      failures.push(`Chromium 网络栈: ${msg}`);
      console.warn('[net] Chromium 网络栈请求失败，改试 Node 直连：', url, msg);
    }
  }
  try {
    return await fetch(url, opts);
  } catch (e) {
    failures.push(`Node: ${errText(e)}`);
  }
  const err = new Error(failures.join(' → '));
  err.cause = failures.join(' → ');
  throw err;
}

// ---------------- 应用更新（直连 GitHub 仓库） ----------------
const DEFAULT_UPDATE_PREFS = { autoCheck: true, repo: '', lastCheck: null, ignoredVersion: null };
// 发行方锁定的 GitHub 仓库（设置里不可修改，更新检查/Star 均使用它）
const LOCKED_UPDATE_REPO = 'tlmrt/-';
const updateState = { lastResult: null, downloadedFile: null, progress: 0, checking: false };

// 外部联动：本地 HTTP 接口 + MAA 控制
const DEFAULT_API_PREFS = { enabled: true, port: 8765, token: '', webhook: '' };
const DEFAULT_MAA_PREFS = {
  exePath: '',
  argsTemplate: '',
  workDir: '',
  autoStartTask: '默认',
  tasks: ['开始唤醒', '收取信用及购物', '自动公招', '基建换班'],
  autoStopMin: 0,
  skipIfRunning: true,
};
let apiServer = null;
const maaState = { pid: null, startedAt: null, label: '', stoppedByUser: false, finishedNotified: false };
const maaStopTimer = { id: null };

function updatePrefs() {
  const u = prefs.update && typeof prefs.update === 'object' ? prefs.update : {};
  return {
    autoCheck: u.autoCheck !== false,
    // 仓库地址由发行方锁定，忽略本地存储值（避免被随意改动导致更新/Star 失效）
    repo: LOCKED_UPDATE_REPO,
    locked: true,
    lastCheck: u.lastCheck || null,
    ignoredVersion: u.ignoredVersion || null,
  };
}

function githubHeaders() {
  return { 'User-Agent': 'EveCalendar-Updater', Accept: 'application/vnd.github+json' };
}

async function fetchLatestRelease(repo) {
  const res = await httpFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: githubHeaders(),
    cache: 'no-cache',
  });
  if (res.status === 404) throw new Error('仓库或 Release 不存在（请检查仓库地址与是否已发布 Release）');
  if (res.status === 403) throw new Error('GitHub API 访问受限（可能触发了频率限制，稍后再试）');
  if (!res.ok) throw new Error(`GitHub 返回 HTTP ${res.status}`);
  return res.json();
}

// 检查更新：任何失败都只返回错误对象，不影响应用其它功能
async function checkForUpdates(opts) {
  const manual = !!(opts && opts.manual);
  const up = updatePrefs();
  if (!up.repo) return { ok: false, error: '尚未配置 GitHub 仓库（格式：用户名/仓库名）', needRepo: true };
  try {
    const release = await fetchLatestRelease(up.repo);
    const info = parseRelease(release, app.getVersion());
    updateState.lastResult = info;
    prefs.update = { ...up, lastCheck: Date.now() };
    savePrefs();
    if (info.ok && info.hasUpdate && shouldNotify(info, up.ignoredVersion)) {
      if (win && !win.isDestroyed()) win.webContents.send('update:available', info);
      if (!manual) notifyUpdateAvailable(info);
    }
    return info;
  } catch (e) {
    const err = { ok: false, error: describeNetError(e) };
    updateState.lastResult = err;
    console.error('[update] 检查失败', err.error);
    return err;
  }
}

function notifyUpdateAvailable(info) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: `发现新版本 v${info.latest}`,
      body: '点托盘图标回到日历，在设置中可一键更新',
      silent: true,
    });
    n.on('click', () => ensureWindow());
    n.show();
  } catch (e) {
    console.error('[update] 通知失败', e);
  }
}

ipcMain.handle('update:status', () => ({
  current: app.getVersion(),
  ...updatePrefs(),
  downloaded: updateState.downloadedFile && fs.existsSync(updateState.downloadedFile) ? updateState.downloadedFile : null,
  progress: updateState.progress,
  lastResult: updateState.lastResult,
}));

ipcMain.handle('update:check', () => checkForUpdates({ manual: true }));

ipcMain.handle('update:ignore', (e, version) => {
  prefs.update = { ...updatePrefs(), ignoredVersion: version || null };
  savePrefs();
  return { ok: true };
});

ipcMain.handle('update:setPrefs', (e, patch) => {
  const next = { ...updatePrefs(), ...(patch || {}) };
  // 仓库地址锁定：始终以发行方配置为准
  next.repo = LOCKED_UPDATE_REPO;
  prefs.update = { ...next };
  savePrefs();
  return { ok: true, prefs: updatePrefs() };
});

// 下载安装包到 userData/updates/，并回报进度
ipcMain.handle('update:download', async () => {
  const info = updateState.lastResult;
  if (!info || !info.ok || !info.downloadUrl) return { ok: false, error: '没有可下载的安装包，请先检查更新' };
  try {
    fs.mkdirSync(UPDATE_DIR(), { recursive: true });
  } catch (e) {
    return { ok: false, error: '无法创建更新目录：' + errText(e) };
  }
  const dest = path.join(UPDATE_DIR(), info.assetName || `EveCalendar-${info.latest}.exe`);
  // 先走 Chromium 网络栈（读 Windows 证书库，兼容本机 HTTPS 加速器/代理），
  // 中途失败就删掉半成品、整体换 Node 直连重下一次，两次都失败才报错
  const modes = chromiumFetchAvailable() ? ['chromium', 'node'] : ['node'];
  const failures = [];
  for (const mode of modes) {
    try {
      updateState.progress = 0;
      const res = mode === 'chromium'
        ? await net.fetch(info.downloadUrl, { headers: githubHeaders(), redirect: 'follow' })
        : await fetch(info.downloadUrl, { headers: githubHeaders(), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      let received = 0;
      const counter = new Transform({
        transform(chunk, enc, cb) {
          received += chunk.length;
          if (total) {
            const pct = Math.round((received / total) * 100);
            updateState.progress = pct;
            if (win && !win.isDestroyed()) win.webContents.send('update:progress', { percent: pct, received, total });
          }
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));
      updateState.downloadedFile = dest;
      updateState.progress = 100;
      console.log(`[update] 安装包下载完成（${mode === 'chromium' ? 'Chromium 网络栈' : 'Node 直连'}）：${dest}`);
      return { ok: true, file: dest };
    } catch (e) {
      const msg = errText(e);
      failures.push(`${mode === 'chromium' ? 'Chromium 网络栈' : 'Node'}: ${msg}`);
      console.warn('[update] 下载失败，尝试下一条通道：', msg);
      try { fs.rmSync(dest, { force: true }); } catch (_) { /* 清理失败不影响结果 */ }
      updateState.progress = 0;
    }
  }
  return { ok: false, error: describeNetError(failures.join(' → ')) };
});

// 打开已下载的安装包（由用户确认后运行安装，覆盖升级）
ipcMain.handle('update:install', async () => {
  const f = updateState.downloadedFile;
  if (!f || !fs.existsSync(f)) return { ok: false, error: '安装包不存在，请先下载更新' };
  try {
    const msg = await shell.openPath(f);
    if (msg) return { ok: false, error: msg };
    return { ok: true, file: f };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('update:openPage', async () => {
  const info = updateState.lastResult;
  // 检查失败时 lastResult 里没有 pageUrl，此时退回到仓库的 Releases 页面，
  // 保证在网络/证书出问题时始终有一条「用浏览器手动下载」的退路
  const url = (info && info.pageUrl) || `https://github.com/${LOCKED_UPDATE_REPO}/releases`;
  try {
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ---------------- 外部联动：本地 HTTP 接口 + MAA ----------------
function apiPrefs() {
  const a = prefs.api && typeof prefs.api === 'object' ? prefs.api : {};
  return {
    enabled: a.enabled !== false,
    port: Number(a.port) > 0 && Number(a.port) < 65536 ? Number(a.port) : 8765,
    token: typeof a.token === 'string' ? a.token : '',
    webhook: typeof a.webhook === 'string' ? a.webhook.trim() : '',
  };
}

function maaPrefsLocal() {
  return normalizeMaaPrefs(prefs.maa);
}

function newToken() {
  return crypto.randomBytes(12).toString('hex');
}

// 事件推送到 webhook（外部软件可订阅）
async function notifyWebhook(event, payload) {
  const url = apiPrefs().webhook;
  if (!url) return { ok: false, error: '未配置 webhook' };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: '开源日历', event, time: Date.now(), payload }),
    });
    return { ok: true };
  } catch (e) {
    console.error('[webhook] 推送失败', e && e.message);
    return { ok: false, error: String(e && e.message) };
  }
}

// ---- MAA 控制 ----
function maaStart(taskName) {
  const mp = maaPrefsLocal();
  if (!mp.exePath || !fs.existsSync(mp.exePath)) {
    return { ok: false, error: '尚未配置 MAA 可执行文件路径（设置 → 外部联动）' };
  }
  const now = dayjs();
  const task = taskName || mp.autoStartTask || '默认';
  const args = renderArgs(mp.argsTemplate, {
    task,
    date: now.format('YYYY-MM-DD'),
    time: now.format('HH:mm'),
    title: task,
    id: '',
  });
  try {
    const child = spawn(mp.exePath, args, {
      detached: true,
      stdio: 'ignore',
      cwd: mp.workDir && fs.existsSync(mp.workDir) ? mp.workDir : path.dirname(mp.exePath),
    });
    child.unref();
    maaState.pid = child.pid;
    maaState.startedAt = Date.now();
    notifyWebhook('maa.started', { pid: child.pid, task, args });
    return { ok: true, pid: child.pid, task, args };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function maaStop() {
  const pid = maaState.pid;
  if (maaStopTimer.id) { clearTimeout(maaStopTimer.id); maaStopTimer.id = null; }
  if (!pid) return { ok: false, error: 'MAA 未由本应用启动（或已经停止）' };
  try {
    maaState.stoppedByUser = true; // 手动停止不再发「已结束」通知
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    maaState.pid = null;
    maaState.startedAt = null;
    notifyWebhook('maa.stopped', { pid });
    return { ok: true, pid };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// MAA 跑完（进程消失）时发一次通知 —— 补上"启动有通知、结束没下文"的断层
function checkMaaFinished() {
  if (!maaState.pid || maaState.finishedNotified) return;
  let running = true;
  try { process.kill(maaState.pid, 0); } catch (e) { running = false; }
  if (running) return;
  const mins = maaState.startedAt ? Math.max(0, Math.round((Date.now() - maaState.startedAt) / 60000)) : 0;
  const label = maaState.label || 'MAA';
  const byUser = !!maaState.stoppedByUser;
  maaState.pid = null;
  maaState.startedAt = null;
  maaState.label = '';
  maaState.stoppedByUser = false;
  maaState.finishedNotified = true;
  if (byUser) { console.log('[maa] 已由用户手动停止'); return; }
  const title = 'MAA 已结束';
  const body = `${label} · 运行约 ${mins < 1 ? '不到 1' : mins} 分钟`;
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: true });
      n.on('click', () => ensureWindow());
      n.show();
    }
  } catch (e) {
    console.error('[maa] 结束通知失败', e);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('maa:event', { taskId: null, title, result: { ok: true, finished: true, minutes: mins } });
  }
  notifyWebhook('maa.finished', { label, minutes: mins });
  console.log('[maa] 已结束，用时', mins, '分钟');
}

// 启动 MAA（带"已在运行则跳过"与"自动停止"能力）
function maaStartWithOptions(taskName, opts) {
  const o = opts || {};
  const mp = maaPrefsLocal();
  if (mp.skipIfRunning && !o.force) {
    const st = maaStatus();
    if (st.running) {
      return { ok: true, skipped: true, reason: 'MAA 已在运行，跳过重复启动', pid: st.pid };
    }
  }
  const r = maaStart(taskName);
  if (!r.ok) return r;
  // 记录触发来源，结束时通知里能说清是哪个任务/计划启动的
  maaState.label = o.label || taskName || mp.autoStartTask || 'MAA';
  maaState.finishedNotified = false;
  const stopMin = Number(o.autoStopMin) > 0 ? Number(o.autoStopMin) : mp.autoStopMin;
  if (stopMin > 0) {
    if (maaStopTimer.id) clearTimeout(maaStopTimer.id);
    maaStopTimer.id = setTimeout(() => {
      maaStopTimer.id = null;
      maaStop();
      console.log('[maa] 已按设置自动停止');
    }, stopMin * 60 * 1000);
  }
  return r;
}

// 切到指定名字的 MAA 配置（供全局设置/日期绑定共用）
function applyConfigByName(name) {
  if (!name) return { ok: true, applied: false, current: null };
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  if (!json.Configurations || !json.Configurations[name]) return { ok: false, error: 'MAA 配置不存在：' + name };
  if (json.Current === name) return { ok: true, applied: true, current: name };
  json.Current = name;
  const w = writeMaaConfig(ps, json);
  if (!w.ok) return w;
  return { ok: true, applied: true, current: name };
}

// 每天定时自动启动 MAA（优先当天的「每周计划」，否则用「每天」设置；优先级低于按日期绑定的专属配置）
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function checkDailyMaaStart() {
  try {
    const mp = maaPrefsLocal();
    const g = mp.global || {};
    const now = dayjs();
    const today = now.format('YYYY-MM-DD');
    const plan = pickDailyPlan(mp.weekly, g, now.day());
    if (!plan.enabled || !plan.time) return { ok: true, skipped: '未开启自动启动' };
    if (g.lastRunDate === today) return { ok: true, skipped: '今天已自动启动过' };
    const due = dayjs(`${today}T${plan.time}:00`);
    if (!due.isValid() || now.isBefore(due)) return { ok: true, skipped: '还没到设定时间' };
    if (!mp.exePath || !fs.existsSync(mp.exePath)) {
      console.log('[maa] 每日自动启动跳过：尚未配置 MAA 路径');
      return { ok: false, error: '尚未配置 MAA 路径' };
    }
    if (plan.configName) {
      const applied = applyConfigByName(plan.configName);
      if (applied && applied.ok === false) console.error('[maa] 自动启动切换配置失败：', applied.error);
    }
    const label = plan.source === 'weekly'
      ? `每周计划 · ${WEEK_CN[plan.weekday] || ''}`
      : `每日计划 · ${plan.time}`;
    const r = maaStartWithOptions(mp.autoStartTask, { label });
    console.log(`[maa] 自动启动（${plan.source} ${plan.time}）→`, JSON.stringify(r));
    if (win && !win.isDestroyed()) win.webContents.send('maa:event', { taskId: null, title: label, result: r });
    prefs.maa = { ...mp, global: { ...g, lastRunDate: today } };
    savePrefs();
    return r;
  } catch (e) {
    console.error('[maa] 每日自动启动失败', e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 任务到点：启动 MAA（opts.force=true 表示由「启动 MAA」提醒项触发，不受旧任务级开关限制）
function maybeStartMaaForTask(task, opts) {
  try {
    const force = !!(opts && opts.force);
    const m = normalizeTaskMaa(task && task.maa, maaPrefsLocal().autoStartTask);
    if (!m.enabled && !force) return null;
    // 若任务所在日期绑定了某套 MAA 配置，先切过去再启动
    if (task && task.date) {
      const applied = applyDateConfig(task.date);
      if (applied && applied.applied) console.log('[maa] 使用日期绑定配置:', applied.current);
      else if (applied && applied.ok === false) console.error('[maa] 日期配置切换失败:', applied.error);
    }
    const r = maaStartWithOptions(m.task, {
      autoStopMin: m.autoStopMin,
      label: task && task.title ? `任务「${task.title}」` : '',
    });
    console.log('[maa] 任务联动触发:', task.title, '→', JSON.stringify(r));
    if (win && !win.isDestroyed()) {
      win.webContents.send('maa:event', { taskId: task.id, title: task.title, result: r });
    }
    if (!r.ok) notifyWebhook('maa.failed', { taskId: task.id, title: task.title, error: r.error });
    return r;
  } catch (e) {
    console.error('[maa] 联动失败', e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---------------- 读取 MAA 运行进度（来自 MAA 自己的 debug/gui.log） ----------------
const MAA_LOG_TAIL = 200 * 1024; // 只看尾部 200KB，足够覆盖一次完整运行
const maaLogCache = { key: '', state: null };

function maaLogPath() {
  const mp = maaPrefsLocal();
  if (!mp.exePath) return '';
  return path.join(path.dirname(mp.exePath), 'debug', 'gui.log');
}

// 返回 { ok, ...解析结果, logAgeSec, logPath }；同一份日志（size+mtime 未变）直接走缓存
function readMaaLogState() {
  const p = maaLogPath();
  if (!p) return { ok: false, error: '尚未配置 MAA 路径' };
  let st = null;
  try { st = fs.statSync(p); } catch (e) { return { ok: false, error: '未找到 MAA 日志（debug/gui.log）', logPath: p }; }
  const logAgeSec = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000));
  const key = `${p}|${st.size}|${Math.round(st.mtimeMs)}`;
  if (maaLogCache.key === key && maaLogCache.state) {
    return { ok: true, ...maaLogCache.state, logAgeSec, logPath: p };
  }
  let text = '';
  try {
    const size = Math.min(MAA_LOG_TAIL, st.size);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, size, st.size - size);
    fs.closeSync(fd);
    text = trimPartialFirstLine(buf.toString('utf-8'));
  } catch (e) {
    return { ok: false, error: '读取 MAA 日志失败：' + String(e && e.message ? e.message : e), logPath: p };
  }
  const state = parseMaaLog(text);
  maaLogCache.key = key;
  maaLogCache.state = state;
  return { ok: true, ...state, logAgeSec, logPath: p };
}

// 给界面/接口用的进度描述：{ line1, line2, tone } + 原始字段
function maaProgress() {
  const st = maaStatus();
  const raw = readMaaLogState();
  if (!raw.ok) {
    return { ok: false, error: raw.error, line1: '', line2: '', tone: 'idle', logPath: raw.logPath || '' };
  }
  const desc = describeMaaProgress(raw, { running: !!st.running, logAgeSec: raw.logAgeSec });
  return {
    ok: true,
    ...desc,
    currentTask: raw.currentTask,
    lastSubStep: raw.lastSubStep,
    lastDoneTask: raw.lastDoneTask,
    allDone: raw.allDone,
    elapsedText: raw.elapsedText,
    staminaText: raw.staminaText,
    taskId: raw.taskId,
    logAgeSec: raw.logAgeSec,
    logPath: raw.logPath,
  };
}

function maaStatus() {
  let running = false;
  if (maaState.pid) {
    try {
      process.kill(maaState.pid, 0);
      running = true;
    } catch (e) {
      running = false;
      maaState.pid = null;
    }
  }
  const mp = maaPrefsLocal();
  return {
    ok: true,
    running,
    pid: running ? maaState.pid : null,
    startedAt: running ? maaState.startedAt : null,
    label: running ? (maaState.label || '') : '',
    configured: !!(mp.exePath && fs.existsSync(mp.exePath)),
    exePath: mp.exePath,
    argsTemplate: mp.argsTemplate,
    autoStartTask: mp.autoStartTask,
    tasks: mp.tasks,
    autoStopMin: mp.autoStopMin,
    skipIfRunning: mp.skipIfRunning,
  };
}

// ---- 接口路由处理 ----
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { resolve(null); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleApiRoute(route, { query, body }) {
  const ok = (b) => ({ status: 200, body: { ok: true, ...b } });
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });

  switch (route.name) {
    case 'ping':
      return ok({ name: '开源日历', version: app.getVersion(), port: apiPrefs().port });

    case 'tasks.list': {
      const date = query.date;
      const list = date ? tasks.filter((t) => taskOccursOnDate(t, date)) : tasks;
      return ok({ count: list.length, tasks: list.map((t) => ({ ...t, _notifiedKeys: undefined })) });
    }
    case 'tasks.get': {
      const t = tasks.find((x) => x.id === route.params[0]);
      return t ? ok({ task: { ...t, _notifiedKeys: undefined } }) : bad('任务不存在', 404);
    }
    case 'tasks.create':
    case 'tasks.update': {
      const input = route.name === 'tasks.update' ? { ...(body || {}), id: body && body.id ? body.id : route.params[0] } : body;
      if (!input || typeof input !== 'object' || !input.title) return bad('缺少 title');
      const saved = saveTaskInternal(input);
      notifyWebhook('task.saved', { task: { id: saved.id, title: saved.title, date: saved.date, time: saved.time } });
      return ok({ task: { ...saved, _notifiedKeys: undefined } });
    }
    case 'tasks.delete': {
      const id = route.params[0];
      const existed = tasks.some((x) => x.id === id);
      if (!existed) return bad('任务不存在', 404);
      deleteTaskInternal(id);
      notifyWebhook('task.deleted', { id });
      return ok({ id });
    }

    case 'segments.list': {
      const date = query.date;
      const list = date ? segments.filter((s) => s.date === date) : segments;
      return ok({ count: list.length, segments: list });
    }
    case 'segments.create': {
      const input = body || {};
      if (!input.date || !input.start || !input.end) return bad('缺少 date/start/end');
      const r = upsertSegmentTask({
        id: input.id,
        date: input.date,
        start: input.start,
        end: input.end,
        title: input.title,
        color: input.color,
      });
      if (!r.ok) return bad(r.error || '保存失败');
      notifyWebhook('segment.saved', { segment: r.segment });
      return ok({ segment: r.segment });
    }

    case 'now': {
      const now = Date.now();
      const today = dayjs().format('YYYY-MM-DD');
      const todays = tasks.filter((t) => taskOccursOnDate(t, today));
      const todaysSeg = segments.filter((s) => s.date === today);
      let next = null;
      try {
        const horizon = now + 24 * 60 * 60 * 1000;
        for (const t of tasks) {
          for (const a of computeAlertsInWindow(t, now, horizon)) {
            if (!next || a.alertAt < next.at) next = { at: a.alertAt, taskId: t.id, title: t.title, time: dayjs(a.alertAt).format('YYYY-MM-DD HH:mm') };
          }
        }
      } catch (e) { /* 忽略 */ }
      const active = segments.find((s) => {
        const start = dayjs(`${s.date}T${s.start}`).valueOf();
        let end = dayjs(`${s.date}T${s.end}`).valueOf();
        if (end <= start) end += 24 * 60 * 60 * 1000;
        return now >= start && now < end;
      });
      return ok({
        now: dayjs(now).format('YYYY-MM-DD HH:mm:ss'),
        today,
        tasks: todays.map((t) => ({ id: t.id, title: t.title, time: t.time, priority: t.priority })),
        segments: todaysSeg,
        activeSegment: active || null,
        nextReminder: next,
      });
    }

    case 'maa.start': {
      const r = maaStart(body && body.task);
      if (!r.ok) return bad(r.error || '启动 MAA 失败');
      return ok({ pid: r.pid, task: r.task, args: r.args });
    }
    case 'maa.stop': {
      const r = maaStop();
      if (!r.ok) return bad(r.error || '停止 MAA 失败');
      return ok({ pid: r.pid });
    }
    case 'maa.status': {
      const prog = maaProgress();
      return ok({
        ...maaStatus(),
        progress: {
          line1: prog.line1 || '',
          line2: prog.line2 || '',
          tone: prog.tone || 'idle',
          currentTask: prog.currentTask || '',
          lastSubStep: prog.lastSubStep || '',
          allDone: !!prog.allDone,
          elapsedText: prog.elapsedText || '',
          error: prog.error || '',
        },
      });
    }

    case 'webhook.test': {
      const r = await notifyWebhook('test', { message: '这是来自开源日历的测试事件' });
      return r.ok ? ok({ sent: true }) : bad(r.error || '推送失败');
    }
    default:
      return bad('未知接口', 404);
  }
}

function startApiServer() {
  stopApiServer();
  const ap = apiPrefs();
  if (!ap.enabled) return { ok: true, running: false };
  apiServer = http.createServer(async (req, res) => {
    const json = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Token, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end(body);
    };
    try {
      if (req.method === 'OPTIONS') return json(204, {});
      const url = req.url || '/';
      const query = parseQuery(url);
      const route = matchRoute(req.method, url);
      if (!route) return json(404, { ok: false, error: '未知接口' });
      if (route.auth) {
        const token = extractToken(req.headers, query);
        if (!checkToken(token, ap.token)) {
          return json(401, { ok: false, error: 'token 无效（请在 X-Api-Token 头或 ?token= 中带上设置里的令牌）' });
        }
      }
      const body = await readBody(req);
      const result = await handleApiRoute(route, { query, body });
      // 防御：路由返回值必须形如 { status, body }，万一某分支漏了包装也不至于 500
      if (result && result.body !== undefined) {
        json(result.status || 200, result.body);
      } else if (result && result.ok === false) {
        json(400, result);
      } else {
        json(200, { ok: true, data: result === undefined ? null : result });
      }
    } catch (e) {
      json(500, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
  apiServer.on('error', (e) => {
    console.error('[api] 服务错误：', e && e.message);
    apiServer = null;
  });
  apiServer.listen(ap.port, '127.0.0.1', () => {
    console.log(`[api] 本地联动接口已启动：http://127.0.0.1:${ap.port}`);
  });
  return { ok: true, running: true, port: ap.port };
}

function stopApiServer() {
  if (apiServer) {
    try { apiServer.close(); } catch (e) { /* noop */ }
    apiServer = null;
  }
}

ipcMain.handle('api:status', () => ({
  ...apiPrefs(),
  running: !!apiServer,
  url: `http://127.0.0.1:${apiPrefs().port}`,
}));

ipcMain.handle('api:setPrefs', (e, patch) => {
  prefs.api = { ...apiPrefs(), ...(patch || {}) };
  savePrefs();
  startApiServer();
  return { ok: true, status: { ...apiPrefs(), running: !!apiServer } };
});

ipcMain.handle('api:regenerateToken', () => {
  prefs.api = { ...apiPrefs(), token: newToken() };
  savePrefs();
  startApiServer();
  return { ok: true, token: prefs.api.token };
});

ipcMain.handle('api:openDocs', async () => {
  try {
    const src = path.join(__dirname, '..', 'docs', 'API.md');
    if (!fs.existsSync(src)) return { ok: false, error: '接口文档缺失' };
    const dst = path.join(DATA_DIR(), '接口文档.md');
    fs.copyFileSync(src, dst);
    await shell.openPath(dst);
    return { ok: true, file: dst };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('maa:status', () => maaStatus());
ipcMain.handle('maa:start', (e, taskName) => maaStartWithOptions(taskName, { force: true }));
ipcMain.handle('maa:stop', () => maaStop());
// 为某个日历任务手动启动 MAA（用该任务配置的 MAA 任务名）
ipcMain.handle('maa:runTask', (e, taskId) => {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return { ok: false, error: '任务不存在' };
  const m = normalizeTaskMaa(t.maa, maaPrefsLocal().autoStartTask);
  return maybeStartMaaForTask({ ...t, maa: { ...m, enabled: true } });
});
ipcMain.handle('maa:setPrefs', (e, patch) => {
  prefs.maa = normalizeMaaPrefs({ ...maaPrefsLocal(), ...(patch || {}) });
  savePrefs();
  return { ok: true, prefs: maaPrefsLocal() };
});
// ---- 读写 MAA 配置文件（把「一键长草」的任务列表搬进日历） ----
function maaConfigPaths() {
  const mp = maaPrefsLocal();
  if (!mp.exePath) return null;
  const dir = path.dirname(mp.exePath);
  const cfgDir = path.join(dir, 'config');
  const newFile = path.join(cfgDir, 'gui.new.json');
  const oldFile = path.join(cfgDir, 'gui.json');
  const file = fs.existsSync(newFile) ? newFile : (fs.existsSync(oldFile) ? oldFile : newFile);
  return { dir, cfgDir, file, newFile };
}

function readMaaConfig() {
  const ps = maaConfigPaths();
  if (!ps) return { ok: false, error: '尚未配置 MAA 可执行文件路径（设置 → 外部联动）' };
  if (!fs.existsSync(ps.file)) {
    return { ok: false, error: '未找到 MAA 配置文件，请先运行一次 MAA（会生成 config/gui.new.json）', file: ps.file };
  }
  try {
    const json = JSON.parse(fs.readFileSync(ps.file, 'utf-8').replace(/^\uFEFF/, ''));
    return { ok: true, ps, json };
  } catch (e) {
    return { ok: false, error: '配置文件解析失败：' + (e && e.message ? e.message : e), file: ps.file };
  }
}

function writeMaaConfig(ps, json) {
  try {
    const backup = ps.file + '.evecal.bak';
    if (fs.existsSync(ps.file) && !fs.existsSync(backup)) fs.copyFileSync(ps.file, backup);
    fs.writeFileSync(ps.file, JSON.stringify(json, null, 2), 'utf-8');
    return { ok: true, file: ps.file };
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e && e.message ? e.message : e) };
  }
}

ipcMain.handle('maa:configLoad', (e, opts) => {
  const date = opts && /^\d{4}-\d{2}-\d{2}$/.test(opts.date || '') ? opts.date : null;
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  const configs = Object.keys(json.Configurations || {});
  const mp = maaPrefsLocal();
  const bound = date ? (mp.dateConfigs || {})[date] || null : null;
  // 有日期绑定时优先展示该配置，否则用 MAA 当前的配置
  const current = bound && json.Configurations && json.Configurations[bound]
    ? bound
    : (json.Current && json.Configurations && json.Configurations[json.Current] ? json.Current : (configs[0] || 'Default'));
  const cfg = (json.Configurations || {})[current] || {};
  const start = (cfg.Gui && cfg.Gui.StartUpSettings) || {};
  return {
    ok: true,
    file: ps.file,
    date,
    bound,
    current,
    configs,
    tasks: buildEditableQueue(cfg.TaskQueue),
    startDirectly: !!start.RunDirectly,
    startEmulator: !!start.StartEmulator,
  };
});

// 把当前配置复制成一个新配置（供"为这一天新建配置"）
ipcMain.handle('maa:configCreate', (e, { name, from }) => {
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  const configs = json.Configurations || {};
  const newName = String(name || '').trim();
  if (!newName) return { ok: false, error: '请填写配置名' };
  if (configs[newName]) return { ok: false, error: '配置已存在：' + newName };
  const src = from && configs[from] ? from : json.Current;
  if (!src || !configs[src]) return { ok: false, error: '找不到要复制的源配置' };
  configs[newName] = JSON.parse(JSON.stringify(configs[src]));
  json.Current = newName;
  const w = writeMaaConfig(ps, json);
  if (!w.ok) return w;
  console.log('[maa] 已创建配置', newName, '（复制自', src, '）');
  return { ok: true, name: newName, current: newName };
});

// 记录"某一天使用哪套 MAA 配置"
ipcMain.handle('maa:setDateConfig', (e, { date, name }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: '日期格式不正确' };
  const mp = maaPrefsLocal();
  const map = { ...(mp.dateConfigs || {}) };
  if (name) map[date] = String(name).trim(); else delete map[date];
  prefs.maa = { ...mp, dateConfigs: map };
  savePrefs();
  return { ok: true, date, name: map[date] || null };
});

// 切换到某天绑定的配置（若有）
function applyDateConfig(date) {
  const mp = maaPrefsLocal();
  const name = (mp.dateConfigs || {})[date];
  if (!name) return { ok: true, applied: false, current: null };
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  if (!json.Configurations || !json.Configurations[name]) {
    return { ok: false, error: '这一天绑定的 MAA 配置不存在：' + name };
  }
  if (json.Current === name) return { ok: true, applied: true, current: name };
  json.Current = name;
  const w = writeMaaConfig(ps, json);
  if (!w.ok) return w;
  console.log('[maa] 已按日期切换配置 →', name, '(', date, ')');
  return { ok: true, applied: true, current: name };
}

// 按某天绑定的配置启动 MAA
ipcMain.handle('maa:startForDate', (e, date) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null;
  if (d) {
    const applied = applyDateConfig(d);
    if (applied && applied.ok === false) console.error('[maa] 切换日期配置失败：', applied.error);
  }
  const taskName = maaPrefsLocal().autoStartTask;
  return maaStartWithOptions(taskName, {});
});

ipcMain.handle('maa:configUpdateTasks', (e, { updates, config }) => {
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  const configs = json.Configurations || {};
  // 明确按调用方指定的配置写入（面板显示哪套就改哪套），避免误改共享配置
  const target = config && configs[config] ? config : (json.Current && configs[json.Current] ? json.Current : Object.keys(configs)[0]);
  const cfg = configs[target];
  if (!cfg || !Array.isArray(cfg.TaskQueue)) return { ok: false, error: '配置里没有任务队列：' + target };
  let changed = 0;
  for (const u of (Array.isArray(updates) ? updates : [])) {
    const idx = Number(u && u.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cfg.TaskQueue.length) continue;
    cfg.TaskQueue[idx] = applyTaskPatch(cfg.TaskQueue[idx], u.patch);
    changed++;
  }
  const w = writeMaaConfig(ps, json);
  if (!w.ok) return w;
  console.log('[maa] 已更新配置', target, changed, '项 →', ps.file);
  return { ok: true, changed, config: target, file: ps.file, tasks: buildEditableQueue(cfg.TaskQueue) };
});

ipcMain.handle('maa:configSetCurrent', (e, name) => {
  const r = readMaaConfig();
  if (!r.ok) return r;
  const { json, ps } = r;
  if (!json.Configurations || !json.Configurations[name]) return { ok: false, error: '配置不存在：' + name };
  json.Current = name;
  const w = writeMaaConfig(ps, json);
  if (!w.ok) return w;
  return { ok: true, current: name };
});

// ---- 自动搜索电脑上的 MAA（供一键设置 MAA.exe 路径） ----
function readMaaVersionLabel(dir) {
  const m = /v?(\d+\.\d+(?:\.\d+)?)/i.exec(path.basename(dir));
  if (m) return 'v' + m[1];
  try {
    const st = fs.statSync(path.join(dir, 'MAA.exe'));
    return `${new Date(st.mtimeMs).toLocaleDateString()} 的程序`;
  } catch (e) {
    return '';
  }
}

function collectMaaExe(dir, out, depth) {
  if (!dir || depth < 0) return;
  try {
    if (fs.existsSync(path.join(dir, 'MAA.exe'))) { out.push(dir); return; }
  } catch (e) { return; }
  if (depth === 0) return;
  let subs = [];
  try { subs = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const s of subs) {
    if (!s.isDirectory()) continue;
    const n = s.name.toLowerCase();
    if (n === 'node_modules' || n.startsWith('.') || n === '$recycle.bin' || n === 'windows') continue;
    if (depth <= 1 && !/maa/i.test(n)) continue; // 深层只进入名字含 maa 的目录
    collectMaaExe(path.join(dir, s.name), out, depth - 1);
  }
}

function autoDetectMaa() {
  const roots = [];
  const addRoot = (p) => { try { if (p && fs.existsSync(p) && !roots.includes(p)) roots.push(p); } catch (e) { /* noop */ } };
  const home = process.env.USERPROFILE || '';
  addRoot(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'));
  addRoot(process.env.LOCALAPPDATA);
  addRoot(process.env.APPDATA);
  addRoot('C:\\Program Files');
  addRoot('C:\\Program Files (x86)');
  addRoot(home && path.join(home, 'Desktop'));
  addRoot(home && path.join(home, 'Downloads'));
  addRoot(home && path.join(home, 'Documents'));
  addRoot(home);
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) addRoot(`${letter}:\\`);

  const foundDirs = [];
  for (const root of roots) {
    collectMaaExe(root, foundDirs, 1); // 根目录自身 / 直接子目录
    let subs = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
    const isDiskRoot = /^[A-Z]:\\$/i.test(root);
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const n = s.name.toLowerCase();
      if (n === 'node_modules' || n.startsWith('.') || n === '$recycle.bin' || n === 'windows' || n === 'system volume information') continue;
      const subPath = path.join(root, s.name);
      if (/maa/i.test(n)) {
        collectMaaExe(subPath, foundDirs, 3);
      } else if (isDiskRoot) {
        // 磁盘根：再往下看一层（如 D:\Games\MAA-v6.16.0-win-x64）
        let subs2 = [];
        try { subs2 = fs.readdirSync(subPath, { withFileTypes: true }); } catch (e) { continue; }
        for (const s2 of subs2) {
          if (s2.isDirectory() && /maa/i.test(s2.name)) collectMaaExe(path.join(subPath, s2.name), foundDirs, 3);
        }
      }
    }
  }

  const uniq = [...new Set(foundDirs)];
  const results = uniq.map((dir) => {
    const exePath = path.join(dir, 'MAA.exe');
    let mtime = 0;
    try { mtime = fs.statSync(exePath).mtimeMs; } catch (e) { /* noop */ }
    return { exePath, dir, version: readMaaVersionLabel(dir), mtime };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

  console.log('[maa] 自动搜索完成，找到', results.length, '个 MAA');
  return { ok: true, count: results.length, results };
}

ipcMain.handle('maa:autoDetect', () => {
  try {
    return autoDetectMaa();
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('maa:configOpenDir', async () => {
  const ps = maaConfigPaths();
  if (!ps) return { ok: false, error: '尚未配置 MAA 路径' };
  try {
    fs.mkdirSync(ps.cfgDir, { recursive: true });
    await shell.openPath(ps.cfgDir);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

// ---- MAA 关卡清单（读 MAA 自带的 resource/stages.json，供"选关卡/自动修正"用） ----
let maaLevelsCache = null;

// 最常用的资源本 / 刷材料关（与 MAA 一样置顶）
const COMMON_STAGE_CODES = new Set([
  '1-7', 'CE-6', 'LS-6', 'AP-5', 'SK-5',
  'PR-A-1', 'PR-A-2', 'PR-B-1', 'PR-B-2', 'PR-C-1', 'PR-C-2', 'PR-D-1', 'PR-D-2',
]);
// 分组优先级：当期活动 → 常用资源本 → 剿灭 → 其它活动 → 资源本 → 主线 → 其他
const GROUP_RANK = { current: 0, common: 1, special: 2, event: 3, resource: 4, main: 5, other: 6 };
const GROUP_LABEL = { current: '当期活动', common: '常用', special: '剿灭', event: '活动', resource: '资源本', main: '主线', other: '其他' };

function classifyStage(code, stageId) {
  const sid = String(stageId || '');
  if (COMMON_STAGE_CODES.has(code)) return { group: 'common', groupLabel: GROUP_LABEL.common };
  if (/^a\d{3}/i.test(sid) || /^act/i.test(sid) || /^act\d/i.test(code)) return { group: 'event', groupLabel: GROUP_LABEL.event };
  if (/^wk_/i.test(sid)) return { group: 'resource', groupLabel: GROUP_LABEL.resource };
  if (/^main_/i.test(sid)) return { group: 'main', groupLabel: GROUP_LABEL.main };
  return { group: 'other', groupLabel: GROUP_LABEL.other };
}

// 活动关卡的新旧程度（用于把最新活动排在前面）：act14side_01 → 14；a001_01 → 1
function eventOrderOf(stageId) {
  const sid = String(stageId || '');
  const m1 = /act(\d+)/i.exec(sid);
  if (m1) return Number(m1[1]) || 0;
  const m2 = /^a(\d{3})/i.exec(sid);
  if (m2) return Number(m2[1]) || 0;
  return 0;
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
}

// MAA 资源文件指纹：用于"检测到 MAA 更新后自动同步关卡数据"
function maaResourceFingerprint(dir) {
  const parts = [];
  for (const f of ['resource/stages.json', 'resource/item_index.json']) {
    try {
      const st = fs.statSync(path.join(dir, f));
      parts.push(`${f}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch (e) {
      parts.push(`${f}:missing`);
    }
  }
  return parts.join('|');
}

function loadMaaLevels(opts) {
  const force = !!(opts && opts.force);
  const mp = maaPrefsLocal();
  if (!mp.exePath) return { ok: false, error: '尚未配置 MAA 可执行文件路径' };
  const dir = path.dirname(mp.exePath);
  const stagesFile = path.join(dir, 'resource', 'stages.json');
  if (!fs.existsSync(stagesFile)) {
    return { ok: false, error: '未找到 MAA 关卡数据：' + stagesFile };
  }
  const fingerprint = maaResourceFingerprint(dir);
  // 命中缓存：同一目录 + 资源文件未变（MAA 更新过则指纹变化，自动重新载入）
  if (!force && maaLevelsCache && maaLevelsCache.dir === dir && maaLevelsCache.fingerprint === fingerprint) {
    return { ok: true, ...maaLevelsCache, refreshed: false };
  }
  try {
    const stages = JSON.parse(fs.readFileSync(stagesFile, 'utf-8').replace(/^\uFEFF/, ''));
    let itemMap = {};
    try {
      itemMap = JSON.parse(fs.readFileSync(path.join(dir, 'resource', 'item_index.json'), 'utf-8').replace(/^\uFEFF/, ''));
    } catch (e) { /* 物品名表可选 */ }
    const levels = (Array.isArray(stages) ? stages : []).map((s) => {
      const drops = [];
      for (const d of (s.dropInfos || [])) {
        if (!/DROP/i.test(d.dropType || '')) continue;
        const it = itemMap[d.itemId];
        const name = it && it.name ? it.name : null;
        if (name && !drops.includes(name)) drops.push(name);
      }
      const code = String(s.code || '');
      const stageId = String(s.stageId || '');
      const cls = classifyStage(code, stageId);
      return {
        code,
        stageId,
        apCost: Number(s.apCost) || 0,
        drops: drops.slice(0, 4),
        group: cls.group,
        groupLabel: cls.groupLabel,
        eventOrder: eventOrderOf(stageId),
      };
    }).filter((l) => l.code);

    // 当期活动 = 活动编号最大的那期（最新一期），置顶显示
    const maxEvent = levels.reduce((mx, l) => (l.group === 'event' ? Math.max(mx, l.eventOrder || 0) : mx), 0);
    if (maxEvent > 0) {
      for (const l of levels) {
        if (l.group === 'event' && (l.eventOrder || 0) === maxEvent) {
          l.group = 'current';
          l.groupLabel = GROUP_LABEL.current;
        }
      }
    }

    // 剿灭作战：MAA 的 stages.json 不含剿灭关卡，用 MAA 官方默认代号 Annihilation
    if (!levels.some((l) => l.code === 'Annihilation')) {
      levels.push({
        code: 'Annihilation',
        stageId: 'annihilation',
        apCost: 0,
        drops: [],
        group: 'special',
        groupLabel: GROUP_LABEL.special,
        eventOrder: 0,
      });
    }

    // 开放状态：当期活动=开放中；其它活动=往期；其余=常驻
    for (const l of levels) {
      if (l.group === 'current') l.openState = 'open';
      else if (l.group === 'event') l.openState = 'past';
      else l.openState = 'always';
    }

    // 排序：当期活动 → 常用资源本 → 其它活动（最新优先）→ 资源本 → 主线 → 其他
    levels.sort((a, b) => {
      const byGroup = GROUP_RANK[a.group] - GROUP_RANK[b.group];
      if (byGroup) return byGroup;
      if (a.group === 'event' && b.group === 'event') {
        const byNew = (b.eventOrder || 0) - (a.eventOrder || 0);
        if (byNew) return byNew;
      }
      return naturalCompare(a.code, b.code);
    });

    const prevFp = maaLevelsCache && maaLevelsCache.fingerprint;
    maaLevelsCache = { dir, at: Date.now(), levels, fingerprint };
    const refreshed = !!(prevFp && prevFp !== fingerprint);
    console.log('[maa] 已载入关卡清单', levels.length, '个（当期活动', levels.filter((l) => l.group === 'current').length,
      '/ 常用', levels.filter((l) => l.group === 'common').length, '/ 活动', levels.filter((l) => l.group === 'event').length, '）', refreshed ? '· MAA 已更新，数据已同步' : '');
    return { ok: true, ...maaLevelsCache, refreshed };
  } catch (e) {
    return { ok: false, error: '关卡数据解析失败：' + (e && e.message ? e.message : e) };
  }
}

ipcMain.handle('maa:levels', (e, opts) => {
  const r = loadMaaLevels(opts);
  return r.ok
    ? { ok: true, count: r.levels.length, levels: r.levels, refreshed: !!r.refreshed, at: r.at }
    : r;
});

// ---- MAA 全局设置（每天定时自动启动 + 使用的全局配置） ----
ipcMain.handle('maa:globalGet', () => {
  const mp = maaPrefsLocal();
  const r = readMaaConfig();
  return {
    ok: true,
    global: mp.global,
    weekly: mp.weekly || {},
    todayPlan: pickDailyPlan(mp.weekly, mp.global, dayjs().day()),
    configs: r.ok ? Object.keys(r.json.Configurations || {}) : [],
    configError: r.ok ? '' : r.error,
    maaConfigured: !!(mp.exePath && fs.existsSync(mp.exePath)),
    exePath: mp.exePath,
    autoStartTask: mp.autoStartTask,
    skipIfRunning: mp.skipIfRunning,
    dateConfigs: mp.dateConfigs,
  };
});

ipcMain.handle('maa:globalSet', (e, patch) => {
  const mp = maaPrefsLocal();
  const p = patch || {};
  // weekly 是整块替换（界面传完整表），其余字段是局部合并
  const next = { ...mp, global: { ...mp.global, ...p } };
  delete next.global.weekly;
  if (p.weekly !== undefined) next.weekly = p.weekly;
  prefs.maa = normalizeMaaPrefs(next);
  savePrefs();
  const m2 = maaPrefsLocal();
  return { ok: true, global: m2.global, weekly: m2.weekly || {} };
});

ipcMain.handle('maa:startNow', () => {
  const mp = maaPrefsLocal();
  const plan = pickDailyPlan(mp.weekly, mp.global, dayjs().day());
  if (plan.configName) applyConfigByName(plan.configName);
  return maaStartWithOptions(mp.autoStartTask, { label: '手动启动' });
});

ipcMain.handle('maa:dailyCheck', () => checkDailyMaaStart());

// 打开外部链接（赞助页 / 仓库等）
ipcMain.handle('app:openExternal', async (e, url) => {
  try {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: '仅支持 http/https 链接' };
    await shell.openExternal(u);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('maa:pickExe', async () => {  if (!win) return { ok: false };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择 MAA 可执行文件（MAA.exe）',
    properties: ['openFile'],
    filters: [{ name: '可执行文件', extensions: ['exe'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  prefs.maa = { ...maaPrefsLocal(), exePath: filePaths[0], workDir: path.dirname(filePaths[0]) };
  savePrefs();
  return { ok: true, prefs: maaPrefsLocal() };
});

// ---------------- 时间段（对外接口保持老结构，内部已是 tasks 的一种） ----------------
ipcMain.handle('segments:list', () => segments.map((s) => ({ ...s })));

ipcMain.handle('segments:save', (e, seg) => {
  if (!seg || !seg.date || !seg.start || !seg.end) return { ok: false, error: '缺少日期或起止时间' };
  return upsertSegmentTask(seg);
});

ipcMain.handle('segments:delete', (e, id) => {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    tasks.splice(idx, 1);
    saveTasks();
    broadcastToWidgets('widget:update');
  }
  return { ok: true };
});

// ---------------- 桌面小组件 ----------------
// 小组件配色：每个小组件可以有自己的背景 / 文字 / 强调色
const DEFAULT_WIDGET_PALETTE = { bg: '#ffffff', fg: '#2b3245', accent: '' };

function normalizeWidgetPalette(p) {
  const o = p && typeof p === 'object' ? p : {};
  const hex = (v, fb) => (typeof v === 'string' && /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\([\d\s.,%]+\))$/.test(v.trim()) ? v.trim() : fb);
  return {
    bg: hex(o.bg, DEFAULT_WIDGET_PALETTE.bg),
    fg: hex(o.fg, DEFAULT_WIDGET_PALETTE.fg),
    accent: o.accent ? hex(o.accent, '') : '',
  };
}

ipcMain.handle('widget:list', () => widgetRecs.map((r) => ({ ...r })));

ipcMain.handle('widget:create', (e, { date, x, y, palette }) => {
  if (!date) return { ok: false };
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: String(date),
    x: Number.isFinite(x) ? Math.round(x) : undefined,
    y: Number.isFinite(y) ? Math.round(y) : undefined,
    alwaysOnTop: false,
    palette: palette ? normalizeWidgetPalette(palette) : { ...DEFAULT_WIDGET_PALETTE },
  };
  widgetRecs.push(rec);
  saveWidgets();
  spawnWidgetWin(rec);
  return { ok: true, id: rec.id };
});

ipcMain.handle('widget:setPalette', (e, wid, palette) => {
  const rec = widgetRecs.find((r) => r.id === wid);
  if (!rec) return { ok: false };
  rec.palette = normalizeWidgetPalette(palette);
  saveWidgets();
  return { ok: true, palette: rec.palette };
});

ipcMain.handle('widget:data', (e, wid) => {
  const rec = widgetRecs.find((r) => r.id === wid);
  if (!rec) return null;
  const base = {
    kind: rec.kind === 'maa' ? 'maa' : 'date',
    alwaysOnTop: !!rec.alwaysOnTop,
    palette: normalizeWidgetPalette(rec.palette),
  };
  if (base.kind === 'maa') return { ...base, maa: maaWidgetData() };
  return { ...base, ...widgetDataFor(rec.date) };
});

// MAA 监视小组件的数据
function maaWidgetData() {
  const st = maaStatus();
  const mp = maaPrefsLocal();
  const plan = pickDailyPlan(mp.weekly, mp.global, dayjs().day());
  const step = maaProgress();
  return {
    running: !!st.running,
    pid: st.pid || null,
    minutes: st.startedAt ? Math.max(0, Math.round((Date.now() - st.startedAt) / 60000)) : 0,
    label: st.label || '',
    configured: !!st.configured,
    exePath: st.exePath || '',
    plan: { enabled: !!plan.enabled, time: plan.time || '', configName: plan.configName || '', source: plan.source },
    lastRunDate: (mp.global || {}).lastRunDate || '',
    // 当前进行到哪一步（读 MAA 的 debug/gui.log）
    step: {
      ok: !!step.ok,
      line1: step.line1 || '',
      line2: step.line2 || '',
      tone: step.tone || 'idle',
      currentTask: step.currentTask || '',
      lastSubStep: step.lastSubStep || '',
      lastDoneTask: step.lastDoneTask || '',
      allDone: !!step.allDone,
      elapsedText: step.elapsedText || '',
      staminaText: step.staminaText || '',
      taskId: step.taskId || 0,
      logAgeSec: step.logAgeSec || 0,
      error: step.error || '',
    },
  };
}

// 创建一个 MAA 监视小组件
ipcMain.handle('widget:createMaa', (e, opts) => {
  const o = opts || {};
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: 'maa',
    date: dayjs().format('YYYY-MM-DD'),
    x: Number.isFinite(o.x) ? Math.round(o.x) : undefined,
    y: Number.isFinite(o.y) ? Math.round(o.y) : undefined,
    alwaysOnTop: true,
    palette: o.palette ? normalizeWidgetPalette(o.palette) : { ...DEFAULT_WIDGET_PALETTE },
  };
  widgetRecs.push(rec);
  saveWidgets();
  spawnWidgetWin(rec);
  return { ok: true, id: rec.id };
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

// ---------------- 数据备份 / 恢复 ----------------
const BACKUP_DIR = () => path.join(DATA_DIR(), 'backups');
const BACKUP_KEEP = 7;

function backupNames() {
  try {
    return fs.readdirSync(BACKUP_DIR()).filter((n) => n.endsWith('.json'));
  } catch (e) {
    return [];
  }
}

// 打包当前数据文件成一份备份（单个 JSON，不依赖 zip）
function createBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    const files = {};
    for (const k of BACKUP_FILE_KEYS) {
      const p = path.join(DATA_DIR(), k);
      try {
        if (fs.existsSync(p)) files[k] = fs.readFileSync(p, 'utf-8');
      } catch (e) { /* 读不到就跳过该文件 */ }
    }
    const name = backupName(new Date());
    fs.writeFileSync(path.join(BACKUP_DIR(), name), JSON.stringify(buildPayload(files, new Date()), null, 2), 'utf-8');
    const { remove } = pruneList(backupNames(), BACKUP_KEEP);
    for (const r of remove) {
      try { fs.unlinkSync(path.join(BACKUP_DIR(), r)); } catch (e) { /* noop */ }
    }
    console.log(`[backup] 已备份 ${Object.keys(files).length} 个数据文件 → ${name}（清理 ${remove.length} 份旧备份）`);
    return { ok: true, name, count: Object.keys(files).length };
  } catch (e) {
    console.error('[backup] 备份失败', e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 每天首次启动自动备份一次（失败不影响启动）
function maybeDailyBackup() {
  try {
    if (hasBackupToday(backupNames(), new Date())) return { ok: true, skipped: true };
    return createBackup();
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 恢复后把磁盘内容重新载入内存态（并刷新界面）
function reloadFromDisk() {
  tasks = (loadJSON(TASKS_FILE(), { tasks: [] }).tasks) || [];
  if (!Array.isArray(tasks)) tasks = [];
  const p = loadJSON(PREFS_FILE(), null);
  if (p && typeof p === 'object') prefs = p;
  segments = (loadJSON(SEG_FILE(), { segments: [] }).segments) || [];
  if (!Array.isArray(segments)) segments = [];
  rebuildSegmentsFromTasks();
  widgetRecs = (loadJSON(WIDGET_FILE(), { widgets: [] }).widgets) || [];
  if (!Array.isArray(widgetRecs)) widgetRecs = [];
  dayImgMap = loadJSON(DAYIMG_FILE(), {});
  if (!dayImgMap || typeof dayImgMap !== 'object' || Array.isArray(dayImgMap)) dayImgMap = {};
  loadHolidays();
  if (win && !win.isDestroyed()) win.webContents.send('data:reloaded');
  broadcastToWidgets('widget:update');
  console.log('[backup] 已从备份恢复数据并重新载入');
}

function restoreBackup(name) {
  try {
    const base = path.basename(String(name || ''));
    const p = path.join(BACKUP_DIR(), base);
    if (!base || !fs.existsSync(p)) return { ok: false, error: '备份文件不存在' };
    const parsed = parseBackup(fs.readFileSync(p, 'utf-8'));
    if (!parsed.ok) return parsed;
    // 恢复前先给"当前状态"再留一份，万一恢复错了还能回头
    createBackup();
    const written = [];
    for (const [k, text] of Object.entries(parsed.files)) {
      fs.writeFileSync(path.join(DATA_DIR(), k), text, 'utf-8');
      written.push(k);
    }
    reloadFromDisk();
    return { ok: true, at: parsed.at, files: written };
  } catch (e) {
    console.error('[backup] 恢复失败', e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

ipcMain.handle('backup:list', () => {
  const names = backupNames().sort().reverse();
  const items = names.map((n) => {
    let size = 0;
    let at = '';
    try {
      const full = path.join(BACKUP_DIR(), n);
      size = fs.statSync(full).size;
      const j = JSON.parse(fs.readFileSync(full, 'utf-8'));
      at = j && j.at ? j.at : '';
    } catch (e) { /* 忽略坏文件 */ }
    return { name: n, size, at };
  });
  return { ok: true, dir: BACKUP_DIR(), keep: BACKUP_KEEP, items };
});

ipcMain.handle('backup:create', () => createBackup());

// ---------------- 诊断信息 ----------------
ipcMain.handle('diag:collect', () => {
  let pluginCount = 0;
  try {
    const dir = PLUGIN_DIR();
    if (fs.existsSync(dir)) {
      for (const n of fs.readdirSync(dir)) {
        if (n.endsWith('.js')) pluginCount += 1;
        else {
          try { if (fs.existsSync(path.join(dir, n, 'plugin.json'))) pluginCount += 1; } catch (e) { /* noop */ }
        }
      }
    }
  } catch (e) { /* noop */ }

  const names = backupNames().sort().reverse();
  const mp = maaPrefsLocal();
  const up = updatePrefs();
  const ap = apiPrefs();
  const st = maaStatus();
  const lr = updateState.lastResult;
  const dataFiles = BACKUP_FILE_KEYS.map((k) => {
    const p = path.join(DATA_DIR(), k);
    try {
      const s = fs.statSync(p);
      return { name: k, size: s.size, mtime: new Date(s.mtimeMs).toLocaleString() };
    } catch (e) {
      return { name: k, size: 0, mtime: '（不存在）' };
    }
  });

  return {
    ok: true,
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      startedAt: new Date(APP_STARTED_AT).toLocaleString(),
      uptimeMin: Math.round((Date.now() - APP_STARTED_AT) / 60000),
    },
    paths: { data: DATA_DIR(), backups: BACKUP_DIR(), plugins: PLUGIN_DIR() },
    api: {
      enabled: ap.enabled,
      port: ap.port,
      listening: !!(apiServer && apiServer.listening),
      tokenSet: !!ap.token,
      webhook: ap.webhook ? ap.webhook : '（未配置）',
    },
    update: {
      repo: up.repo,
      autoCheck: up.autoCheck,
      lastCheck: up.lastCheck ? new Date(up.lastCheck).toLocaleString() : '从未',
      ignored: up.ignoredVersion || '（无）',
      lastResult: lr ? (lr.ok ? `成功 · 最新 v${lr.latest}${lr.hasUpdate ? '（有更新）' : '（已最新）'}` : `失败 · ${lr.error || ''}`) : '（无）',
    },
    maa: {
      exePath: mp.exePath || '（未配置）',
      configured: !!(mp.exePath && fs.existsSync(mp.exePath)),
      running: !!st.running,
      runLabel: st.label || '',
      autoStartTask: mp.autoStartTask,
      dateBindings: Object.keys(mp.dateConfigs || {}).length,
      weeklyPlans: Object.keys(mp.weekly || {}).length,
      dailyEnabled: !!(mp.global || {}).dailyEnabled,
      dailyTime: (mp.global || {}).dailyTime || '',
    },
    backup: { count: names.length, latest: names[0] || '（无）', keep: BACKUP_KEEP, dir: BACKUP_DIR() },
    plugins: { count: pluginCount },
    quiet: normalizeQuiet(prefs.quiet),
    morning: morningPrefs(),
    dataFiles,
    counts: { tasks: tasks.length, segments: segments.length, widgets: widgetRecs.length, dayImages: Object.keys(dayImgMap || {}).length },
    errors: diagLog.slice(-40),
  };
});

// 一句话建任务：大脑在 src/nlp.js（纯逻辑），这里只做转发与兜底
let nlpParser = null;
try { nlpParser = require('./nlp'); } catch (e) { nlpParser = null; }
ipcMain.handle('nlp:parseTask', (e, text) => {
  if (!nlpParser || typeof nlpParser.parseQuickTask !== 'function') {
    return { ok: false, error: '一句话解析器未安装' };
  }
  try {
    const r = nlpParser.parseQuickTask(String(text || ''), new Date());
    return r && typeof r === 'object' ? r : { ok: false };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// 命令面板用：只解析日期片段（复用同一份中文解析规则，避免渲染层重复实现）
ipcMain.handle('nlp:parseDate', (e, text) => {
  if (!nlpParser || typeof nlpParser.parseDateExpr !== 'function') return null;
  try {
    return nlpParser.parseDateExpr(String(text || ''), new Date());
  } catch (err) {
    return null;
  }
});
ipcMain.handle('app:openDataDir', async () => {
  try {
    await shell.openPath(DATA_DIR());
    return { ok: true, dir: DATA_DIR() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});
ipcMain.handle('backup:restore', (e, name) => restoreBackup(name));
ipcMain.handle('backup:openDir', async () => {
  try {
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    await shell.openPath(BACKUP_DIR());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
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

// ---------------- 自定义提醒语音 ----------------
const DEFAULT_SOUND_PREFS = { mode: 'system', file: null, volume: 0.8, speak: false, speakText: '' };

function alertSoundPrefs() {
  const s = prefs.alertSound && typeof prefs.alertSound === 'object' ? prefs.alertSound : {};
  return {
    mode: s.mode === 'custom' ? 'custom' : 'system',
    file: s.file || null,
    volume: typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.8,
    speak: !!s.speak,
    speakText: typeof s.speakText === 'string' ? s.speakText : '',
  };
}

function safeSoundAbs(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  const abs = path.join(SOUND_DIR(), path.basename(fileName));
  return fs.existsSync(abs) ? abs : null;
}

ipcMain.handle('sound:pick', async () => {
  if (!win) return { ok: false };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择提醒语音文件',
    properties: ['openFile'],
    filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const src = filePaths[0];
    const ext = path.extname(src).toLowerCase();
    const fileName = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + ext;
    fs.mkdirSync(SOUND_DIR(), { recursive: true });
    fs.copyFileSync(src, path.join(SOUND_DIR(), fileName));
    const abs = path.join(SOUND_DIR(), fileName);
    return { ok: true, fileName, url: absToFileUrl(abs), baseName: path.basename(src) };
  } catch (e) {
    console.error('复制音频失败', e);
    return { ok: false, error: String(e && e.message) };
  }
});

ipcMain.handle('sound:path', (e, fileName) => {
  const abs = safeSoundAbs(fileName);
  return abs ? { ok: true, url: absToFileUrl(abs) } : { ok: false };
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
function createWindow(showOnReady = true) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '开源日历',
    icon: iconPath(),
    backgroundColor: '#f5f7fb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required', // 允许到点自动播放自定义提醒语音
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // showOnReady=false 时只创建不显示（例如后台静默启动需要播放提醒语音）
  win.once('ready-to-show', () => { if (showOnReady) win.show(); });

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

// 窗口图标（任务栏 / Alt+Tab 显示的就是它）：必须用高分辨率主图标，
// 之前误用了 32px 的 tray.png，任务栏上会发糊、也不随主图标更新。
function iconPath() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'icon.ico'), // 多尺寸，Windows 原生支持
    path.join(__dirname, '..', 'assets', 'icon.png'), // 256px 兜底
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
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
  tray.setToolTip('开源日历');
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
    width: rec.kind === 'maa' ? 244 : 232,
    height: rec.kind === 'maa' ? 246 : 196,
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
// 注意：写入与读取必须共用同一份命令行（含 --hidden），否则 getLoginItemSettings
// 因参数不匹配而回报"未启用"，表现为"勾了自启、重开设置又变回未勾选"
function autostartLaunch() {
  return launchConfig({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    appRoot: path.resolve(__dirname, '..'),
  });
}

function applyAutostart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, ...autostartLaunch() });
    return true;
  } catch (e) {
    console.error('设置开机自启失败', e);
    return false;
  }
}

// 读注册表 Run 项原文（Electron 匹配不上时用它兜底核对）
function readRunEntries() {
  return new Promise((resolve) => {
    try {
      execFile(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'],
        { windowsHide: true },
        (err, stdout) => resolve(err ? '' : String(stdout || ''))
      );
    } catch (e) {
      resolve('');
    }
  });
}

// 当前是否真的会开机启动（Electron 判定 + 注册表兜底）
async function autostartEnabled() {
  const launch = autostartLaunch();
  let openAtLogin = false;
  try {
    const s = app.getLoginItemSettings(launch);
    openAtLogin = !!(s && s.openAtLogin);
  } catch (e) {
    openAtLogin = false;
  }
  if (openAtLogin) return { enabled: true, source: 'electron', path: launch.path };
  const runOutput = await readRunEntries();
  const st = autostartState({ openAtLogin: false, runOutput, execPath: launch.path });
  return { enabled: st.enabled, source: st.source, path: launch.path };
}

ipcMain.handle('autostart:get', () => autostartEnabled());

ipcMain.handle('autostart:set', async (e, flag) => {
  const want = !!flag;
  const ok = applyAutostart(want);
  // 写完立刻回读，把真实状态回给渲染层——界面绝不假装成功
  const now = await autostartEnabled();
  if (want && !now.enabled) {
    console.warn('[autostart] 已请求开启但注册表里没查到启动项，可能被安全软件拦截');
  }
  return { ok, enabled: now.enabled, source: now.source };
});

// ---------------- 启动 ----------------
const startHidden = process.argv.includes('--hidden');

app.whenReady().then(() => {
  // 去掉默认菜单栏（File Edit View…）
  Menu.setApplicationMenu(null);

  tasks = (loadJSON(TASKS_FILE(), { tasks: [] }).tasks) || [];
  prefs = { weekStart: 1, notifySound: true, ...loadJSON(PREFS_FILE(), {}) };
  if (!prefs.alertSound || typeof prefs.alertSound !== 'object') prefs.alertSound = { ...DEFAULT_SOUND_PREFS };
  if (!prefs.holidays || typeof prefs.holidays !== 'object') prefs.holidays = { ...DEFAULT_HOLIDAY_PREFS };
  if (!prefs.update || typeof prefs.update !== 'object') prefs.update = { ...DEFAULT_UPDATE_PREFS };
  if (!prefs.api || typeof prefs.api !== 'object') prefs.api = { ...DEFAULT_API_PREFS };
  if (!prefs.api.token) { prefs.api.token = newToken(); savePrefs(); }
  if (!prefs.maa || typeof prefs.maa !== 'object') prefs.maa = { ...DEFAULT_MAA_PREFS };
  loadHolidays(); // 载入休息日 / 调休数据
  maybeDailyBackup(); // 每天首次启动自动备份一次数据
  if (!prefs.festivals || typeof prefs.festivals !== 'object') prefs.festivals = { ...DEFAULT_FESTIVAL_PREFS };
  if (!Array.isArray(prefs.festivals.countries) || !prefs.festivals.countries.length) prefs.festivals.countries = ['cn'];
  if (!Array.isArray(prefs.festivals.hidden)) prefs.festivals.hidden = [];
  if (!Array.isArray(tasks)) tasks = [];
  dayImgMap = loadJSON(DAYIMG_FILE(), {});
  if (!dayImgMap || typeof dayImgMap !== 'object' || Array.isArray(dayImgMap)) dayImgMap = {};
  migrateSegmentsToTasks();   // 老数据：独立时间段 → 时间段任务（只做一次）
  rebuildSegmentsFromTasks(); // 时间段视图由任务派生
  widgetRecs = (loadJSON(WIDGET_FILE(), { widgets: [] }).widgets) || [];
  if (!Array.isArray(widgetRecs)) widgetRecs = [];

  createTray();
  // 开机自启（--hidden）时不弹主窗口，只在后台托盘运行并计时提醒；
  // 需要时点托盘图标 / 再次启动应用会唤出窗口
  if (!startHidden) createWindow();
  restoreWidgets(); // 恢复上次留在桌面的小组件

  setInterval(tick, 10 * 1000);
  tick(); // 立即跑一次（含启动补发）

  startApiServer(); // 启动本地联动接口（可在设置里关闭）

  // 每天定时自动启动 MAA：每分钟检查一次（到点且今天未启动过才执行）
  setInterval(() => { checkDailyMaaStart(); }, 60 * 1000);
  setTimeout(() => { checkDailyMaaStart(); }, 15 * 1000);

  // 开机自启状态：启动时打印一行，便于排查"勾了却显示未勾选"这类问题
  autostartEnabled()
    .then((s) => console.log(`[autostart] 开机自启：${s.enabled ? '已启用' : '未启用'}（来源：${s.source}）`))
    .catch(() => {});

  // 自动检查更新：启动 12 秒后一次，之后每 6 小时一次；失败仅记录日志，不影响使用
  setTimeout(() => {
    if (updatePrefs().autoCheck) checkForUpdates({}).catch(() => {});
  }, 12 * 1000);
  setInterval(() => {
    if (updatePrefs().autoCheck) checkForUpdates({}).catch(() => {});
  }, 6 * 60 * 60 * 1000);

  app.on('activate', () => {
    ensureWindow();
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻：不退出
});

app.on('before-quit', () => {
  isQuitting = true;
  stopApiServer();
});

} // 单实例锁 else 块结束
