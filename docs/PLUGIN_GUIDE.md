# EveCalendar 插件开发教程

> 一份文档，从零到发布。看完你就能给日历加自己的功能，**不需要改动应用本身的一行代码**。

---

## 目录

1. [插件是什么](#1-插件是什么)
2. [30 秒上手（单文件插件）](#2-30-秒上手单文件插件)
3. [插件放在哪、怎么启用](#3-插件放在哪怎么启用)
4. [插件元数据（两种写法）](#4-插件元数据两种写法)
5. [window.eve：便捷 API](#5-windoweve便捷-api)
6. [window.eveBus：事件总线](#6-windowevebus事件总线)
7. [window.api：底层能力全表](#7-windowapi底层能力全表)
8. [常用配方 Cookbook](#8-常用配方-cookbook)
9. [调试技巧](#9-调试技巧)
10. [分享与发布](#10-分享与发布)
11. [安全与权限](#11-安全与权限)
12. [FAQ](#12-faq)

---

## 1. 插件是什么

插件就是**一个 JavaScript 文件**（或一个文件夹）。应用启动时扫描插件目录，把每个启用的插件脚本注入到日历页面里执行。因此插件可以：

- 往界面上加东西（按钮、面板、横幅、样式）
- 读写任务、时间段、偏好设置
- 监听应用事件（任务保存、日期切换、初始化完成……）
- 想干什么都行——就像在页面里写脚本一样

**能力边界**：插件跑在页面环境里，没有 Node 文件系统权限（这是刻意的安全设计）；需要读写数据请通过 `window.api`。想要 PNG/JPG 之类资源，可以用文件夹插件形式一起打包。

---

## 2. 30 秒上手（单文件插件）

三步搞定：

1. 打开应用 → **⚙ 设置 → 插件 → 打开插件目录…**（或点「创建示例插件」让应用帮你生成一个）
2. 在目录里新建文件 `my-first-plugin.js`
3. 写入下面内容，保存，**重启应用**：

```js
// @name 我的第一个插件
// @version 1.0.0
// @description 点按钮弹个提示

eve.onReady(async () => {
  eve.button({
    label: '👋 打个招呼',
    onClick: async () => {
      const today = eve.today();
      const tasks = (await eve.tasks()).filter(t => t.date === today);
      eve.toast(`今天有 ${tasks.length} 个任务`);
    },
  });
});
```

回到应用，右下角会出现「👋 打个招呼」按钮，点一下就会告诉你今天有多少任务。**完成！**

> 提示：右上角的 `// @name ...` 注释就是插件元数据，插件列表里显示的名称、版本、描述都来自它。

---

## 3. 插件放在哪、怎么启用

插件目录位于应用数据目录下：

```
%APPDATA%\evestudio-calendar\plugins\
├─ my-first-plugin.js          ← 单文件插件（推荐入门）
├─ demo-hello.js               ← 「创建示例插件」生成的示例
├─ 插件开发教程.md              ← 本文档
└─ advanced-plugin/            ← 文件夹插件（进阶）
   ├─ plugin.json
   ├─ renderer.js
   └─ icon.png                 ← 可放资源文件
```

- **启用 / 停用**：设置 → 插件，勾选框控制；**下次启动应用时生效**
- **打开目录**：设置 → 插件 → 「打开插件目录…」
- **重新加载**：改完插件代码要**重启应用**才会重新注入（直接关窗口只是最小化到托盘，记得从托盘菜单「退出」或重开）

---

## 4. 插件元数据（两种写法）

### 写法 A：单文件插件（简单）

文件名就是插件 id（`hello.js` → id `hello`）。在文件顶部用注释声明：

```js
// @name 天气小组件
// @version 1.2.0
// @description 在右下角显示天气（示例）
// @author 你的名字
```

四个字段都可省略：缺省时名称用文件名、版本 `0.1.0`。

### 写法 B：文件夹插件（进阶，可带多文件与资源）

```
plugins/weather-widget/
├─ plugin.json
├─ renderer.js
└─ assets/icon.png
```

`plugin.json`：

```json
{
  "name": "天气小组件",
  "version": "1.2.0",
  "description": "在右下角显示天气",
  "author": "你的名字",
  "renderer": "renderer.js"
}
```

`renderer.js` 是入口脚本，可以用相对路径读取同目录其他资源（例如 `<img src="./assets/icon.png">` 之类需自行构造 file:// 地址）。

**两种写法可以同时存在**，互不影响。

---

## 5. `window.eve`：便捷 API

一行代码就能出效果，推荐优先使用。

### 数据

| 方法 | 说明 |
|---|---|
| `eve.tasks()` | 取全部任务（数组，元素含 `id/title/date/time/note/tags/priority/repeat/reminders`） |
| `eve.saveTask(task)` | 新建或更新任务（带 `id` 则更新；返回 `{ok, task}`） |
| `eve.deleteTask(id)` | 删除任务 |
| `eve.segments()` | 取全部时间段（`id/date/start/end/title/color`） |
| `eve.saveSegment(seg)` | 新建或更新时间段 |
| `eve.deleteSegment(id)` | 删除时间段 |
| `eve.prefs()` | 取偏好设置（主题、周起始、通知声音等） |
| `eve.setPrefs(patch)` | 局部更新偏好 |

### 界面

| 方法 | 说明 |
|---|---|
| `eve.toast(msg, ms?)` | 顶部滑出提示，默认 2.4 秒 |
| `eve.button({id?, label, onClick})` | 右下角加浮动按钮，返回按钮元素 |
| `eve.panel({id?, title, html, width?})` | 右下角弹出面板，`html` 支持 HTML 字符串 |
| `eve.remove(id)` | 移除自己创建的按钮/面板（按创建时的 id） |

### 事件（快捷订阅）

`eve.onReady(cb)` · `eve.onTaskSaved(cb)` · `eve.onTaskDeleted(cb)` · `eve.onDateSelected(cb)` · `eve.onSegmentSaved(cb)` · `eve.on(事件名, cb)` · `eve.emit(事件名, 数据)`

### 工具

| 方法 | 说明 |
|---|---|
| `eve.today()` | 今天的 `'YYYY-MM-DD'` |

### 完整示例：给今天批量安排三个任务

```js
eve.onReady(() => {
  eve.button({
    id: 'routine',
    label: '🧘 一键日常',
    onClick: async () => {
      const date = eve.today();
      const plan = [['08:00', '晨间阅读'], ['12:30', '散步'], ['21:00', '复盘']];
      for (const [time, title] of plan) {
        await eve.saveTask({
          title, date, time, note: '由插件创建', tags: ['日常'],
          priority: 'medium', repeat: 'none',
          reminders: [{ id: 'r' + Math.random().toString(36).slice(2, 6), offsetMinutes: 10 }],
        });
      }
      eve.toast('已安排今天的日常任务');
    },
  });
});
```

---

## 6. `window.eveBus`：事件总线

`eve.on*` 的底层实现，需要更精细控制时可直接用：

```js
const off = eveBus.on('eve:task-saved', (task) => { /* ... */ });
off(); // 取消订阅
```

| 事件名 | 载荷 | 触发时机 |
|---|---|---|
| `eve:ready` | — | 应用初始化完成、插件已注入完毕（**此时用 API 最安全**） |
| `eve:task-saved` | task 对象 | 任务被创建/更新后 |
| `eve:task-deleted` | task id | 任务被删除后 |
| `eve:date-selected` | `'YYYY-MM-DD'` | 用户切换选中日期后 |
| `eve:segment-saved` | 时间段对象 | 时间段被创建/更新后 |
| `eve:widget-created` | 日期字符串 | 从日历拖出桌面小组件后 |

> 插件也可以用 `eveBus.emit('my-plugin:something', data)` 广播自己的事件，让别的插件订阅。

---

## 7. `window.api`：底层能力全表

`eve.*` 只是常用封装，`window.api` 是完整的 IPC 通道（全部返回 Promise）：

```js
// 任务
api.listTasks()  api.saveTask(task)  api.deleteTask(id)

// 独立时间段（液体倒计时）
api.listSegments()  api.saveSegment(seg)  api.deleteSegment(id)

// 偏好与自启
api.getPrefs()  api.setPrefs(patch)  api.getAutostart()  api.setAutostart(bool)

// 图片
api.pickImage()                 // 打开选图对话框 → {ok, fileName, absPath, url}
api.imagePath(fileName)         // 文件名 → {ok, absPath, url}
api.pickManyImages()            // 多选图片
api.getDayImages()              // { 'YYYY-MM-DD': fileUrl }
api.setDayImage(date, fileName) // 给某天设贴纸图（fileName 传 null 移除）

// 背景媒体
api.setBgImage(fileName)  api.setBgVideo(fileName)  api.pickVideo()

// 桌面小组件
api.createWidget({date, x, y})  api.listWidgets()

// 插件自身
api.listPlugins()  api.openPluginDir()  api.openPluginGuide()  api.createDemoPlugin()

// 事件订阅
api.onFocusTask(cb)  api.onWidgetUpdate(cb)  api.onFocusDate(cb)
```

任务对象结构（`saveTask` 传入的字段）：

```js
{
  id: '可选，更新时带上',
  title: '写周报',
  date: '2026-09-10',      // YYYY-MM-DD
  time: '14:30',           // HH:mm
  note: '附上本周数据',
  tags: ['工作', '重要'],
  priority: 'low | medium | high',
  repeat: 'none | daily | weekdays | weekly | monthly',
  reminders: [{ id: 'r1', offsetMinutes: 10 }]   // 0=准时，10=提前10分钟，1440=提前1天
}
```

时间段对象结构：

```js
{ id: '可选', date: '2026-09-10', start: '14:00', end: '18:00',
  title: '专注工作', color: '#4f6bff' }   // 进行中时该日格子显示液体倒计时
```

---

## 8. 常用配方 Cookbook

### 8.1 统计并显示本月任务数（面板）

```js
eve.onReady(async () => {
  const tasks = await eve.tasks();
  const month = eve.today().slice(0, 7); // 'YYYY-MM'
  const count = tasks.filter(t => t.date.startsWith(month)).length;
  eve.panel({ id: 'stat', title: '本月统计', html: `<div>共 <b>${count}</b> 个任务</div>` });
});
```

### 8.2 给高优先级任务加桌面小组件

```js
eve.onTaskSaved(async (t) => {
  if (t.priority === 'high') {
    await window.api.createWidget({ date: t.date, x: 40, y: 40 });
    eve.toast(`已为「${t.title}」在桌面创建小组件`);
  }
});
```

### 8.3 注入自定义样式

```js
const style = document.createElement('style');
style.textContent = '.topbar { background: linear-gradient(90deg,#4f6bff22,transparent) !important; }';
document.head.appendChild(style);
```

### 8.4 保存插件自己的数据

页面环境有 `localStorage`（按应用域隔离，重启仍在）：

```js
localStorage.setItem('my-plugin:counter', String(n));
const n = Number(localStorage.getItem('my-plugin:counter') || 0);
```

### 8.5 定时执行（例如每 10 分钟提示喝水）

```js
setInterval(() => eve.toast('该喝水啦 💧'), 10 * 60 * 1000);
```

### 8.6 在页面上叠加"任务完成"自定义标记

```js
// 例如给所有 high 优先级任务卡片画个红点（class 详见应用界面结构）
eve.onReady(() => {
  setInterval(() => {
    document.querySelectorAll('.task-card.p-high').forEach(el => {
      if (!el.dataset.pluginDot) {
        el.dataset.pluginDot = '1';
        el.style.outline = '2px dashed rgba(255,90,95,.5)';
      }
    });
  }, 2000);
});
```

---

## 9. 调试技巧

- 在应用窗口按 **Ctrl + Shift + I** 打开开发者工具，`Console` 里能直接看到插件报错
- **Ctrl + R** 重新加载页面（不重启应用就能重载插件代码！改完代码按这个最方便）
- 报错不会影响日历本体：插件抛错只会在控制台打印，其它插件照常运行
- 常见问题：在 `eve:ready` 之前调用 API → 用 `eve.onReady(() => { ... })` 包一层即可

---

## 10. 分享与发布

- **单文件插件**：把你的 `.js` 文件发给别人，让对方丢进插件目录即可（记得在文件头写 `@name`/`@description`/`@author`）
- **文件夹插件**：把整个文件夹打包成 zip 分享
- 想让它进入官方示例：欢迎向仓库提 Pull Request（仓库由维护者审核合并）

---

## 11. 安全与权限

插件与应用页面**同权限**：能读取本机任务/时间段数据、调用所有 IPC。

因此：

- ⚠️ **只安装你信任来源的插件**，或先打开代码审阅一遍
- 不要把不认识的人发来的 `.js` 直接丢进插件目录
- 应用不会联网上传你的数据，插件本身也不具备 Node 的文件系统能力（但能通过 `api` 读写应用数据目录内的图片/配置）

---

## 12. FAQ

**Q：为什么改了插件没反应？**
A：注入发生在应用启动时。按 **Ctrl + R** 重载页面，或重启应用。

**Q：插件能加新的日历视图 / 改提醒逻辑吗？**
A：目前插件是"渲染层扩展"。想扩展主进程级能力（自定义通知渠道、网络请求、提醒钩子等），可以在仓库提 Issue 讨论设计。

**Q：多个插件会互相干扰吗？**
A：名字/样式可能撞车。建议给自己的 DOM 元素加 `my-plugin-` 前缀，事件名用 `插件名:事件` 形式。

**Q：插件里能用 npm 包吗？**
A：渲染层没有打包器，不能直接 `require`。可把纯前端库（UMD 版）作为文件夹插件的资源文件引入，或直接把逻辑写进插件脚本。

---

祝写插件愉快 🎉 有想法欢迎在仓库开 Issue 或 PR。
