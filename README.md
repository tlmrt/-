# EveCalendar · 日历提醒

> Windows 桌面日历应用：在日历上按日期与时间安排任务，到点通过 **Windows 系统通知**提醒你。
> 开源（MIT）· 可扩展（插件口）· 全本地存储（隐私友好）

在日历上为每一天安排带具体时间的任务，到点自动弹系统通知；窗口最小化或藏在托盘也照常计时。UI 高度可定制：强调色/背景色、背景图片/图片幻灯片/视频背景、面板透明度，鼠标移出面板还能全屏看背景。

## ✨ 功能一览

- 📅 月视图日历：单击选日、双击该日新建任务；日期格内直接显示当天任务（时间+标题，优先级着色）
- ⏰ 任务：标题 / 日期 / 时间 / 备注 / 标签 / 优先级（低·中·高）
- 🔁 重复任务：每天 / 工作日 / 每周同一天 / 每月同一日（月末自动收敛，如 1/31 → 2/28）
- 🔔 多提醒：一个任务可加多条提醒（准时 / 提前 5/10/15/30 分钟 / 1/2 小时 / 1 天…），点击通知跳回任务
- 🪟 Windows 系统通知 + 失败兜底置顶小窗（开发模式自动启用兜底）
- 🧭 托盘常驻：关窗=最小化到托盘继续计时；点通知/托盘可唤回
- 🚀 开机自启：设置里勾选，开机后台静默运行、到点照常提醒（单实例锁防重复）
- 📷 日期贴纸图：给某个日期放图片，格子右上角缩略图、点击看大图
- 🖼 背景三态：单张图片 / **图片幻灯片**（最多 100 张、间隔可调、顺序或随机且一轮内不重复）/ **视频**（mp4/webm，静音循环）
- 🎛 外观：强调色 + 背景色双通道自由配色、面板透明度滑块、毛玻璃面板、悬停背景虚化看全图
- 🧩 **插件口**：见下文

## 🧩 插件口（开源扩展点）

任何人无需改动核心代码即可扩展日历行为。插件是**用户数据目录 `plugins/` 下的一个文件夹**：

```
%APPDATA%\evestudio-calendar\plugins\
└─ my-plugin/
   ├─ plugin.json      # 元数据（必填）
   └─ renderer.js      # 渲染层扩展脚本（可选）
```

`plugin.json` 示例：

```json
{
  "name": "我的插件",
  "version": "0.1.0",
  "description": "一句话说明",
  "author": "you",
  "renderer": "renderer.js"
}
```

### 渲染层插件能做什么

`renderer.js` 被注入到日历页面执行（与页面同上下文），因此可以：

1. **读写数据 / 调用系统能力**：通过 `window.api`（即 preload 暴露的 IPC）：
   - `listTasks()` `saveTask(task)` `deleteTask(id)`
   - `getPrefs()` `setPrefs(patch)`
   - `pickImage()` `setBgImage(name)` `getDayImages()` `setDayImage(date, name)` 等
2. **订阅事件总线 `window.eveBus`**：

   | 事件 | 载荷 | 时机 |
   |---|---|---|
   | `eve:ready` | — | 应用初始化完成、插件可放心用 API |
   | `eve:task-saved` | task 对象 | 任务创建/更新后 |
   | `eve:task-deleted` | task id | 任务删除后 |
   | `eve:date-selected` | 'YYYY-MM-DD' | 用户切换选中日期后 |
3. **直接操作 DOM / 注入 CSS**：为页面加按钮、面板、横幅、样式。

### 启用 / 停用与加载顺序

- 插件默认启用；在 **⚙ 设置 → 插件** 里可停用/启用（下次启动生效）
- 勾选启动顺序：页面初始化 → `window.api` 就绪 → 逐个注入 `renderer.js` → 广播 `eve:ready`
- 首次启动会自动安装一个 **示例插件**（右下角出现"快捷任务"按钮），参考 `extras/demo-plugin/`

### 安全边界（重要）

渲染层插件与日历页面共享权限：可以读本地任务数据、调用所有 IPC。**请只安装可信来源的插件**，或在代码审查后再使用。想更彻底隔离、增加主进程级插件能力（提醒钩子、网络等），欢迎在仓库提 Issue/PR 讨论设计。

## 🛠 架构

```
src/
  main.js        主进程：窗口/托盘/本地存储/提醒调度引擎/系统通知/图片与插件管理
  reminder.js    提醒引擎（纯逻辑，无 electron 依赖，可单测）
  preload.js     contextBridge 安全桥（渲染层唯一 API 通道 window.api）
  renderer/      渲染层（原生 HTML/CSS/JS，无框架无构建）
    index.html / style.css / app.js
extras/
  demo-plugin/   内置示例插件（首次运行复制到用户插件目录）
assets/          应用图标（icon.png / tray.png，可 python assets/gen_icon.py 重新生成）
test/            reminder.test.js 提醒引擎单测（node test/reminder.test.js）
```

- 数据全部保存在本机：`%APPDATA%\evestudio-calendar\`（tasks.json / prefs.json / dayimages.json / images / plugins）
- 提醒调度：主进程每 10s 扫描一次，按重复规则枚举即将发生的"提醒时刻"（开始 − 提前量），命中且未通知过即弹通知并记录 key；编辑任务若改变时间/重复/提醒会重置记录让新安排生效

## 🧑‍💻 开发

```bash
npm install        # 依赖（项目已配置 npmmirror 镜像，国内直连更稳）
npm start          # 开发模式启动
node test/reminder.test.js   # 提醒引擎单测
npm run dist       # 打包 Windows 安装包(NSIS) + 便携版 → release/
```

## 📜 开源与贡献

- MIT License，见 [LICENSE](LICENSE)。
- 仓库由维护者管理，**写权限仅限维护者本人**；欢迎所有人 Fork 与提交 Pull Request / Issue 参与改进，合并由维护者审阅后执行。
- 尚未推送远程仓库（维护者暂无 GitHub 账号），就绪后按"公开仓库、仅维护者可改"发布。

## 📁 目录速览

```
evestudio-calendar/
├─ src/                核心代码
├─ extras/demo-plugin/ 示例插件模板
├─ test/               单测
├─ assets/             图标
├─ package.json / .npmrc
├─ LICENSE (MIT)
└─ README.md
```
