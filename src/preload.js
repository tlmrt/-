// preload：安全地暴露 IPC API 给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  saveTask: (task) => ipcRenderer.invoke('tasks:save', task),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  onFocusTask: (cb) => {
    const handler = (_e, taskId) => cb(taskId);
    ipcRenderer.on('focus-task', handler);
    return () => ipcRenderer.removeListener('focus-task', handler);
  },

  // ---- 图片 ----
  // 打开系统文件选择框挑一张图片，复制进应用数据目录
  pickImage: () => ipcRenderer.invoke('img:pick'),
  // 根据文件名返回绝对路径（null 表示不存在）
  imagePath: (fileName) => ipcRenderer.invoke('img:path', fileName),
  // 单日图片：{ 'YYYY-MM-DD': 绝对路径 }
  getDayImages: () => ipcRenderer.invoke('dayimg:get'),
  setDayImage: (date, fileName) => ipcRenderer.invoke('dayimg:set', { date, fileName }),
  // 日历整体背景图（fileName 或 null 移除）
  setBgImage: (fileName) => ipcRenderer.invoke('bgimg:set', fileName),
  // 背景视频：选择/存取
  pickVideo: () => ipcRenderer.invoke('vid:pick'),
  setBgVideo: (fileName) => ipcRenderer.invoke('bgvideo:set', fileName),
  // 图片幻灯片：多选图片（追加用）
  pickManyImages: () => ipcRenderer.invoke('imgs:pick'),
  // 开机自启（后台静默）
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (flag) => ipcRenderer.invoke('autostart:set', flag),
  // 插件系统
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugins:enable', { id, enabled }),
  openPluginDir: () => ipcRenderer.invoke('plugins:openDir'),
  createDemoPlugin: () => ipcRenderer.invoke('plugins:createDemo'),
  openPluginGuide: () => ipcRenderer.invoke('plugins:openGuide'),

  // ---- 应用更新（直连 GitHub 仓库） ----
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdatePage: () => ipcRenderer.invoke('update:openPage'),
  ignoreUpdate: (version) => ipcRenderer.invoke('update:ignore', version),
  setUpdatePrefs: (patch) => ipcRenderer.invoke('update:setPrefs', patch),
  onUpdateAvailable: (cb) => {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },

  // ---- 节假日（休息日 / 调休上班日） ----
  getHolidayStatus: () => ipcRenderer.invoke('holidays:status'),
  getHolidaysMonth: (year, month) => ipcRenderer.invoke('holidays:month', { year, month }),
  updateHolidays: () => ipcRenderer.invoke('holidays:update'),
  importHolidays: () => ipcRenderer.invoke('holidays:import'),
  openHolidayDir: () => ipcRenderer.invoke('holidays:openDir'),

  // ---- 自定义提醒语音 ----
  pickSound: () => ipcRenderer.invoke('sound:pick'),
  soundPath: (fileName) => ipcRenderer.invoke('sound:path', fileName),
  onAlertVoice: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('alert-voice', handler);
    return () => ipcRenderer.removeListener('alert-voice', handler);
  },

  // ---- 节日与农历 ----
  getFestivalsMeta: () => ipcRenderer.invoke('festivals:meta'),
  getFestivalsMonth: (year, month) => ipcRenderer.invoke('festivals:month', { year, month }),

  // ---- 独立时间段（液体效果） ----
  listSegments: () => ipcRenderer.invoke('segments:list'),
  saveSegment: (seg) => ipcRenderer.invoke('segments:save', seg),
  deleteSegment: (id) => ipcRenderer.invoke('segments:delete', id),

  // ---- 桌面小组件 ----
  createWidget: (payload) => ipcRenderer.invoke('widget:create', payload),
  listWidgets: () => ipcRenderer.invoke('widget:list'),
  widgetData: (wid) => ipcRenderer.invoke('widget:data', wid),
  widgetClose: (wid) => ipcRenderer.invoke('widget:close', wid),
  widgetToggleTop: (wid) => ipcRenderer.invoke('widget:toggleTop', wid),
  widgetFocusMain: (wid) => ipcRenderer.invoke('widget:focusMain', wid),
  onWidgetUpdate: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('widget:update', handler);
    return () => ipcRenderer.removeListener('widget:update', handler);
  },
  onFocusDate: (cb) => {
    const handler = (_e, dateStr) => cb(dateStr);
    ipcRenderer.on('focus-date', handler);
    return () => ipcRenderer.removeListener('focus-date', handler);
  },
});
