// @name 示例插件：今日概览
// @version 1.0.0
// @description 单文件插件示例：右下角加一个按钮，点一下显示今天的任务与时间段
// @author EveStudio
//
// ── 这是一个「单文件插件」：把这个 .js 文件丢进插件目录，它就是一个插件了 ──
// 插件运行在日历页面里，可以使用：
//   window.eve     便捷 API（按钮 / 面板 / 提示 / 数据 / 事件）
//   window.eveBus  事件总线（可订阅核心事件）
//   window.api     底层 IPC（更细的能力：任务、时间段、图片、偏好等）
// 完整文档：应用「设置 → 插件 → 插件开发教程」，或仓库 docs/PLUGIN_GUIDE.md

(function () {
  'use strict';

  // 等应用初始化完成后再动手（此时 window.eve / window.api 都已就绪）
  eve.onReady(async () => {

    // 1) 在右下角加一个按钮
    eve.button({
      id: 'today-overview',
      label: '📋 今日概览',
      onClick: async () => {
        // 2) 读取数据（都可以直接用 eve.xxx）
        const today = eve.today();
        const tasks = (await eve.tasks()).filter((t) => t.date === today);
        const segs = (await eve.segments()).filter((s) => s.date === today);

        const taskRows = tasks.length
          ? tasks.map((t) => `<div>• <b>${t.time}</b> ${t.title}</div>`).join('')
          : '<div style="color:#9aa1b0">今天还没有任务</div>';
        const segRows = segs
          .map((s) => `<div>⏳ ${s.start}-${s.end} ${s.title || '时间段'}</div>`)
          .join('');

        // 3) 弹出面板展示
        eve.remove('today-overview'); // 先关掉可能已打开的旧面板（同名 id）
        eve.panel({
          id: 'today-overview',
          title: '今日概览',
          html: taskRows + (segRows ? '<hr style="border:none;border-top:1px solid #eef0f6;margin:8px 0">' + segRows : ''),
        });
      },
    });

    // 4) 监听核心事件：任务保存时给个小提示
    eve.onTaskSaved((t) => eve.toast(`插件：已保存「${t.title}」`));
  });
})();
