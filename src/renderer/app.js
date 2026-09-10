// ===== EveCalendar 渲染层逻辑 =====
/* global window, document */
// ---------- 日期工具（本地时间，无第三方依赖） ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function dateOf(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(y, m - 1, d); }
function at(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

// ---------- 状态 ----------
let tasks = [];
let dayImgUrls = {}; // { 'YYYY-MM-DD': fileUrl } 单日贴纸图
let segments = [];   // 独立时间段 [{id,date,start,end,title,color}]
let festCache = {};  // `${y}-${m}` -> { 'YYYY-MM-DD': { lunar, lunarFull, festivals } }
const festLoading = {};
let prefs = { weekStart: 1, notifySound: true };
let viewY = new Date().getFullYear();
let viewM = new Date().getMonth();
let selectedDate = fmtDate(new Date());
let remindDraft = []; // 当前编辑任务草稿中的提醒 [{id, offsetMinutes}]
let suppressClickUntil = 0; // 拖拽结束后短暂抑制 click，避免误选日期

// ---------- 快捷 DOM ----------
const $ = (s) => document.querySelector(s);

// ---------- 事件总线（插件扩展点：window.eveBus） ----------
window.eveBus = (function () {
  const map = {};
  return {
    on(ev, cb) {
      (map[ev] = map[ev] || []).push(cb);
      return () => this.off(ev, cb);
    },
    off(ev, cb) {
      const a = map[ev];
      if (a) { const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }
    },
    emit(ev, data) {
      (map[ev] || []).slice().forEach((cb) => { try { cb(data); } catch (e) { console.error('[eveBus]', ev, e); } });
    },
    __ready: false,
  };
})();

// ---------- 插件便捷 API（window.eve）—— 让插件几行代码就能出效果 ----------
window.eve = (function () {
  const pad2 = (n) => String(n).padStart(2, '0');

  function dock() {
    let d = document.getElementById('eve-plugin-dock');
    if (!d) {
      d = document.createElement('div');
      d.id = 'eve-plugin-dock';
      Object.assign(d.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 150,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
      });
      document.body.appendChild(d);
    }
    return d;
  }

  return {
    // ---- 数据 ----
    tasks: () => window.api.listTasks(),
    saveTask: (t) => window.api.saveTask(t),
    deleteTask: (id) => window.api.deleteTask(id),
    segments: () => window.api.listSegments(),
    saveSegment: (s) => window.api.saveSegment(s),
    prefs: () => window.api.getPrefs(),
    setPrefs: (p) => window.api.setPrefs(p),

    // ---- 事件 ----
    on: (ev, cb) => window.eveBus.on(ev, cb),
    emit: (ev, d) => window.eveBus.emit(ev, d),
    onReady: (cb) => window.eveBus.on('eve:ready', cb),
    onTaskSaved: (cb) => window.eveBus.on('eve:task-saved', cb),
    onTaskDeleted: (cb) => window.eveBus.on('eve:task-deleted', cb),
    onDateSelected: (cb) => window.eveBus.on('eve:date-selected', cb),
    onSegmentSaved: (cb) => window.eveBus.on('eve:segment-saved', cb),

    // ---- 界面 ----
    toast(msg, ms) {
      const t = document.createElement('div');
      t.textContent = String(msg);
      Object.assign(t.style, {
        position: 'fixed', left: '50%', bottom: '86px', transform: 'translateX(-50%)',
        background: '#1f2430', color: '#fff', padding: '8px 16px', borderRadius: '10px',
        fontSize: '13px', zIndex: 400, boxShadow: '0 6px 20px rgba(0,0,0,.25)',
        opacity: '0', transition: 'opacity .25s', pointerEvents: 'none', maxWidth: '70vw',
      });
      document.body.appendChild(t);
      requestAnimationFrame(() => { t.style.opacity = '1'; });
      setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
      }, ms || 2400);
    },

    // 右下角浮动按钮（返回按钮元素）
    button(opts) {
      const o = opts || {};
      const b = document.createElement('button');
      if (o.id) b.id = `eve-btn-${o.id}`;
      b.textContent = o.label || '插件按钮';
      Object.assign(b.style, {
        border: 'none', background: 'linear-gradient(135deg,#4f6bff,#8b5cf6)', color: '#fff',
        fontSize: '13px', fontWeight: '600', padding: '8px 14px', borderRadius: '10px',
        cursor: 'pointer', boxShadow: '0 4px 14px rgba(79,107,255,.4)',
      });
      if (typeof o.onClick === 'function') b.addEventListener('click', o.onClick);
      dock().appendChild(b);
      return b;
    },

    // 浮动面板（带标题与关闭按钮），html 为字符串
    panel(opts) {
      const o = opts || {};
      const wrap = document.createElement('div');
      if (o.id) wrap.id = `eve-panel-${o.id}`;
      Object.assign(wrap.style, {
        position: 'fixed', right: '16px', bottom: '70px', width: (o.width || 260) + 'px',
        background: '#fff', borderRadius: '14px', boxShadow: '0 14px 40px rgba(16,24,40,.24)',
        border: '1px solid rgba(16,24,40,.08)', zIndex: 160, overflow: 'hidden',
        color: '#1f2430',
      });
      wrap.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;background:#fbfcff;border-bottom:1px solid #eef0f6">
          <strong style="font-size:13px">${o.title || '插件面板'}</strong>
          <button style="border:none;background:transparent;cursor:pointer;color:#9aa1b0;font-size:12px;padding:2px 6px;border-radius:6px">✕</button>
        </div>
        <div style="padding:10px 12px;font-size:12.5px;line-height:1.6;max-height:300px;overflow:auto">${o.html || ''}</div>`;
      wrap.querySelector('button').addEventListener('click', () => wrap.remove());
      document.body.appendChild(wrap);
      return wrap;
    },

    // 移除自己创建的 UI（按 id）
    remove(id) {
      const el = document.getElementById(`eve-btn-${id}`) || document.getElementById(`eve-panel-${id}`) || document.getElementById(id);
      if (el) el.remove();
    },

    // ---- 日期工具 ----
    today() {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    },
  };
})();

// ---------- 规则判断：某任务在 dateStr 这天是否发生 ----------
function taskOccursOn(task, dateStr) {
  const rule = task.repeat || 'none';
  if (rule === 'none') return task.date === dateStr;
  const d = dateOf(dateStr);
  if (rule === 'daily') return true;
  if (rule === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (rule === 'weekly') return task.date && d.getDay() === dateOf(task.date).getDay();
  if (rule === 'monthly') {
    const day = Number(task.date.split('-')[2]);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(day, dim) || d.getDate() === day;
  }
  return false;
}

function tasksOn(dateStr) {
  return tasks
    .filter((t) => taskOccursOn(t, dateStr))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// ---------- 时间段（液体效果） ----------
function segmentsOn(dateStr) {
  return segments
    .filter((s) => s.date === dateStr)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

// 时间段的起止毫秒（结束时间不晚于开始时间时，视为跨夜到次日）
function segRange(seg) {
  const start = at(seg.date, seg.start).getTime();
  let end = at(seg.date, seg.end).getTime();
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

// 正在进行中的时间段 → { seg, ratio（剩余比例 0~1）, remainMs }
function activeSegmentOn(dateStr, nowMs) {
  const now = nowMs || Date.now();
  for (const s of segmentsOn(dateStr)) {
    const { start, end } = segRange(s);
    if (now >= start && now < end) {
      const total = end - start;
      return { seg: s, ratio: total > 0 ? (end - now) / total : 0, remainMs: end - now };
    }
  }
  return null;
}

function fmtRemain(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
}

function segLabel(s) {
  return `${s.start}-${s.end}`;
}

// ---------- 节日与农历（按月从主进程取，带缓存） ----------
function festKey(y, m) { return `${y}-${m}`; }

function ensureFestMonth(y, m) {
  const key = festKey(y, m);
  if (festCache[key] || festLoading[key]) return;
  festLoading[key] = true;
  window.api.getFestivalsMonth(y, m)
    .then((map) => { festCache[key] = map || {}; })
    .catch((e) => { festCache[key] = {}; console.error('节日数据加载失败', e); })
    .finally(() => {
      delete festLoading[key];
      renderCalendar();
      renderDayPanel();
    });
}

function festOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const map = festCache[festKey(y, m)];
  return map ? map[dateStr] : null;
}

function clearFestCache() {
  festCache = {};
}

// ---------- 节假日 / 休息日（按月从主进程取，带缓存） ----------
let holidayCache = {}; // `${y}-${m}` -> { 'YYYY-MM-DD': { type:'off'|'work', name } }
const holidayLoading = {};

function ensureHolidayMonth(y, m) {
  const key = festKey(y, m);
  if (holidayCache[key] || holidayLoading[key]) return;
  holidayLoading[key] = true;
  window.api.getHolidaysMonth(y, m)
    .then((map) => { holidayCache[key] = map || {}; })
    .catch((e) => { holidayCache[key] = {}; console.error('休息日数据加载失败', e); })
    .finally(() => {
      delete holidayLoading[key];
      renderCalendar();
      renderDayPanel();
    });
}

function holidayOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const map = holidayCache[festKey(y, m)];
  return map ? map[dateStr] : null;
}

function holidayPrefsLocal() {
  return Object.assign({ showRest: true, showWorkday: true }, prefs.holidays || {});
}

// ---------- 渲染月历 ----------
function renderCalendar() {
  ensureFestMonth(viewY, viewM + 1); // 懒加载本月节日/农历，加载完自动重绘
  ensureHolidayMonth(viewY, viewM + 1); // 懒加载本月休息日/调休数据
  const ws = prefs.weekStart === 0 ? 0 : 1;
  // 星期表头
  let headHtml = '';
  for (let i = 0; i < 7; i++) {
    const idx = (ws + i) % 7;
    headHtml += `<span>${WEEK_CN[idx]}</span>`;
  }
  $('#calHead').innerHTML = headHtml;
  // 网格
  const first = new Date(viewY, viewM, 1);
  const offset = (first.getDay() - ws + 7) % 7;
  const gridStart = new Date(viewY, viewM, 1 - offset);
  const todayStr = fmtDate(new Date());

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const ds = fmtDate(d);
    const inMonth = d.getMonth() === viewM;
    const isToday = ds === todayStr;
    const isSel = ds === selectedDate;
    const dayTasks = tasksOn(ds);
    let cellTasks = '';
    dayTasks.slice(0, 3).forEach((t) => {
      cellTasks += `<div class="cell-task p-${t.priority}" title="${esc(t.time)} ${esc(t.title)}">${esc(t.time)} ${esc(t.title)}</div>`;
    });
    if (dayTasks.length > 3) cellTasks += `<div class="cell-more">还有 ${dayTasks.length - 3} 项…</div>`;

    // 时间段：进行中 → 液体倒计时；未开始/已结束 → 只显示标记行
    const segs = segmentsOn(ds);
    const act = activeSegmentOn(ds, nowTick);
    let segLine = '';
    if (segs.length) {
      const s0 = act ? act.seg : segs[0];
      const label = `${segLabel(s0)}${s0.title ? ' ' + s0.title : ''}`;
      segLine = `<div class="cell-seg" style="--lc:${esc(s0.color)}" title="${esc(label)}"><i></i>${esc(label)}</div>`;
    }
    let liquid = '';
    if (act) {
      const pct = Math.max(0, Math.min(100, act.ratio * 100));
      liquid = `<div class="liquid" style="--lc:${esc(act.seg.color)};height:${pct.toFixed(1)}%">
        <span class="liquid-pct">${Math.round(pct)}%</span>
      </div>`;
    }

    // 休息日 / 调休上班日标记
    const holi = holidayOf(ds);
    const hp = holidayPrefsLocal();
    let holiBadge = '';
    let holiClass = '';
    if (holi && holi.type === 'off' && hp.showRest) {
      holiBadge = `<span class="holi-badge off" title="${esc((holi.name ? holi.name + ' ' : '') + '放假休息')}">休</span>`;
      holiClass = ' is-holiday';
    } else if (holi && holi.type === 'work' && hp.showWorkday) {
      holiBadge = `<span class="holi-badge work" title="${esc((holi.name ? holi.name + ' ' : '') + '调休上班')}">班</span>`;
      holiClass = ' is-workday';
    }

    // 节日与农历
    const fest = festOf(ds);
    let festInner = '';
    if (fest) {
      const names = (fest.festivals || []);
      const nameTxt = names.slice(0, 2).join('、') + (names.length > 2 ? `+${names.length - 2}` : '');
      const lunarHtml = fest.lunar ? `<span class="lunar-name">${esc(fest.lunar)}</span>` : '';
      const titleTxt = `${names.join('、')}${fest.lunarFull ? (names.length ? ' · ' : '') + fest.lunarFull : ''}`;
      if (nameTxt) {
        festInner = `<span class="fest-name" title="${esc(titleTxt)}">${esc(nameTxt)}</span>${lunarHtml}`;
      } else if (lunarHtml) {
        festInner = lunarHtml;
      }
    }
    const festRow = (holiBadge || festInner) ? `<div class="cell-fest">${holiBadge}${festInner}</div>` : '';

    html += `<div class="day-cell ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${act ? 'has-liquid' : ''}${holiClass}" data-date="${ds}">
      ${liquid}
      <div class="day-num">${d.getDate()}</div>
      ${festRow}
      ${dayImgUrls[ds] ? `<img class="cell-img" src="${dayImgUrls[ds]}" alt="" />` : ''}
      ${cellTasks ? `<div class="cell-tasks">${cellTasks}</div>` : ''}
      ${segLine}
    </div>`;
  }
  $('#calGrid').innerHTML = html;

  // 标题（"YYYY年 M月"）
  $('#monthTitle').textContent = `${viewY}年 ${viewM + 1}月`;
}

// 每秒刷新液面高度与百分比（不整表重绘；状态切换时才重绘）
let nowTick = Date.now();
function updateLiquids() {
  nowTick = Date.now();
  let needRerender = false;
  document.querySelectorAll('.day-cell').forEach((cell) => {
    const ds = cell.dataset.date;
    if (!ds) return;
    const act = activeSegmentOn(ds, nowTick);
    const el = cell.querySelector('.liquid');
    const hasSegLine = !!cell.querySelector('.cell-seg');
    const wantSegLine = segmentsOn(ds).length > 0;
    if (wantSegLine !== hasSegLine) needRerender = true;
    if (act) {
      if (!el) { needRerender = true; return; }
      const pct = Math.max(0, Math.min(100, act.ratio * 100));
      el.style.height = pct.toFixed(1) + '%';
      el.style.setProperty('--lc', act.seg.color);
      const label = el.querySelector('.liquid-pct');
      if (label) label.textContent = Math.round(pct) + '%';
    } else if (el) {
      needRerender = true; // 时间段结束 → 移除液体
    }
  });
  if (needRerender) renderCalendar();
}

// 绑定月历格子点击：用事件委托一次性绑定，DOM 重建也不会失效
let calEventsBound = false;
function bindCalEvents() {
  if (calEventsBound) return;
  calEventsBound = true;
  document.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return; // 刚从日历格子拖出小组件，忽略这次点击
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    // 点格子内图片贴纸 → 只看大图，不切换选中日
    const img = e.target.closest('.cell-img');
    if (img) {
      showLightbox(img.src);
      return;
    }
    // 双击（第二次点击）→ 直接在该日期新建任务
    if (e.detail >= 2) {
      selectedDate = cell.dataset.date;
      openTaskModal(null);
      return;
    }
    selectedDate = cell.dataset.date;
    renderCalendar();
    renderDayPanel();
    window.eveBus.emit('eve:date-selected', selectedDate);
  });
}

// 大图查看
function showLightbox(url) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  const im = document.createElement('img');
  im.src = url;
  lb.appendChild(im);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

// 鼠标悬停在面板以外的背景空白处 → 虚化面板，显示完整背景
function initBgPeek() {
  document.addEventListener('mouseover', (e) => {
    const hasBg = hasBgMedia();
    if (!hasBg) { document.body.classList.remove('peek'); return; }
    const onPanel = !!e.target.closest('.topbar, .cal-panel, .day-panel');
    const inOverlay = !!e.target.closest('.modal-mask, .lightbox, #confirmWrap');
    document.body.classList.toggle('peek', !onPanel && !inOverlay);
  });
}

// ---------- 右侧日面板 ----------
function renderDayPanel() {
  const dt = dateOf(selectedDate);
  const wd = WEEK_CN[dt.getDay()];
  const fest = festOf(selectedDate);
  let festSub = '';
  if (fest) {
    const parts = [];
    if (fest.festivals && fest.festivals.length) parts.push(`<span class="fest-name">${esc(fest.festivals.join('、'))}</span>`);
    if (fest.lunarFull) parts.push(esc(fest.lunarFull));
    if (parts.length) festSub = ` <span class="day-sub">${parts.join(' · ')}</span>`;
  }
  $('#dayTitle').innerHTML = `${selectedDate} <span style="color:#9aa1b0;font-size:13px;font-weight:500">周${wd}</span>${festSub}`;

  const segs = segmentsOn(selectedDate);
  const list = tasksOn(selectedDate);
  const box = $('#dayTasks');
  box.querySelectorAll('.task-card, .seg-card').forEach((n) => n.remove());

  const isEmpty = !list.length && !segs.length;
  $('#emptyTip').style.display = isEmpty ? 'block' : 'none';
  if (isEmpty) $('#emptyTip').textContent = '这一天还没有安排，点「＋ 添加任务」或「⏳」加个时间段吧';

  // 时间段卡片（置顶展示，进行中的显示剩余时间）
  if (segs.length) {
    const nowMs = Date.now();
    const act = activeSegmentOn(selectedDate, nowMs);
    const frag = document.createDocumentFragment();
    segs.forEach((s) => {
      const isActive = !!act && act.seg.id === s.id;
      const el = document.createElement('div');
      el.className = `seg-card${isActive ? ' active' : ''}`;
      el.style.setProperty('--lc', s.color);
      el.innerHTML = `
        <span class="seg-time">${esc(segLabel(s))}</span>
        <span class="seg-title">${esc(s.title || '时间段')}</span>
        ${isActive ? `<span class="seg-left">剩余 ${esc(fmtRemain(act.remainMs))}</span>` : ''}
        <span class="seg-actions">
          <button class="mini-btn" data-act="edit" title="编辑">✎</button>
          <button class="mini-btn del" data-act="del" title="删除">🗑</button>
        </span>`;
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openSegModal(s));
      el.querySelector('[data-act="del"]').addEventListener('click', () => askDeleteSeg(s));
      frag.appendChild(el);
    });
    box.prepend(frag);
  }

  if (!list.length) return;

  const REPEAT_CN = { daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月' };
  list.forEach((t) => {
    const el = document.createElement('div');
    el.className = `task-card p-${t.priority}`;
    el.dataset.id = t.id;
    const tagHtml = (t.tags || [])
      .map((x) => `<span class="tag-chip">${esc(x)}</span>`)
      .join('');
    el.innerHTML = `
      <div class="tc-top">
        <span class="tc-time">${t.time}</span>
        <span class="tc-title">${esc(t.title)}</span>
        ${t.repeat && t.repeat !== 'none' ? `<span class="repeat-badge">↻ ${REPEAT_CN[t.repeat]}</span>` : ''}
      </div>
      ${t.note ? `<div class="tc-note">${esc(t.note)}</div>` : ''}
      <div class="tc-bottom">
        <div class="tc-tags">${tagHtml}${t.maa && t.maa.enabled ? `<span class="maa-tag" title="到点自动启动 MAA：${esc(t.maa.task)}">🎮 ${esc(t.maa.task)}</span>` : ''}</div>
        <div class="tc-actions">
          ${t.maa && t.maa.enabled ? '<button class="mini-btn" data-act="maa" title="立即启动 MAA">▶</button>' : ''}
          <button class="mini-btn" data-act="edit" title="编辑">✎</button>
          <button class="mini-btn del" data-act="del" title="删除">🗑</button>
        </div>
      </div>`;
    box.appendChild(el);
    const maaBtn = el.querySelector('[data-act="maa"]');
    if (maaBtn) maaBtn.addEventListener('click', () => runMaaForTask(t));
    el.querySelector('[data-act="edit"]').addEventListener('click', () => openTaskModal(t));
    el.querySelector('[data-act="del"]').addEventListener('click', () => askDelete(t));
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 提醒描述 ----------
function offsetDesc(min) {
  min = Number(min);
  if (min === 0) return '准时';
  if (min === 1440) return '提前 1 天';
  if (min === 2880) return '提前 2 天';
  if (min % 1440 === 0) return `提前 ${min / 1440} 天`;
  if (min % 60 === 0) return `提前 ${min / 60} 小时`;
  return `提前 ${min} 分钟`;
}

// ---------- 任务弹窗 ----------
const OFFSET_CHOICES = [
  [0, '准时'], [5, '提前 5 分钟'], [10, '提前 10 分钟'], [15, '提前 15 分钟'],
  [30, '提前 30 分钟'], [60, '提前 1 小时'], [120, '提前 2 小时'], [1440, '提前 1 天'],
];

function renderReminders() {
  const wrap = $('#reminderList');
  wrap.innerHTML = '';
  remindDraft.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'reminder-row';
    row.innerHTML = `
      <span class="rm-time">任务开始前</span>
      <span class="rm-desc">${offsetDesc(r.offsetMinutes)}</span>
      <button type="button" class="rm-del" data-i="${i}">✕</button>`;
    row.querySelector('.rm-del').addEventListener('click', () => {
      remindDraft.splice(i, 1);
      renderReminders();
    });
    wrap.appendChild(row);
  });
}

function openTaskModal(task) {
  $('#taskModalTitle').textContent = task ? '编辑任务' : '新建任务';
  $('#fId').value = task ? task.id : '';
  $('#fTitle').value = task ? task.title : '';
  $('#fDate').value = task ? task.date : selectedDate;
  const defaultTime = task ? task.time : '09:00';
  $('#fTime').value = defaultTime;
  $('#fRepeat').value = task ? (task.repeat || 'none') : 'none';
  $('#fPriority').value = task ? (task.priority || 'medium') : 'medium';
  $('#fTags').value = task && task.tags ? task.tags.join(', ') : '';
  $('#fNote').value = task ? (task.note || '') : '';
  remindDraft = task && task.reminders && task.reminders.length
    ? task.reminders.map((r) => ({ id: r.id, offsetMinutes: Number(r.offsetMinutes) || 0 }))
    : [{ id: 'r0', offsetMinutes: 0 }];
  renderReminders();

  // MAA 联动（任务级）
  renderMaaTaskField(task);

  $('#taskModal').hidden = false;
}

// 任务弹窗里的 MAA 联动字段
function renderMaaTaskField(task) {
  const cur = (task && task.maa) || {};
  const preset = (prefs.maa && Array.isArray(prefs.maa.tasks)) ? prefs.maa.tasks : [];
  const enabled = !!cur.enabled;
  $('#fMaaEnabled').checked = enabled;
  $('#maaTaskWrap').hidden = !enabled;
  const names = [...new Set([...(cur.task ? [cur.task] : []), ...preset])];
  if (!names.length) names.push((prefs.maa && prefs.maa.autoStartTask) || '默认');
  const sel = $('#fMaaTask');
  sel.innerHTML = '';
  names.forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = cur.task || names[0];
  $('#fMaaAutoStop').value = cur.autoStopMin ? String(cur.autoStopMin) : '';
}

$('#fMaaEnabled').addEventListener('change', (e) => {
  $('#maaTaskWrap').hidden = !e.target.checked;
});

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeModal(b.dataset.close));
});
document.querySelectorAll('.modal-mask').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
});

// 添加提醒下拉 + 按钮
$('#btnAddReminder').addEventListener('click', () => {
  const picker = document.createElement('div');
  picker.className = 'reminder-add-row';
  picker.innerHTML = `
    <select>${OFFSET_CHOICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <button type="button">确定</button>`;
  picker.querySelector('button').addEventListener('click', () => {
    const v = Number(picker.querySelector('select').value);
    remindDraft.push({ id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), offsetMinutes: v });
    picker.remove();
    renderReminders();
  });
  picker.querySelector('select').addEventListener('keydown', (e) => { if (e.key === 'Escape') picker.remove(); });
  // 追加到按钮之前
  $('#btnAddReminder').insertAdjacentElement('beforebegin', picker);
  picker.querySelector('select').focus();
});

// 表单提交
$('#taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#fTitle').value.trim();
  const date = $('#fDate').value;
  const time = $('#fTime').value;
  if (!title || !date || !time) return;
  const tags = $('#fTags').value.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
  const payload = {
    id: $('#fId').value || undefined,
    title,
    date,
    time,
    note: $('#fNote').value.trim(),
    tags,
    priority: $('#fPriority').value,
    repeat: $('#fRepeat').value,
    reminders: remindDraft.map((r) => ({ id: r.id, offsetMinutes: r.offsetMinutes })),
    maa: {
      enabled: $('#fMaaEnabled').checked,
      task: $('#fMaaTask').value || ((prefs.maa && prefs.maa.autoStartTask) || '默认'),
      autoStopMin: Math.max(0, Math.round(Number($('#fMaaAutoStop').value) || 0)),
    },
  };
  await window.api.saveTask(payload);
  window.eveBus.emit('eve:task-saved', payload);
  closeModal('taskModal');
  await refresh();
  // 保存后选中该日期，直观看到刚建的任务
  selectedDate = date;
  renderCalendar();
  renderDayPanel();
});

// ---------- 删除 ----------
let deleteTarget = null;
let deleteSegTarget = null;
function askDelete(task) {
  deleteTarget = task;
  $('#confirmText').textContent = `删除任务「${task.title}」？重复任务将同时删除其后续安排。`;
  $('#confirmWrap').hidden = false;
}
function askDeleteSeg(seg) {
  deleteSegTarget = seg;
  $('#confirmText').textContent = `删除时间段「${segLabel(seg)}${seg.title ? ' ' + seg.title : ''}」？`;
  $('#confirmWrap').hidden = false;
}
$('#confirmNo').addEventListener('click', () => {
  $('#confirmWrap').hidden = true;
  deleteTarget = null;
  deleteSegTarget = null;
});
$('#confirmYes').addEventListener('click', async () => {
  if (deleteTarget) {
    await window.api.deleteTask(deleteTarget.id);
    window.eveBus.emit('eve:task-deleted', deleteTarget.id);
    await refresh();
  } else if (deleteSegTarget) {
    await window.api.deleteSegment(deleteSegTarget.id);
    await refresh();
  }
  $('#confirmWrap').hidden = true;
  deleteTarget = null;
  deleteSegTarget = null;
});

// ---------- 导航按钮 ----------
$('#btnToday').addEventListener('click', () => {
  const now = new Date();
  viewY = now.getFullYear(); viewM = now.getMonth();
  selectedDate = fmtDate(now);
  renderCalendar(); bindCalEvents(); renderDayPanel();
});
$('#btnPrev').addEventListener('click', () => {
  viewM--; if (viewM < 0) { viewM = 11; viewY--; }
  renderCalendar(); bindCalEvents();
});
$('#btnNext').addEventListener('click', () => {
  viewM++; if (viewM > 11) { viewM = 0; viewY++; }
  renderCalendar(); bindCalEvents();
});
$('#btnAddTask').addEventListener('click', () => openTaskModal(null));

// ---------- 单日图片贴纸 ----------
async function reloadDayImgs() {
  dayImgUrls = await window.api.getDayImages();
}

let imgManageDate = null;
$('#btnDayImg').addEventListener('click', async () => {
  imgManageDate = selectedDate;
  await renderImgModal();
});
$('#btnPickDayImg').addEventListener('click', async () => {
  const r = await window.api.pickImage();
  if (!r || !r.ok) return;
  await window.api.setDayImage(imgManageDate, r.fileName);
  await reloadDayImgs();
  await renderImgModal();
  renderCalendar(); bindCalEvents();
});
$('#btnRemoveDayImg').addEventListener('click', async () => {
  await window.api.setDayImage(imgManageDate, null);
  await reloadDayImgs();
  await renderImgModal();
  renderCalendar(); bindCalEvents();
});

async function renderImgModal() {
  $('#imgModalDate').textContent = `日期：${imgManageDate}`;
  const url = dayImgUrls[imgManageDate];
  const prev = $('#imgModalPreview');
  prev.innerHTML = '';
  if (url) {
    const im = document.createElement('img');
    im.src = url;
    prev.appendChild(im);
    $('#btnRemoveDayImg').hidden = false;
  } else {
    const sp = document.createElement('span');
    sp.className = 'placeholder';
    sp.textContent = '这一天还没有图片';
    prev.appendChild(sp);
    $('#btnRemoveDayImg').hidden = true;
  }
  $('#imgModal').hidden = false;
}

// ---------- 时间段（液体倒计时）----------
const SEG_PRESET_COLORS = ['#4f6bff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#334155'];

function renderSegColors(cur) {
  const wrap = $('#segColors');
  wrap.innerHTML = '';
  SEG_PRESET_COLORS.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'theme-swatch' + (c.toLowerCase() === String(cur).toLowerCase() ? ' on' : '');
    el.style.background = c;
    el.title = c;
    el.addEventListener('click', () => {
      $('#segColor').value = c;
      renderSegColors(c);
    });
    wrap.appendChild(el);
  });
}

function openSegModal(seg) {
  $('#segModalTitle').textContent = seg ? '编辑时间段' : '新建时间段';
  $('#segId').value = seg ? seg.id : '';
  $('#segDate').value = seg ? seg.date : selectedDate;
  const now = new Date();
  const later = new Date(now.getTime() + 2 * 3600 * 1000);
  $('#segStart').value = seg ? seg.start : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#segEnd').value = seg ? seg.end : `${pad(later.getHours())}:${pad(later.getMinutes())}`;
  $('#segTitle').value = seg ? (seg.title || '') : '';
  const c = (seg && seg.color) || (prefs.theme && prefs.theme.accent) || '#4f6bff';
  $('#segColor').value = c;
  renderSegColors(c);
  $('#segModal').hidden = false;
}

$('#btnDaySeg').addEventListener('click', () => openSegModal(null));
$('#segColor').addEventListener('input', (e) => renderSegColors(e.target.value));

$('#segForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    id: $('#segId').value || undefined,
    date: $('#segDate').value,
    start: $('#segStart').value,
    end: $('#segEnd').value,
    title: $('#segTitle').value.trim(),
    color: $('#segColor').value,
  };
  if (!payload.date || !payload.start || !payload.end) return;
  if (payload.start === payload.end) { alert('开始时间与结束时间不能相同'); return; }
  await window.api.saveSegment(payload);
  closeModal('segModal');
  await refresh();
  window.eveBus.emit('eve:segment-saved', payload);
});

// ---------- 拖拽日期格子到桌面 → 生成小组件 ----------
function initWidgetDrag() {
  const THRESH = 8;
  let drag = null;

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    if (e.target.closest('.cell-img')) return;
    drag = { date: cell.dataset.date, sx: e.clientX, sy: e.clientY, moved: false };
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < THRESH) return;
    drag.moved = true;
    document.body.classList.add('dragging-widget');
    const g = $('#dragGhost');
    g.hidden = false;
    g.style.left = e.clientX + 'px';
    g.style.top = e.clientY + 'px';
    g.textContent = `松手放到桌面 → 「${drag.date}」小组件`;
  });

  document.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    const date = drag.date;
    drag = null;
    document.body.classList.remove('dragging-widget');
    $('#dragGhost').hidden = true;
    if (!wasDrag) return;
    suppressClickUntil = Date.now() + 400; // 拖拽后不触发选中
    const outX = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth;
    const outY = e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (outX || outY) {
      const r = await window.api.createWidget({ date, x: e.screenX - 116, y: e.screenY - 40 });
      if (r && r.ok) window.eveBus.emit('eve:widget-created', date);
    }
  });

  document.addEventListener('pointercancel', () => {
    drag = null;
    document.body.classList.remove('dragging-widget');
    $('#dragGhost').hidden = true;
  });
}

// ---------- 日历整体背景：视频 / 图片幻灯片 / 单图（优先级从高到低） ----------
let bgVideoEl = null;
let bgSlideEl = null;      // 幻灯片当前 <img>
let bgSlideTimer = null;   // 轮播定时器
let bgSlideUrls = [];      // 已解析的图片 url 列表（按 slides 顺序）
let bgSlideOrder = [];     // 播放顺序索引
let bgSlideIdx = 0;
let bgSlideMode = 'order';
let bgSlideInterval = 10;
const SLIDE_MAX = 100;

function hasBgMedia() {
  const t = prefs.theme || {};
  const slides = Array.isArray(t.slides) ? t.slides : [];
  return !!(t.bgVideo || slides.length || t.bgImage);
}

function stopSlideshow() {
  if (bgSlideTimer) { clearInterval(bgSlideTimer); bgSlideTimer = null; }
  if (bgSlideEl) { bgSlideEl.remove(); bgSlideEl = null; }
  bgSlideUrls = [];
  bgSlideOrder = [];
  bgSlideIdx = 0;
}

// Fisher-Yates 洗牌，返回 [0..n-1] 的排列
function shuffledIndexes(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function startSlideshow(fileNames, mode, intervalSec) {
  stopSlideshow();
  const urls = [];
  for (const fn of fileNames) {
    const r = await window.api.imagePath(fn);
    if (r && r.ok) urls.push(r.url);
  }
  if (!urls.length) return false;
  bgSlideUrls = urls;
  bgSlideMode = mode === 'shuffle' ? 'shuffle' : 'order';
  bgSlideInterval = Math.max(1, Number(intervalSec) || 10);
  bgSlideEl = document.createElement('img');
  bgSlideEl.className = 'bg-slide';
  $('#bgImageLayer').appendChild(bgSlideEl);
  bgSlideOrder = bgSlideMode === 'shuffle' ? shuffledIndexes(urls.length) : Array.from({ length: urls.length }, (_, i) => i);
  bgSlideIdx = 0;
  renderSlide();
  if (urls.length > 1) {
    bgSlideTimer = setInterval(() => {
      bgSlideIdx++;
      if (bgSlideIdx >= bgSlideOrder.length) {
        if (bgSlideMode === 'shuffle') bgSlideOrder = shuffledIndexes(bgSlideUrls.length); // 新一轮重新洗牌，一轮内不重复
        bgSlideIdx = 0;
      }
      renderSlide();
    }, bgSlideInterval * 1000);
  }
  return true;
}

function renderSlide() {
  if (!bgSlideEl || !bgSlideUrls.length) return;
  bgSlideEl.src = bgSlideUrls[bgSlideOrder[bgSlideIdx]];
}

function removeVideoEl() {
  if (bgVideoEl) {
    bgVideoEl.pause();
    bgVideoEl.removeAttribute('src');
    bgVideoEl.load();
    bgVideoEl.remove();
    bgVideoEl = null;
  }
}

async function applyBgMedia() {
  const theme = prefs.theme || {};
  const vFn = theme.bgVideo;
  const slides = Array.isArray(theme.slides) ? theme.slides : [];
  const iFn = theme.bgImage;
  const layer = $('#bgImageLayer');
  layer.style.backgroundImage = '';

  if (vFn) {
    const r = await window.api.imagePath(vFn);
    if (r && r.ok) {
      stopSlideshow();
      if (!bgVideoEl) {
        bgVideoEl = document.createElement('video');
        bgVideoEl.className = 'bg-video';
        bgVideoEl.muted = true;
        bgVideoEl.loop = true;
        bgVideoEl.autoplay = true;
        bgVideoEl.playsInline = true;
        bgVideoEl.addEventListener('error', () => {
          if (!bgVideoEl.dataset.errShown) {
            bgVideoEl.dataset.errShown = '1';
            alert('无法播放该视频：请使用 MP4(H.264) 或 WebM 格式（mov 需为 H.264/AAC 编码）。');
          }
        });
        layer.appendChild(bgVideoEl);
      }
      if (bgVideoEl.getAttribute('src') !== r.url) {
        bgVideoEl.setAttribute('src', r.url);
        bgVideoEl.load();
      }
      const p = bgVideoEl.play();
      if (p && p.catch) p.catch(() => {});
      layer.classList.add('on');
      layer.hidden = false;
      return;
    }
  }
  removeVideoEl();

  if (slides.length) {
    const ok = await startSlideshow(slides, theme.slideMode, theme.slideInterval);
    if (ok) {
      layer.classList.add('on');
      layer.hidden = false;
      return;
    }
  }

  if (iFn) {
    const r = await window.api.imagePath(iFn);
    if (r && r.ok) {
      layer.style.backgroundImage = `url("${r.url}")`;
      layer.classList.add('on');
      layer.hidden = false;
      return;
    }
  }
  stopSlideshow();
  layer.classList.remove('on');
  layer.hidden = true;
}

// 面板透明度（0~100）：同时驱动面板不透明度与背景白色蒙版强度
function applyBgOpacity() {
  const hasBg = hasBgMedia();
  const raw = (prefs.theme && prefs.theme.bgOpacity);
  const v = Number(raw !== undefined ? raw : 100);
  const panelA = hasBg ? (1 - (v / 100) * 0.55).toFixed(3) : '1'; // 无背景时面板保持不透明
  const maskA = (0.88 - (v / 100) * 0.83).toFixed(3);
  const st = document.documentElement.style;
  st.setProperty('--panel-a', panelA);
  st.setProperty('--mask-a', maskA);
  const val = $('#sBgOpacityVal');
  if (val) val.textContent = `${Math.round(v)}%`;
}

function updateBgBtns() {
  const t = prefs.theme || {};
  const hasImg = !!t.bgImage;
  const hasVid = !!t.bgVideo;
  const slides = Array.isArray(t.slides) ? t.slides : [];
  $('#btnClearBg').hidden = !hasImg;
  $('#btnPickBg').textContent = hasImg ? '更换背景图片…' : '选择背景图片…';
  $('#btnClearVid').hidden = !hasVid;
  $('#btnPickVid').textContent = hasVid ? '更换背景视频…' : '选择背景视频…';
  $('#btnClearSlides').hidden = !slides.length;
  $('#btnClearSlides').textContent = `清空（${slides.length} 张）`;
  $('#slideCfgWrap').hidden = slides.length < 2;
  if (slides.length) {
    $('#slideInterval').value = String((t.slideInterval !== undefined ? t.slideInterval : 10));
    $('#slideMode').value = t.slideMode === 'shuffle' ? 'shuffle' : 'order';
  }
  $('#bgOpacityWrap').hidden = !hasBgMedia();
  const s = $('#sBgOpacity');
  s.value = String((t.bgOpacity) !== undefined ? t.bgOpacity : 100);
  applyBgOpacity();
}

async function saveTheme() {
  await window.api.setPrefs({ theme: prefs.theme });
}

$('#btnPickBg').addEventListener('click', async () => {
  const r = await window.api.pickImage();
  if (!r || !r.ok) return;
  await window.api.setBgImage(r.fileName);
  prefs.theme = Object.assign({}, prefs.theme, { bgImage: r.fileName });
  await applyBgMedia();
  updateBgBtns();
});
$('#btnClearBg').addEventListener('click', async () => {
  await window.api.setBgImage(null);
  prefs.theme = Object.assign({}, prefs.theme, { bgImage: null });
  await applyBgMedia();
  updateBgBtns();
});
$('#btnPickVid').addEventListener('click', async () => {
  const r = await window.api.pickVideo();
  if (!r || !r.ok) return;
  await window.api.setBgVideo(r.fileName);
  prefs.theme = Object.assign({}, prefs.theme, { bgVideo: r.fileName });
  await applyBgMedia();
  updateBgBtns();
});
$('#btnClearVid').addEventListener('click', async () => {
  await window.api.setBgVideo(null);
  prefs.theme = Object.assign({}, prefs.theme, { bgVideo: null });
  await applyBgMedia();
  updateBgBtns();
});

// ---- 幻灯片操作 ----
$('#btnAddSlides').addEventListener('click', async () => {
  const cur = Array.isArray(prefs.theme.slides) ? prefs.theme.slides : [];
  const r = await window.api.pickManyImages();
  if (!r || !r.ok || !r.files.length) return;
  const room = SLIDE_MAX - cur.length;
  if (r.files.length > room) {
    alert(`最多 ${SLIDE_MAX} 张，本次仅添加前 ${room} 张`);
  }
  const added = r.files.slice(0, room).map((f) => f.fileName);
  prefs.theme = Object.assign({}, prefs.theme, { slides: cur.concat(added) });
  await saveTheme();
  await applyBgMedia();
  updateBgBtns();
});
$('#btnClearSlides').addEventListener('click', async () => {
  prefs.theme = Object.assign({}, prefs.theme, { slides: [] });
  await saveTheme();
  await applyBgMedia();
  updateBgBtns();
});
$('#slideInterval').addEventListener('change', async (e) => {
  let v = Math.round(Number(e.target.value));
  if (!(v >= 1)) v = 10;
  v = Math.min(600, Math.max(1, v));
  e.target.value = String(v);
  prefs.theme = Object.assign({}, prefs.theme, { slideInterval: v });
  await saveTheme();
  await applyBgMedia();
});
$('#slideMode').addEventListener('change', async (e) => {
  prefs.theme = Object.assign({}, prefs.theme, { slideMode: e.target.value });
  await saveTheme();
  await applyBgMedia();
});
$('#sBgOpacity').addEventListener('input', async (e) => {
  const v = Number(e.target.value);
  prefs.theme = Object.assign({}, prefs.theme, { bgOpacity: v });
  await saveTheme();
  applyBgOpacity();
});

// ---------- 主题颜色（强调色 + 背景色 双通道） ----------
const PRESET_ACCENTS = [
  ['#4f6bff', '经典蓝'], ['#10b981', '翡翠绿'], ['#f59e0b', '琥珀橙'],
  ['#ec4899', '玫红'], ['#8b5cf6', '紫罗兰'], ['#06b6d4', '青色'],
  ['#ef4444', '朱红'], ['#334155', '石墨'],
];
const PRESET_BGS = [
  ['#f4f6fb', '雾蓝'], ['#ffffff', '纯白'], ['#eef2ff', '淡蓝'], ['#f0f7f1', '淡绿'],
  ['#fdf3ef', '淡橙'], ['#fdf1f5', '淡粉'], ['#f5f2fb', '淡紫'], ['#f2f4f6', '冷灰'],
];
const DEFAULT_THEME = { accent: '#4f6bff', bg: '#f4f6fb', bgOpacity: 100 };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function themeVal(key, def) { return (prefs.theme && prefs.theme[key]) || def; }

// 把强调色与背景色写进 CSS 变量（驱动全界面换色）
function applyTheme() {
  const accent = themeVal('accent', DEFAULT_THEME.accent);
  const bg = themeVal('bg', DEFAULT_THEME.bg);
  const dark = mixHex(accent, '#000000', 0.2);
  const soft = mixHex(accent, '#ffffff', 0.88);
  const [r, g, b] = hexToRgb(accent);
  const st = document.documentElement.style;
  st.setProperty('--primary', accent);
  st.setProperty('--primary-dark', dark);
  st.setProperty('--primary-soft', soft);
  st.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  st.setProperty('--bg', bg);
}

function renderThemeUI() {
  const curAccent = themeVal('accent', DEFAULT_THEME.accent).toLowerCase();
  const curBg = themeVal('bg', DEFAULT_THEME.bg).toLowerCase();

  const buildRow = (wrapId, list, cur) => {
    const wrap = document.getElementById(wrapId);
    wrap.innerHTML = '';
    list.forEach(([c, n]) => {
      const el = document.createElement('div');
      el.className = 'theme-swatch' + (c.toLowerCase() === cur ? ' on' : '');
      el.style.background = c;
      el.title = n;
      el.addEventListener('click', () => setThemeColor(wrapId === 'themeSwatches' ? 'accent' : 'bg', c));
      wrap.appendChild(el);
    });
  };

  buildRow('themeSwatches', PRESET_ACCENTS, curAccent);
  buildRow('themeSwatchesBg', PRESET_BGS, curBg);
  $('#sAccent').value = themeVal('accent', DEFAULT_THEME.accent);
  $('#sAccentBg').value = themeVal('bg', DEFAULT_THEME.bg);
}

async function setThemeColor(key, c) {
  prefs.theme = Object.assign({}, prefs.theme || DEFAULT_THEME, { [key]: c });
  await window.api.setPrefs({ theme: prefs.theme });
  applyTheme();
  renderThemeUI();
}

// ---------- 设置 ----------
$('#btnSettings').addEventListener('click', async () => {
  $('#sWeekStart').value = String(prefs.weekStart);
  $('#sNotifySound').checked = !!prefs.notifySound;
  try {
    const a = await window.api.getAutostart();
    $('#sAutoStart').checked = !!(a && a.enabled);
  } catch (e) { $('#sAutoStart').checked = false; }
  renderThemeUI();
  updateBgBtns();
  updateSoundUI();
  await updateHolidayUI();
  await updateApiUI();
  await updateMaaUI();
  await updateUpdateUI();
  await renderFestivalUI();
  await renderPluginList();
  $('#settingsModal').hidden = false;
});
$('#sAutoStart').addEventListener('change', async (e) => {
  try {
    await window.api.setAutostart(e.target.checked);
  } catch (err) {
    alert('设置开机自启失败：' + (err && err.message ? err.message : '未知错误'));
  }
});

// ---------- 自定义提醒语音 ----------
// 主进程到点后发来播放指令：播放自选音频 +（可选）系统 TTS 朗读
window.api.onAlertVoice((p) => {
  try {
    if (p && p.file) {
      window.api.soundPath(p.file).then((r) => {
        if (r && r.ok) {
          const a = new Audio(r.url);
          a.volume = typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : 0.8;
          const pr = a.play();
          if (pr && pr.catch) pr.catch((e) => console.error('播放提醒语音失败', e));
        }
      });
    }
    if (p && p.speak && 'speechSynthesis' in window) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(p.text || '提醒');
        u.lang = 'zh-CN';
        speechSynthesis.speak(u);
      } catch (e) {
        console.error('语音朗读失败', e);
      }
    }
  } catch (e) {
    console.error('提醒语音处理失败', e);
  }
});

const DEFAULT_SOUND = { mode: 'system', file: null, volume: 0.8, speak: false, speakText: '' };

function soundPrefs() {
  return Object.assign({}, DEFAULT_SOUND, prefs.alertSound || {});
}

function updateSoundUI() {
  const s = soundPrefs();
  $('#sSoundMode').value = s.mode;
  const custom = s.mode === 'custom';
  $('#soundCustomWrap').hidden = !custom;
  $('#soundName').textContent = s.file ? `已选择音频：${s.file}` : '尚未选择音频文件（选好后到点会播放它）';
  $('#btnPreviewSound').hidden = !s.file;
  $('#btnClearSound').hidden = !s.file;
  $('#btnPickSound').textContent = s.file ? '更换音频文件…' : '选择音频文件…';
  const vol = Math.round((typeof s.volume === 'number' ? s.volume : 0.8) * 100);
  $('#sSoundVolume').value = String(vol);
  $('#sSoundVolumeVal').textContent = `${vol}%`;
  $('#sSpeak').checked = !!s.speak;
}

async function saveSoundPrefs(patch) {
  prefs.alertSound = Object.assign(soundPrefs(), patch);
  await window.api.setPrefs({ alertSound: prefs.alertSound });
  updateSoundUI();
}

$('#sSoundMode').addEventListener('change', (e) => saveSoundPrefs({ mode: e.target.value }));
$('#btnPickSound').addEventListener('click', async () => {
  const r = await window.api.pickSound();
  if (!r || !r.ok) return;
  await saveSoundPrefs({ file: r.fileName, mode: 'custom' });
});
$('#btnClearSound').addEventListener('click', () => saveSoundPrefs({ file: null, mode: 'system' }));
$('#btnPreviewSound').addEventListener('click', async () => {
  const s = soundPrefs();
  if (!s.file) return;
  const r = await window.api.soundPath(s.file);
  if (r && r.ok) {
    const a = new Audio(r.url);
    a.volume = typeof s.volume === 'number' ? s.volume : 0.8;
    a.play().catch(() => {});
  }
});
$('#sSoundVolume').addEventListener('input', (e) => {
  $('#sSoundVolumeVal').textContent = `${e.target.value}%`;
});
$('#sSoundVolume').addEventListener('change', (e) => saveSoundPrefs({ volume: Number(e.target.value) / 100 }));
$('#sSpeak').addEventListener('change', (e) => saveSoundPrefs({ speak: e.target.checked }));

// ---------- 节假日设置 ----------
async function updateHolidayUI() {
  const hp = holidayPrefsLocal();
  $('#sHoliRest').checked = hp.showRest !== false;
  $('#sHoliWork').checked = hp.showWorkday !== false;
  try {
    const st = await window.api.getHolidayStatus();
    const years = (st && st.years) || [];
    const when = st && st.updatedAt ? new Date(st.updatedAt).toLocaleString() : '从未更新';
    $('#holiStatus').textContent = years.length
      ? `已载入 ${years.join(' / ')} 年，共 ${st.count} 条休息 / 调休数据 · 上次更新：${when}`
      : '尚未载入数据 —— 点「立即在线更新」获取放假安排';
  } catch (e) {
    $('#holiStatus').textContent = '状态读取失败';
  }
}

async function saveHolidayPrefs(patch) {
  prefs.holidays = Object.assign(holidayPrefsLocal(), patch);
  await window.api.setPrefs({ holidays: prefs.holidays });
  holidayCache = {};
  renderCalendar();
  renderDayPanel();
}

$('#sHoliRest').addEventListener('change', (e) => saveHolidayPrefs({ showRest: e.target.checked }));
$('#sHoliWork').addEventListener('change', (e) => saveHolidayPrefs({ showWorkday: e.target.checked }));

$('#btnHoliUpdate').addEventListener('click', async () => {
  const btn = $('#btnHoliUpdate');
  btn.disabled = true;
  btn.textContent = '更新中…';
  try {
    const r = await window.api.updateHolidays();
    const parts = ((r && r.results) || []).map((x) => (x.ok ? `${x.year} 年 ✓（${x.count} 条）` : `${x.year} 年 ✗ ${x.error || ''}`));
    if (r && r.ok) {
      holidayCache = {};
      renderCalendar();
      renderDayPanel();
      alert('更新完成：\n' + parts.join('\n'));
    } else {
      alert('更新失败：\n' + parts.join('\n') + '\n\n网络不可用时可手动下载 JSON，再用「导入 JSON…」。');
    }
  } catch (e) {
    alert('更新失败：' + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
    btn.textContent = '立即在线更新';
    updateHolidayUI();
  }
});

$('#btnHoliImport').addEventListener('click', async () => {
  try {
    const r = await window.api.importHolidays();
    if (r && r.ok) {
      holidayCache = {};
      renderCalendar();
      renderDayPanel();
      alert(`导入成功：${r.year} 年，共 ${r.count} 条数据`);
    } else if (r && r.error) {
      alert('导入失败：' + r.error);
    }
  } catch (e) {
    alert('导入失败');
  }
  updateHolidayUI();
});

$('#btnHoliDir').addEventListener('click', async () => {
  try { await window.api.openHolidayDir(); } catch (e) { alert('无法打开数据目录'); }
});

// ---------- 外部联动（本地接口 / MAA） ----------
async function updateApiUI() {
  try {
    const st = await window.api.apiStatus();
    $('#sApiEnabled').checked = st.enabled !== false;
    if (document.activeElement !== $('#apiPort')) $('#apiPort').value = st.port;
    $('#apiToken').textContent = st.token || '—';
    $('#apiToken').title = st.token || '';
    if (document.activeElement !== $('#apiWebhook')) $('#apiWebhook').value = st.webhook || '';
    $('#apiStatus').textContent = st.enabled === false
      ? '接口已关闭'
      : (st.running ? `运行中：${st.url}（仅本机可访问）` : `未运行（端口 ${st.port} 可能被占用）`);
  } catch (e) {
    $('#apiStatus').textContent = '接口状态读取失败';
  }
}

async function updateMaaUI() {
  try {
    const st = await window.api.maaStatus();
    if (document.activeElement !== $('#maaExe')) $('#maaExe').value = st.exePath || '';
    if (document.activeElement !== $('#maaArgs')) $('#maaArgs').value = st.argsTemplate || '';
    if (document.activeElement !== $('#maaTask')) $('#maaTask').value = st.autoStartTask || '默认';
    if (document.activeElement !== $('#maaAutoStopMin')) $('#maaAutoStopMin').value = String(st.autoStopMin || 0);
    $('#maaSkipRunning').checked = st.skipIfRunning !== false;
    $('#maaStatus').textContent = st.running
      ? `MAA 运行中（PID ${st.pid}）`
      : (st.configured ? 'MAA 未运行' : '尚未配置 MAA 路径');
    // 可选的 MAA 任务名标签
    const chips = $('#maaTaskChips');
    chips.innerHTML = '';
    const list = Array.isArray(st.tasks) ? st.tasks : [];
    if (!list.length) {
      chips.innerHTML = '<span class="hint">还没有任务名，添加后可在任务里选择</span>';
    } else {
      list.forEach((name) => {
        const el = document.createElement('div');
        el.className = 'fest-chip on';
        el.textContent = name + ' ✕';
        el.title = '点击删除这个任务名';
        el.addEventListener('click', async () => {
          await window.api.maaSetPrefs({ tasks: list.filter((x) => x !== name) });
          await updateMaaUI();
        });
        chips.appendChild(el);
      });
    }
  } catch (e) {
    $('#maaStatus').textContent = 'MAA 状态读取失败';
  }
}

$('#btnMaaAddTask').addEventListener('click', async () => {
  const name = $('#maaNewTask').value.trim();
  if (!name) return;
  const st = await window.api.maaStatus();
  const list = Array.isArray(st.tasks) ? st.tasks : [];
  if (list.includes(name)) { alert('这个任务名已存在'); return; }
  await window.api.maaSetPrefs({ tasks: [...list, name] });
  $('#maaNewTask').value = '';
  await updateMaaUI();
});

$('#maaAutoStopMin').addEventListener('change', async () => {
  const v = Math.max(0, Math.min(1440, Math.round(Number($('#maaAutoStopMin').value) || 0)));
  $('#maaAutoStopMin').value = String(v);
  await window.api.maaSetPrefs({ autoStopMin: v });
});

$('#maaSkipRunning').addEventListener('change', async (e) => {
  await window.api.maaSetPrefs({ skipIfRunning: e.target.checked });
});

// 任务卡片上点「▶」立即启动 MAA
async function runMaaForTask(t) {
  const r = await window.api.maaRunTask(t.id);
  const msg = (!r || !r.ok)
    ? 'MAA 启动失败：' + ((r && r.error) || '未知错误')
    : (r.skipped ? 'MAA 已在运行，已跳过重复启动' : `已启动 MAA（任务：${r.task}）`);
  if (window.eve && window.eve.toast) window.eve.toast(msg, 4000);
  else alert(msg);
  await updateMaaUI();
}

// 到点自动联动结果提示
window.api.onMaaEvent((p) => {
  try {
    const r = (p && p.result) || {};
    const msg = r.ok
      ? (r.skipped ? `「${p.title}」触发联动：MAA 已在运行，已跳过` : `「${p.title}」已自动启动 MAA（${r.task}）`)
      : `「${p.title}」联动启动 MAA 失败：${r.error || '未知错误'}`;
    if (window.eve && window.eve.toast) window.eve.toast(msg, 4500);
    updateMaaUI();
  } catch (e) {
    console.error(e);
  }
});

$('#sApiEnabled').addEventListener('change', async (e) => {
  await window.api.apiSetPrefs({ enabled: e.target.checked });
  await updateApiUI();
});
$('#btnApiSave').addEventListener('click', async () => {
  const port = Number($('#apiPort').value);
  if (!(port > 1024 && port < 65536)) { alert('端口需在 1025 – 65535 之间'); return; }
  await window.api.apiSetPrefs({ port });
  await updateApiUI();
  alert('已保存并重启接口');
});
$('#btnApiDocs').addEventListener('click', async () => {
  const r = await window.api.apiOpenDocs();
  if (!r || !r.ok) alert('打开接口文档失败：' + ((r && r.error) || '未知错误'));
});
$('#btnApiCopyToken').addEventListener('click', async () => {
  const t = $('#apiToken').textContent;
  if (!t || t === '—') return;
  try {
    await navigator.clipboard.writeText(t);
    alert('令牌已复制到剪贴板');
  } catch (e) {
    alert('复制失败，请手动选中复制');
  }
});
$('#btnApiNewToken').addEventListener('click', async () => {
  if (!confirm('重新生成令牌后，之前使用旧令牌的软件需要更新配置，确定继续？')) return;
  await window.api.apiRegenerateToken();
  await updateApiUI();
});
$('#btnApiSaveWebhook').addEventListener('click', async () => {
  await window.api.apiSetPrefs({ webhook: $('#apiWebhook').value.trim() });
  await updateApiUI();
  alert('已保存 webhook 地址');
});

$('#btnMaaPick').addEventListener('click', async () => {
  const r = await window.api.maaPickExe();
  if (r && r.ok) await updateMaaUI();
});
$('#btnMaaSave').addEventListener('click', async () => {
  await window.api.maaSetPrefs({
    argsTemplate: $('#maaArgs').value,
    autoStartTask: $('#maaTask').value.trim() || '默认',
  });
  await updateMaaUI();
  alert('MAA 设置已保存');
});
$('#btnMaaStart').addEventListener('click', async () => {
  const r = await window.api.maaStart($('#maaTask').value.trim() || undefined);
  await updateMaaUI();
  if (!r || !r.ok) alert('启动 MAA 失败：' + ((r && r.error) || '未知错误'));
});
$('#btnMaaStop').addEventListener('click', async () => {
  const r = await window.api.maaStop();
  await updateMaaUI();
  if (!r || !r.ok) alert('停止 MAA 失败：' + ((r && r.error) || '未知错误'));
});

// ---------- MAA 任务面板（与「一键长草」一致的配置界面） ----------
let maaPanelData = null;
let maaPanelDate = null;

$('#btnMaaPanel').addEventListener('click', () => openMaaPanel(selectedDate));
$('#btnDayMaa').addEventListener('click', () => openMaaPanel(selectedDate));

// 为某天建议一个 MAA 配置名（与 maaconfig.suggestConfigName 同规则）
function suggestMaaConfigName(date, existing) {
  const list = Array.isArray(existing) ? existing : [];
  const md = String(date || '').slice(5).replace('-', '');
  const base = md ? `日历-${md}` : '日历配置';
  if (!list.includes(base)) return base;
  let i = 2;
  while (list.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

async function openMaaPanel(date) {
  maaPanelDate = date || selectedDate;
  $('#maaPanel').hidden = false;
  await loadMaaPanel();
}

async function loadMaaPanel() {
  $('#maaPanelMsg').textContent = '';
  $('#maaTaskList').innerHTML = '<div class="hint">读取中…</div>';
  const r = await window.api.maaConfigLoad(maaPanelDate);
  if (!r || !r.ok) {
    maaPanelData = null;
    $('#maaPanelStatus').textContent = '无法读取 MAA 配置';
    $('#maaTaskList').innerHTML = `<div class="hint">${esc((r && r.error) || '未知错误')}<br>可在「⚙ 设置 → 外部联动」里选择 MAA.exe 路径。</div>`;
    return;
  }
  maaPanelData = r;
  $('#maaPanelDate').textContent = maaPanelDate || '未选择日期';
  $('#maaBindDate').checked = !!r.bound;
  $('#maaPanelStatus').textContent = `已载入 ${r.tasks.length} 个任务 · ${r.startDirectly ? '启动后直接运行' : '启动后需手动开始'}`;
  const sel = $('#maaCfgSelect');
  sel.innerHTML = '';
  (r.configs || []).forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = r.current;
  renderMaaTaskList(r.tasks);
}

function maaFieldHtml(t, f) {
  const key = esc(f.key);
  if (f.type === 'bool') {
    return `<label class="maa-f maa-f-bool"><input type="checkbox" data-key="${key}" data-type="bool" ${f.value ? 'checked' : ''} /> ${esc(f.label)}</label>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(f.value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<label class="maa-f"><span>${esc(f.label)}</span><select data-key="${key}" data-type="select">${opts}</select></label>`;
  }
  if (f.type === 'int') {
    return `<label class="maa-f"><span>${esc(f.label)}</span><input type="number" data-key="${key}" data-type="int" value="${esc(f.value)}" min="${f.min == null ? 0 : f.min}" /></label>`;
  }
  if (f.type === 'list' || f.type === 'textlist') {
    return `<label class="maa-f maa-f-wide"><span>${esc(f.label)}</span><textarea rows="2" data-key="${key}" data-type="${esc(f.type)}">${esc(f.value)}</textarea></label>`;
  }
  return `<label class="maa-f"><span>${esc(f.label)}</span><input type="text" data-key="${key}" data-type="text" value="${esc(f.value)}" /></label>`;
}

function renderMaaTaskList(tasks) {
  const box = $('#maaTaskList');
  box.innerHTML = '';
  (tasks || []).forEach((t) => {
    const card = document.createElement('div');
    card.className = 'maa-task' + (t.enabled ? ' on' : '');
    card.dataset.index = String(t.index);
    const fieldsHtml = (t.fields || []).map((f) => maaFieldHtml(t, f)).join('');
    card.innerHTML = `
      <div class="maa-task-head">
        <label class="inline-check" style="margin:0">
          <input type="checkbox" class="maa-enable" ${t.enabled ? 'checked' : ''} />
          <strong>${esc(t.label)}</strong>
          <span class="maa-type">${esc(t.taskType)}</span>
        </label>
        <input type="text" class="maa-name" placeholder="任务备注名（可选）" value="${esc(t.name)}" />
      </div>
      ${fieldsHtml ? `<div class="maa-fields">${fieldsHtml}</div>` : ''}`;
    const cb = card.querySelector('.maa-enable');
    cb.addEventListener('change', () => card.classList.toggle('on', cb.checked));
    box.appendChild(card);
  });
}

// 收集面板里所有改动
function collectMaaUpdates() {
  const updates = [];
  document.querySelectorAll('#maaTaskList .maa-task').forEach((card) => {
    const patch = {
      enabled: card.querySelector('.maa-enable').checked,
      name: card.querySelector('.maa-name').value,
      fields: {},
    };
    card.querySelectorAll('[data-key]').forEach((el) => {
      patch.fields[el.dataset.key] = el.dataset.type === 'bool' ? el.checked : el.value;
    });
    updates.push({ index: Number(card.dataset.index), patch });
  });
  return updates;
}

$('#btnMaaPanelSave').addEventListener('click', async () => {
  const msg = $('#maaPanelMsg');
  if (!maaPanelData) { msg.textContent = '没有可保存的数据'; return; }
  const btn = $('#btnMaaPanelSave');
  btn.disabled = true;
  msg.textContent = '保存中…';
  try {
    const r = await window.api.maaConfigUpdateTasks(collectMaaUpdates());
    if (r && r.ok) {
      msg.textContent = `已保存 ${r.changed} 个任务到 MAA 配置`;
      if (r.tasks) renderMaaTaskList(r.tasks);
    } else {
      msg.textContent = '保存失败：' + ((r && r.error) || '未知错误');
    }
  } finally {
    btn.disabled = false;
  }
});
$('#btnMaaPanelReload').addEventListener('click', () => loadMaaPanel());
$('#btnMaaPanelDir').addEventListener('click', async () => {
  const r = await window.api.maaConfigOpenDir();
  if (!r || !r.ok) alert('打开配置目录失败：' + ((r && r.error) || '未知错误'));
});
$('#maaCfgSelect').addEventListener('change', async (e) => {
  const name = e.target.value;
  if ($('#maaBindDate').checked && maaPanelDate) {
    await window.api.maaSetDateConfig(maaPanelDate, name);
  } else {
    await window.api.maaConfigSetCurrent(name);
  }
  await loadMaaPanel();
});

// 勾选"这一天的独立配置"
$('#maaBindDate').addEventListener('change', async (e) => {
  if (!maaPanelDate) { e.target.checked = false; return; }
  if (e.target.checked) {
    await window.api.maaSetDateConfig(maaPanelDate, $('#maaCfgSelect').value);
  } else {
    await window.api.maaSetDateConfig(maaPanelDate, null);
  }
  await loadMaaPanel();
});

// 为这一天新建一套配置（复制当前配置）
$('#btnMaaCreateForDate').addEventListener('click', async () => {
  if (!maaPanelData) { alert('请先成功载入 MAA 配置'); return; }
  if (!maaPanelDate) { alert('请先在日历里选择一天'); return; }
  const defaultName = suggestMaaConfigName(maaPanelDate, maaPanelData.configs || []);
  const name = prompt(`为 ${maaPanelDate} 新建一套 MAA 配置（会复制「${maaPanelData.current}」的任务设置）`, defaultName);
  if (!name || !name.trim()) return;
  const r = await window.api.maaConfigCreate(name.trim(), maaPanelData.current);
  if (!r || !r.ok) { alert('创建失败：' + ((r && r.error) || '未知错误')); return; }
  await window.api.maaSetDateConfig(maaPanelDate, r.name);
  await loadMaaPanel();
});

$('#btnMaaPanelStart').addEventListener('click', async () => {
  const r = await window.api.maaStartForDate(maaPanelDate);
  $('#maaPanelMsg').textContent = (!r || !r.ok)
    ? ('启动失败：' + ((r && r.error) || '未知错误'))
    : (r.skipped ? 'MAA 已在运行' : `已启动 MAA（PID ${r.pid}）`);
  await updateMaaUI();
});
$('#btnMaaPanelStop').addEventListener('click', async () => {
  const r = await window.api.maaStop();
  $('#maaPanelMsg').textContent = (!r || !r.ok) ? ('停止失败：' + ((r && r.error) || '未知错误')) : '已停止 MAA';
  await updateMaaUI();
});

// ---------- 应用更新 ----------
let updInfo = null;

function showUpdateToast(info) {
  updInfo = info;
  $('#utVersion').textContent = `v${info.latest}`;
  const lines = [];
  if (info.notes) lines.push(info.notes.split('\n').filter(Boolean).slice(0, 4).join('\n'));
  lines.push(info.downloadUrl ? '可一键下载安装包完成升级' : '该版本没有安装包，请到发布页手动下载');
  $('#utBody').textContent = lines.join('\n');
  $('#utUpdate').textContent = '下载更新';
  $('#utUpdate').onclick = () => doDownloadUpdate();
  $('#updateToast').hidden = false;
}

window.api.onUpdateAvailable((info) => {
  try { showUpdateToast(info); } catch (e) { console.error(e); }
});
window.api.onUpdateProgress((p) => {
  if (!p || typeof p.percent !== 'number') return;
  const txt = `下载中… ${p.percent}%`;
  $('#updStatus').textContent = txt;
  if (!$('#updateToast').hidden) $('#utBody').textContent = txt;
});

async function doDownloadUpdate() {
  $('#utBody').textContent = '开始下载…';
  $('#utUpdate').disabled = true;
  try {
    const r = await window.api.downloadUpdate();
    if (r && r.ok) {
      $('#utBody').textContent = '下载完成！点「运行安装包」即可升级（安装程序会覆盖旧版本，数据保留）。';
      $('#utUpdate').textContent = '运行安装包';
      $('#utUpdate').onclick = async () => { await window.api.installUpdate(); };
      await updateUpdateUI();
    } else {
      const msg = (r && r.error) || '未知错误';
      $('#utBody').textContent = `下载失败：${msg}\n不影响日历使用，可稍后重试或到发布页手动下载。`;
      $('#utUpdate').textContent = '重试下载';
      $('#utUpdate').onclick = () => doDownloadUpdate();
    }
  } finally {
    $('#utUpdate').disabled = false;
  }
}

async function updateUpdateUI() {
  let st = null;
  try { st = await window.api.updateStatus(); } catch (e) { st = null; }
  if (!st) { $('#updStatus').textContent = '更新状态读取失败'; return; }
  $('#sAutoUpdate').checked = st.autoCheck !== false;
  if (document.activeElement !== $('#updRepo')) $('#updRepo').value = st.repo || '';
  const last = st.lastCheck ? new Date(st.lastCheck).toLocaleString() : '从未';
  const r = st.lastResult;
  let txt = `当前版本 v${st.current} · 上次检查：${last}`;
  if (r && r.ok) txt += ` · 最新 v${r.latest}${r.hasUpdate ? '（有可用更新）' : '（已是最新）'}`;
  else if (r && r.error) txt += ` · 上次检查失败：${r.error}`;
  else if (!st.repo) txt += ' · 尚未配置仓库';
  $('#updStatus').textContent = txt;
  $('#btnUpdDownload').hidden = !(r && r.ok && r.hasUpdate);
  $('#btnUpdInstall').hidden = !st.downloaded;
  $('#btnUpdPage').hidden = !(r && r.pageUrl);
}

$('#utLater').addEventListener('click', () => { $('#updateToast').hidden = true; });
$('#utIgnore').addEventListener('click', async () => {
  if (updInfo) await window.api.ignoreUpdate(updInfo.latest);
  $('#updateToast').hidden = true;
  await updateUpdateUI();
});

$('#sAutoUpdate').addEventListener('change', async (e) => {
  await window.api.setUpdatePrefs({ autoCheck: e.target.checked });
  await updateUpdateUI();
});

$('#btnUpdSaveRepo').addEventListener('click', async () => {
  const repo = $('#updRepo').value.trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (repo && !/^[^\s/]+\/[^\s/]+$/.test(repo)) { alert('仓库格式应为：用户名/仓库名'); return; }
  await window.api.setUpdatePrefs({ repo });
  $('#updRepo').value = repo;
  await updateUpdateUI();
  if (repo) {
    const r = await window.api.checkUpdate();
    await updateUpdateUI();
    if (r && r.ok && r.hasUpdate) showUpdateToast(r);
    else if (r && r.ok) alert(`已是最新版本 v${r.latest}（当前 v${r.current}）`);
    else alert('检查更新失败：' + ((r && r.error) || '未知错误'));
  }
});

$('#btnUpdCheck').addEventListener('click', async () => {
  const btn = $('#btnUpdCheck');
  btn.disabled = true;
  btn.textContent = '检查中…';
  try {
    const r = await window.api.checkUpdate();
    await updateUpdateUI();
    if (r && r.ok && r.hasUpdate) showUpdateToast(r);
    else if (r && r.ok) alert(`已是最新版本 v${r.latest}（当前 v${r.current}）`);
    else alert('检查更新失败：' + ((r && r.error) || '未知错误'));
  } finally {
    btn.disabled = false;
    btn.textContent = '检查更新';
  }
});

$('#btnUpdDownload').addEventListener('click', () => doDownloadUpdate());
$('#btnUpdInstall').addEventListener('click', async () => {
  const r = await window.api.installUpdate();
  if (!r || !r.ok) alert('无法打开安装包：' + ((r && r.error) || '未知错误'));
});
$('#btnUpdPage').addEventListener('click', async () => {
  const r = await window.api.openUpdatePage();
  if (!r || !r.ok) alert('无法打开发布页：' + ((r && r.error) || '未知错误'));
});

// ---------- 节日与农历设置 ----------
let festMeta = null;

async function getFestMeta() {
  if (festMeta) return festMeta;
  try {
    festMeta = await window.api.getFestivalsMeta();
  } catch (e) {
    festMeta = { countries: [], lists: {}, prefs: {} };
  }
  return festMeta;
}

async function saveFestivalPrefs(patch) {
  prefs.festivals = Object.assign({ showLunar: true, countries: ['cn'], hidden: [] }, prefs.festivals || {}, patch);
  await window.api.setPrefs({ festivals: prefs.festivals });
  clearFestCache();
  renderCalendar();
  renderDayPanel();
}

async function renderFestivalUI() {
  const meta = await getFestMeta();
  const fp = prefs.festivals || { showLunar: true, countries: ['cn'], hidden: [] };
  $('#sShowLunar').checked = fp.showLunar !== false;
  const box = $('#festCountries');
  box.innerHTML = '';
  (meta.countries || []).forEach((c) => {
    const on = (fp.countries || []).includes(c.code);
    const el = document.createElement('div');
    el.className = 'fest-chip' + (on ? ' on' : '');
    el.textContent = c.name;
    el.title = on ? '点击隐藏该国节日' : '点击显示该国节日';
    el.addEventListener('click', async () => {
      const cur = new Set(prefs.festivals && prefs.festivals.countries ? prefs.festivals.countries : ['cn']);
      if (cur.has(c.code)) cur.delete(c.code); else cur.add(c.code);
      const countries = [...cur];
      if (!countries.length) { alert('至少保留一个国家 / 地区'); return; }
      await saveFestivalPrefs({ countries });
      await renderFestivalUI();
    });
    box.appendChild(el);
  });
}

$('#sShowLunar').addEventListener('change', async (e) => {
  await saveFestivalPrefs({ showLunar: e.target.checked });
});

async function openFestModal() {
  const meta = await getFestMeta();
  const fp = prefs.festivals || { showLunar: true, countries: ['cn'], hidden: [] };
  const wrap = $('#festList');
  wrap.innerHTML = '';
  const codes = fp.countries || [];
  if (!codes.length) {
    wrap.innerHTML = '<p class="hint">请先选择至少一个国家 / 地区（在设置里点国家标签）。</p>';
  }
  codes.forEach((code) => {
    const c = (meta.countries || []).find((x) => x.code === code);
    const names = (meta.lists || {})[code] || [];
    const group = document.createElement('div');
    group.className = 'fest-group';
    group.innerHTML = `<h4>${esc(c ? c.name : code)}（${names.length} 个）</h4>`;
    names.forEach((n) => {
      const row = document.createElement('label');
      row.className = 'fest-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !fp.hidden.includes(n);
      cb.addEventListener('change', async () => {
        const hidden = new Set((prefs.festivals && prefs.festivals.hidden) || []);
        if (cb.checked) hidden.delete(n); else hidden.add(n);
        await saveFestivalPrefs({ hidden: [...hidden] });
      });
      const span = document.createElement('span');
      span.textContent = n;
      row.appendChild(cb);
      row.appendChild(span);
      group.appendChild(row);
    });
    wrap.appendChild(group);
  });
  $('#festModal').hidden = false;
}

$('#btnFestManage').addEventListener('click', () => openFestModal());

// ---------- 插件（开源扩展口） ----------
// 插件目录 userData/plugins/<id>/（plugin.json + renderer.js），渲染层脚本在此页面注入执行
async function loadPlugins() {
  let list = [];
  try { list = await window.api.listPlugins(); } catch (e) { console.error('读取插件失败', e); }
  for (const p of list) {
    if (!p.enabled || !p.rendererUrl) continue;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = p.rendererUrl;
      s.onload = () => resolve();
      s.onerror = () => { console.error('插件加载失败', p.id); resolve(); };
      document.head.appendChild(s);
    });
  }
}

async function renderPluginList() {
  const box = $('#pluginList');
  let list = [];
  try { list = await window.api.listPlugins(); } catch (e) { /* noop */ }
  if (!list || !list.length) {
    box.innerHTML = '<div class="plugin-empty">暂无插件。点下方「打开插件目录」放置你的插件（参考 README 插件口文档）。</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'plugin-item';
    row.innerHTML = `<div class="plugin-meta">
        <div class="plugin-name">${esc(p.name)}<span class="plugin-ver">v${esc(p.version)}</span></div>
        ${p.description ? `<div class="plugin-desc" title="${esc(p.description)}">${esc(p.description)}</div>` : ''}
      </div>`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p.enabled;
    cb.addEventListener('change', async () => {
      try {
        await window.api.setPluginEnabled(p.id, cb.checked);
        alert(`插件「${p.name}」已${cb.checked ? '启用' : '停用'}，将在下次启动应用时生效。`);
      } catch (e) {
        cb.checked = !cb.checked;
      }
    });
    row.appendChild(cb);
    box.appendChild(row);
  });
}

$('#btnOpenPluginDir').addEventListener('click', async () => {
  try { await window.api.openPluginDir(); } catch (e) { alert('无法打开插件目录'); }
});
$('#btnCreateDemoPlugin').addEventListener('click', async () => {
  try {
    const r = await window.api.createDemoPlugin();
    if (r && r.ok) {
      alert('已生成示例插件 demo-hello.js 并打开文件。\n重启应用后生效，可在插件列表里启停。');
      await renderPluginList();
    } else {
      alert('生成失败：' + ((r && r.error) || '未知错误'));
    }
  } catch (e) { alert('生成失败'); }
});
$('#btnPluginGuide').addEventListener('click', async () => {
  try {
    const r = await window.api.openPluginGuide();
    if (!r || !r.ok) alert('打开教程失败：' + ((r && r.error) || '未知错误'));
  } catch (e) { alert('打开教程失败'); }
});
$('#sAccent').addEventListener('input', (e) => setThemeColor('accent', e.target.value));
$('#sAccentBg').addEventListener('input', (e) => setThemeColor('bg', e.target.value));
$('#sWeekStart').addEventListener('change', async (e) => {
  prefs.weekStart = Number(e.target.value);
  await window.api.setPrefs({ weekStart: prefs.weekStart });
  renderCalendar(); bindCalEvents();
});
$('#sNotifySound').addEventListener('change', async (e) => {
  prefs.notifySound = e.target.checked;
  await window.api.setPrefs({ notifySound: prefs.notifySound });
});

// ---------- 通知点击 → 聚焦任务 ----------
window.api.onFocusTask(async (taskId) => {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  const todayStr = fmtDate(new Date());
  if (taskOccursOn(t, todayStr)) selectedDate = todayStr;
  else {
    const d = dateOf(t.date);
    viewY = d.getFullYear(); viewM = d.getMonth();
    selectedDate = t.date;
  }
  renderCalendar(); bindCalEvents(); renderDayPanel();
  openTaskModal(t);
});

// ---------- 初始化 ----------
async function refresh() {
  tasks = await window.api.listTasks();
  segments = await window.api.listSegments();
  renderCalendar();
  renderDayPanel();
}

(async function init() {
  prefs = { weekStart: 1, notifySound: true, theme: { ...DEFAULT_THEME }, ...(await window.api.getPrefs()) };
  applyTheme();
  applyBgOpacity();
  await applyBgMedia();
  await reloadDayImgs();
  await refresh();
  bindCalEvents();
  initBgPeek();
  initWidgetDrag();
  setInterval(updateLiquids, 1000); // 液体倒计时：每秒刷新液面
  // 桌面小组件双击标题 → 主窗口跳到该日期
  window.api.onFocusDate((dateStr) => {
    const d = dateOf(dateStr);
    viewY = d.getFullYear();
    viewM = d.getMonth();
    selectedDate = dateStr;
    renderCalendar();
    renderDayPanel();
  });
  await loadPlugins(); // 加载启用的渲染层插件（此时 eveBus 与 window.api 均已就绪）
  window.eveBus.__ready = true;
  window.eveBus.emit('eve:ready');
})();
