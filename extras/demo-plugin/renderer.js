// ============================================================
// EveCalendar 示例插件（渲染层）
//
// 插件运行在渲染进程的主页面里，可以：
//  - 使用 window.api.*（任务增删改查、偏好、图片等 IPC）
//  - 订阅 window.eveBus 事件总线（见 README「插件口」章节）
//  - 自由操作 DOM / 修改样式
//
// 注意：插件与页面同权限，请只安装可信来源的插件。
// ============================================================
(function () {
  'use strict';

  const PLUGIN_NAME = '快捷任务';

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function pluginToast(msg) {
    const t = document.createElement('div');
    t.textContent = `[插件] ${msg}`;
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '86px', transform: 'translateX(-50%)',
      background: '#1f2430', color: '#fff', padding: '8px 16px', borderRadius: '10px',
      fontSize: '13px', zIndex: 200, boxShadow: '0 6px 20px rgba(0,0,0,.25)',
      opacity: '0', transition: 'opacity .25s', pointerEvents: 'none', maxWidth: '70vw',
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2400);
  }

  function addFloatingUI() {
    if (document.getElementById('demo-plugin-ui')) return;

    const wrap = document.createElement('div');
    wrap.id = 'demo-plugin-ui';
    Object.assign(wrap.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 150,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
    });

    const badge = document.createElement('div');
    badge.textContent = `⚡ 插件：${PLUGIN_NAME} 已运行`;
    Object.assign(badge.style, {
      background: 'rgba(31,36,48,.85)', color: '#fff', fontSize: '12px',
      padding: '5px 12px', borderRadius: '20px', boxShadow: '0 3px 12px rgba(0,0,0,.2)',
    });

    const btn = document.createElement('button');
    btn.textContent = '＋ 快速任务（插件演示）';
    Object.assign(btn.style, {
      border: 'none', background: 'linear-gradient(135deg,#4f6bff,#8b5cf6)', color: '#fff',
      fontSize: '13px', fontWeight: '600', padding: '8px 14px', borderRadius: '10px',
      cursor: 'pointer', boxShadow: '0 4px 14px rgba(79,107,255,.4)',
    });
    btn.addEventListener('click', async () => {
      try {
        const payload = {
          title: '插件创建的示例任务',
          date: todayStr(),
          time: '23:00',
          note: '这条任务由示例插件通过 window.api 创建',
          tags: ['插件'],
          priority: 'medium',
          repeat: 'none',
          reminders: [{ id: 'p_' + Date.now().toString(36), offsetMinutes: 10 }],
        };
        const res = await window.api.saveTask(payload);
        pluginToast(res && res.ok ? '已创建，可到任务面板查看' : '创建失败');
      } catch (e) {
        pluginToast('创建失败：' + (e && e.message ? e.message : e));
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(badge);
    document.body.appendChild(wrap);
  }

  // 订阅核心事件总线
  if (window.eveBus && window.eveBus.on) {
    window.eveBus.on('eve:task-saved', (task) => {
      if (task && task.title) pluginToast(`任务「${task.title}」已保存`);
    });
    window.eveBus.on('eve:task-deleted', () => pluginToast('有任务被删除'));
  }

  // 等核心就绪后注入界面
  function boot() {
    addFloatingUI();
    pluginToast(`${PLUGIN_NAME} 已加载，可点右下角按钮试试`);
  }
  if (window.eveBus && window.eveBus.__ready) boot();
  else if (window.eveBus && window.eveBus.on) {
    window.eveBus.on('eve:ready', boot);
    // 若 ready 已错过，则页面加载完成后兜底启动
    if (document.readyState === 'complete') setTimeout(boot, 600);
    else window.addEventListener('load', () => setTimeout(boot, 600));
  } else {
    // 极老场景：无事件总线时直接启动
    window.addEventListener('load', () => setTimeout(boot, 800));
  }
})();
