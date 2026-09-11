// 提醒卡片窗口的 preload：只暴露「读取卡片数据」与「发送操作」两个能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  get: () => ipcRenderer.invoke('popup:data'),
  act: (action, minutes) => ipcRenderer.send('popup:action', { action: String(action || ''), minutes: Number(minutes) || 0 }),
});
