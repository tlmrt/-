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
  // 时间段任务不在这里列出：它们由 segmentsOn() 以「时间段卡片 + 液体」的形式展示，避免重复
  return tasks
    .filter((t) => taskOccursOn(t, dateStr) && t.segment !== true)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// 某天的全部时间段（含由时间段任务派生的）—— 已经是任务的一部分，直接用 segments 视图
function segmentsOnTaskList(dateStr) {
  return tasks.filter((t) => t.segment === true && t.date === dateStr);
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
      cellTasks += `<div class="cell-task p-${t.priority}" data-task="${esc(t.id)}" title="${esc(t.time)} ${esc(t.title)}（可拖到别的日期）">${esc(t.time)} ${esc(t.title)}</div>`;
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
// 周视图液面：每秒只改高度，不重建 DOM（避免打断点击）
function updateWeekLiquids() {
  const box = $('#weekView');
  if (!box || box.hidden) return;
  const now = Date.now();
  box.querySelectorAll('.wk-seg').forEach((el) => {
    const s = segments.find((x) => x.id === el.dataset.seg);
    const fill = el.querySelector('.wk-seg-fill');
    if (!s || !fill) return;
    const { start, end } = segRange(s);
    let ratio = 1;
    if (now >= end) ratio = 0;
    else if (now >= start) ratio = (end - now) / (end - start);
    fill.style.height = `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;
  });
}

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
  updateWeekLiquids(); // 周视图里时间段的液面同步下降
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
      el.querySelector('[data-act="edit"]').addEventListener('click', () => {
        const t = tasks.find((x) => x.id === s.id);
        openTaskModal(t || null);
      });
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
        <div class="tc-tags">${tagHtml}${hasMaaReminder(t) ? '<span class="maa-tag" title="到点会启动 MAA">🎮 启动 MAA</span>' : ''}</div>
        <div class="tc-actions">
          ${hasMaaReminder(t) ? '<button class="mini-btn" data-act="maa" title="立即启动 MAA">▶</button>' : ''}
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
  if (!remindDraft.length) {
    wrap.innerHTML = '<div class="hint" style="margin:0 0 6px">还没有提醒。点下面「＋ 添加提醒」加一条，可设为「弹通知提醒」或「🎮 启动 MAA」。</div>';
    return;
  }
  remindDraft.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'reminder-row';
    const offOpts = OFFSET_CHOICES
      .map(([v, l]) => `<option value="${v}" ${Number(r.offsetMinutes) === Number(v) ? 'selected' : ''}>${l}</option>`)
      .join('');
    row.innerHTML = `
      <select class="rm-off" title="什么时候触发">${offOpts}</select>
      <select class="rm-act ${r.action === 'maa' ? 'maa' : ''}" title="到点做什么">
        <option value="notify" ${r.action === 'maa' ? '' : 'selected'}>弹通知提醒</option>
        <option value="maa" ${r.action === 'maa' ? 'selected' : ''}>🎮 启动 MAA</option>
      </select>
      <button type="button" class="rm-del" data-i="${i}" title="删除这条提醒">✕</button>`;
    row.querySelector('.rm-off').addEventListener('change', (e) => { remindDraft[i].offsetMinutes = Number(e.target.value); });
    row.querySelector('.rm-act').addEventListener('change', (e) => {
      remindDraft[i].action = e.target.value === 'maa' ? 'maa' : 'notify';
      renderReminders();
    });
    row.querySelector('.rm-del').addEventListener('click', () => {
      remindDraft.splice(i, 1);
      renderReminders();
    });
    wrap.appendChild(row);
  });
}

// 是否含"启动 MAA"的提醒
function hasMaaReminder(task) {
  return !!(task && ((task.maa && task.maa.enabled) || (task.reminders || []).some((r) => r && r.action === 'maa')));
}

function openTaskModal(task) {
  $('#taskModalTitle').textContent = task ? '编辑任务' : '新建任务';
  $('#fId').value = task ? task.id : '';
  $('#fTitle').value = task ? task.title : '';
  $('#fDate').value = task ? task.date : selectedDate;
  // 新建任务时默认使用"当前时间"
  const now = new Date();
  const defaultTime = task ? task.time : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#fTime').value = defaultTime;
  $('#fRepeat').value = task ? (task.repeat || 'none') : 'none';
  $('#fPriority').value = task ? (task.priority || 'medium') : 'medium';
  $('#fTags').value = task && task.tags ? task.tags.join(', ') : '';
  $('#fNote').value = task ? (task.note || '') : '';
  remindDraft = task && task.reminders && task.reminders.length
    ? task.reminders.map((r) => ({
      id: r.id,
      offsetMinutes: Number(r.offsetMinutes) || 0,
      action: r.action === 'maa' ? 'maa' : 'notify',
    }))
    : [];
  // 兼容旧数据：以前的任务级"到点启动 MAA"迁移成一条「启动 MAA」提醒项
  if (task && task.maa && task.maa.enabled && !remindDraft.some((r) => r.action === 'maa')) {
    remindDraft.push({ id: 'r_maa_' + (task.id || Date.now().toString(36)), offsetMinutes: 0, action: 'maa' });
  }
  renderReminders();

  // 类型（普通任务 / 时间段）与其专属字段
  const isSeg = !!(task && task.segment);
  $('#fKind').value = isSeg ? 'segment' : 'task';
  $('#fSegWrap').hidden = !isSeg;
  $('#fEndTime').value = isSeg ? (task.endTime || '') : '';
  $('#fSegColor').value = (isSeg && /^#[0-9a-fA-F]{6}$/.test(String(task.color || '')))
    ? task.color
    : ((prefs.theme && prefs.theme.accent) || '#4f6bff');

  $('#taskModal').hidden = false;
  // 打开即把光标放进标题：不用点也能直接打字（编辑时全选，方便直接覆盖）
  setTimeout(() => {
    try {
      const t = $('#fTitle');
      t.focus();
      if (task && t.value) t.select();
    } catch (e) { /* 忽略 */ }
  }, 30);
}

// 任务类型切换：时间段时显示结束时间与液体颜色（默认给两小时时长）
$('#fKind').addEventListener('change', () => {
  const isSeg = $('#fKind').value === 'segment';
  $('#fSegWrap').hidden = !isSeg;
  if (isSeg && !$('#fEndTime').value) {
    const [h, m] = ($('#fTime').value || '09:00').split(':').map(Number);
    const end = new Date(2000, 0, 1, (h || 0) + 2, m || 0);
    $('#fEndTime').value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
});

// 任务弹窗里的「一句话快速填写」：回车解析并填入下面各项
$('#fQuick').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = e.target.value.trim();
  if (!text) return;
  let r = null;
  try { r = await window.api.parseQuickTask(text); } catch (err) { r = null; }
  if (!r || !r.ok) { alert('没解析出内容，直接把这句话作为标题填进去了'); $('#fTitle').value = text; e.target.value = ''; return; }
  if (r.title) $('#fTitle').value = r.title;
  if (r.date) $('#fDate').value = r.date;
  if (r.time) $('#fTime').value = r.time;
  if (r.repeat && r.repeat !== 'none') $('#fRepeat').value = r.repeat;
  if (Array.isArray(r.reminders) && r.reminders.length) {
    remindDraft = remindDraft.concat(r.reminders.map((x, i) => ({
      id: 'r_q' + Date.now().toString(36) + i,
      offsetMinutes: Number(x.offsetMinutes) || 0,
      action: 'notify',
    })));
    renderReminders();
  }
  e.target.value = '';
});

// 任务弹窗里的「一句话快速填写」等交互，需要在表单提交前确保快速框不参与校验
function closeModal(id) {
  document.getElementById(id).hidden = true;
}

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeModal(b.dataset.close));
});
document.querySelectorAll('.modal-mask').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
});

// ---------- 选项旁的 ⓘ 说明浮层 ----------
// 用「单例浮层 + 事件委托」实现：既不受弹窗滚动区裁切，DOM 重绘后也不会失效
function initInfoTips() {
  const tip = $('#infoTip');
  if (!tip) return;
  let current = null;

  function place(dot) {
    const r = dot.getBoundingClientRect();
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }
  function show(dot) {
    const text = dot.getAttribute('data-tip');
    if (!text) return;
    current = dot;
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.add('on');
    place(dot);
  }
  function hide() {
    current = null;
    tip.classList.remove('on');
    tip.hidden = true;
  }
  const dotOf = (t) => (t && t.closest ? t.closest('.info-dot') : null);

  document.addEventListener('mouseover', (e) => {
    const d = dotOf(e.target);
    if (d) { if (d !== current) show(d); } else if (current) hide();
  });
  document.addEventListener('focusin', (e) => {
    const d = dotOf(e.target);
    if (d) show(d);
  });
  document.addEventListener('focusout', () => { if (current) hide(); });
  document.addEventListener('click', (e) => {
    const d = dotOf(e.target);
    if (d) { e.preventDefault(); d.focus(); }
  });
  window.addEventListener('scroll', () => { if (current) place(current); }, true);
  window.addEventListener('resize', () => { if (current) place(current); });
  window.addEventListener('blur', () => hide());
}

// ---------- 设置面板：分类切换（外观 / 日历 / 提醒与启动 / 联动与 MAA / 更新与插件） ----------
let settingsTab = 'look';
function initSettingsTabs() {
  const nav = $('#settingsNav');
  if (!nav) return;
  const tabs = Array.from(nav.querySelectorAll('.settings-tab'));
  const body = document.querySelector('#settingsModal .modal-body');
  const fields = Array.from(body.querySelectorAll('[data-tab]'));

  function show(tab) {
    settingsTab = tab;
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    fields.forEach((f) => { f.hidden = f.dataset.tab !== tab; });
    if (body) body.scrollTop = 0;
  }
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('.settings-tab');
    if (b) show(b.dataset.tab);
  });
  show(tabs.some((b) => b.dataset.tab === settingsTab) ? settingsTab : (tabs[0] && tabs[0].dataset.tab) || 'look');
}

// ---------- 输入框聚焦兜底 ----------
// 少数环境（远程桌面、安全软件注入、输入法冲突）下点击文本输入框可能不聚焦，表现为"点不动"。
// 注意：只处理「文本类 input / textarea」，且延后一小段时间、确认仍未聚焦才补 focus——
// select、date/time/color/file/range 这些原生控件点击时会弹自己的 UI，强行 focus 会打断它们。
function initInputFocusFallback() {
  const TEXT_TYPES = ['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number'];
  document.addEventListener('mousedown', (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (tag === 'input') {
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (!TEXT_TYPES.includes(type)) return;
    }
    if (el.disabled || el.readOnly) return;
    if (document.activeElement === el) return;
    setTimeout(() => {
      if (!document.contains(el)) return;
      if (document.activeElement === el) return;
      if (!document.hasFocus()) return;
      try { el.focus(); } catch (err) { /* 忽略 */ }
    }, 80);
  }, true);
}

// 添加提醒：直接追加一行（时间/动作在行内选择）
$('#btnAddReminder').addEventListener('click', () => {
  remindDraft.push({
    id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    offsetMinutes: 0,
    action: 'notify',
  });
  renderReminders();
});

// 表单提交
$('#taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#fTitle').value.trim();
  const date = $('#fDate').value;
  const time = $('#fTime').value;
  if (!title || !date || !time) return;
  const tags = $('#fTags').value.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
  const isSegment = $('#fKind').value === 'segment';
  let endTime = '';
  if (isSegment) {
    endTime = $('#fEndTime').value || time;
    if (endTime === time) { alert('时间段的结束时间不能与开始时间相同'); return; }
  }
  const payload = {
    id: $('#fId').value || undefined,
    title,
    date,
    time,
    segment: isSegment,
    endTime: isSegment ? endTime : undefined,
    color: isSegment ? $('#fSegColor').value : undefined,
    note: $('#fNote').value.trim(),
    tags,
    priority: $('#fPriority').value,
    repeat: $('#fRepeat').value,
    reminders: remindDraft.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      action: r.action === 'maa' ? 'maa' : 'notify',
    })),
  };
  await window.api.saveTask(payload);
  window.eveBus.emit(isSegment ? 'eve:segment-saved' : 'eve:task-saved', payload);
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
    // 时间段现在就是任务，删除走任务通道
    await window.api.deleteTask(deleteSegTarget.id);
    await refresh();
  }
  $('#confirmWrap').hidden = true;
  deleteTarget = null;
  deleteSegTarget = null;
});

// ---------- 周视图（时间轴） ----------
let calView = 'month';   // month | week
const WEEK_HOUR_H = 46;  // 每小时的行高

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return 0;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

function weekDays() {
  const ws = Number(prefs.weekStart) === 0 ? 0 : 1;
  const base = dateOf(selectedDate);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const diff = (start.getDay() - ws + 7) % 7;
  start.setDate(start.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function renderWeek() {
  const box = $('#weekView');
  if (!box) return;
  const days = weekDays();
  const todayStr = fmtDate(new Date());
  const hours = Array.from({ length: 24 }, (_, h) => h);

  let html = '<div class="wk-head"><div class="wk-gutter"></div>';
  html += days.map((d) => {
    const ds = fmtDate(d);
    return `<div class="wk-col-head${ds === todayStr ? ' today' : ''}" data-date="${ds}">
        <div>周${'日一二三四五六'[d.getDay()]}</div>
        <div class="wk-daynum">${d.getDate()}</div>
      </div>`;
  }).join('');
  html += '</div><div class="wk-body"><div class="wk-gutter">';
  html += hours.map((h) => `<div class="wk-hour" style="height:${WEEK_HOUR_H}px">${String(h).padStart(2, '0')}:00</div>`).join('');
  html += '</div>';

  html += days.map((d) => {
    const ds = fmtDate(d);
    const dayTasks = tasks.filter((t) => taskOccursOn(t, ds) && t.segment !== true);
    const daySegs = segments.filter((s) => s.date === ds);
    const slots = hours.map((h) => `<div class="wk-slot" data-date="${ds}" data-hour="${h}" style="height:${WEEK_HOUR_H}px"></div>`).join('');
    const nowMs = Date.now();
    const segHtml = daySegs.map((s) => {
      const startMin = hhmmToMin(s.start);
      const endMin = hhmmToMin(s.end);
      const top = (startMin / 60) * WEEK_HOUR_H;
      const bottom = endMin > startMin ? (endMin / 60) * WEEK_HOUR_H : 24 * WEEK_HOUR_H;
      const h = Math.max(20, bottom - top);
      // 液体：未开始=满，进行中=按剩余比例下降，已结束=空
      const st = at(s.date, s.start).getTime();
      let en = at(s.date, s.end).getTime();
      if (en <= st) en += 24 * 60 * 60 * 1000;
      let ratio = 1;
      let active = false;
      if (nowMs >= en) ratio = 0;
      else if (nowMs >= st) { ratio = (en - nowMs) / (en - st); active = true; }
      const remain = active ? fmtRemain(en - nowMs) : '';
      return `<div class="wk-seg${active ? ' active' : ''}" data-seg="${esc(s.id)}" style="--lc:${esc(s.color)};top:${top}px;height:${h}px">
          <div class="wk-seg-fill" style="height:${(ratio * 100).toFixed(1)}%"></div>
          <div class="wk-seg-body">
            <span class="wk-seg-title">${esc(s.title || '时间段')}</span>
            <span class="wk-seg-meta">${esc(s.start)}-${esc(s.end)}${remain ? ' · 剩 ' + esc(remain) : ''}</span>
          </div>
        </div>`;
    }).join('');
    const taskHtml = dayTasks.map((t) => {
      const top = (hhmmToMin(t.time) / 60) * WEEK_HOUR_H;
      return `<div class="wk-task ${esc(t.priority || '')}" data-task="${esc(t.id)}" title="${esc(t.time + ' ' + t.title)}" style="top:${top}px">${esc(t.time)} ${esc(t.title)}</div>`;
    }).join('');
    return `<div class="wk-col" data-date="${ds}">${slots}${segHtml}${taskHtml}</div>`;
  }).join('');
  html += '</div>';
  box.innerHTML = html;

  const days2 = weekDays();
  const a = days2[0];
  const b = days2[6];
  $('#monthTitle').textContent = `${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`;
}

function setCalView(v) {
  calView = v === 'week' ? 'week' : 'month';
  const isWeek = calView === 'week';
  $('#weekView').hidden = !isWeek;
  $('#calHead').hidden = isWeek;
  $('#calGrid').hidden = isWeek;
  $('#btnViewMonth').classList.toggle('active', !isWeek);
  $('#btnViewWeek').classList.toggle('active', isWeek);
  $('#btnPrev').title = isWeek ? '上一周' : '上个月';
  $('#btnNext').title = isWeek ? '下一周' : '下个月';
  if (isWeek) renderWeek(); else { renderCalendar(); bindCalEvents(); }
}

$('#btnViewMonth').addEventListener('click', () => setCalView('month'));
$('#btnViewWeek').addEventListener('click', () => setCalView('week'));

// 周视图交互：点空白建任务、点任务块编辑
$('#weekView').addEventListener('click', (e) => {
  const taskEl = e.target.closest('.wk-task');
  if (taskEl) {
    const t = tasks.find((x) => x.id === taskEl.dataset.task);
    if (t) { selectedDate = t.date; renderDayPanel(); openTaskModal(t); }
    return;
  }
  // 点时间段色块 → 打开对应任务的编辑弹窗
  const segEl = e.target.closest('.wk-seg');
  if (segEl) {
    const t = tasks.find((x) => x.id === segEl.dataset.seg);
    if (t) { selectedDate = t.date; renderDayPanel(); openTaskModal(t); }
    return;
  }
  const head = e.target.closest('.wk-col-head');
  if (head) {
    selectedDate = head.dataset.date;
    const d = dateOf(selectedDate);
    viewY = d.getFullYear(); viewM = d.getMonth();
    renderWeek(); renderDayPanel();
    return;
  }
  const slot = e.target.closest('.wk-slot');
  if (slot) {
    const ds = slot.dataset.date;
    const hh = Number(slot.dataset.hour);
    selectedDate = ds;
    const d = dateOf(ds);
    viewY = d.getFullYear(); viewM = d.getMonth();
    openTaskModal(null);
    $('#fDate').value = ds;
    $('#fTime').value = `${String(hh).padStart(2, '0')}:00`;
    renderDayPanel();
  }
});

// ---------- 导航按钮 ----------
$('#btnToday').addEventListener('click', () => {
  const now = new Date();
  viewY = now.getFullYear(); viewM = now.getMonth();
  selectedDate = fmtDate(now);
  if (calView === 'week') { renderWeek(); renderDayPanel(); return; }
  renderCalendar(); bindCalEvents(); renderDayPanel();
});
$('#btnPrev').addEventListener('click', () => {
  if (calView === 'week') {
    const d = dateOf(selectedDate);
    d.setDate(d.getDate() - 7);
    selectedDate = fmtDate(d);
    viewY = d.getFullYear(); viewM = d.getMonth();
    renderWeek(); renderDayPanel();
    return;
  }
  viewM--; if (viewM < 0) { viewM = 11; viewY--; }
  renderCalendar(); bindCalEvents();
});
$('#btnNext').addEventListener('click', () => {
  if (calView === 'week') {
    const d = dateOf(selectedDate);
    d.setDate(d.getDate() + 7);
    selectedDate = fmtDate(d);
    viewY = d.getFullYear(); viewM = d.getMonth();
    renderWeek(); renderDayPanel();
    return;
  }
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

// ---------- 时间段（已并入任务：在「添加任务」里把类型选成"时间段"）----------
const SEG_PRESET_COLORS = ['#4f6bff', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#334155'];

// 时间段的新建/编辑入口已合并到「＋ 添加任务」弹窗（类型 = 时间段）

// ---------- 拖拽日期格子到桌面 → 生成小组件 ----------
// 拖拽：①拖任务条/任务卡片到别的日期格 → 改期；②拖日期格空白到桌面 → 生成小组件
function initWidgetDrag() {
  const THRESH = 8;
  let drag = null;

  const clearHover = () => {
    document.querySelectorAll('.day-cell.drag-over').forEach((c) => c.classList.remove('drag-over'));
  };

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // e.target 可能是 document（例如程序化派发），做一次保护
    const tgt = e.target && e.target.closest ? e.target : null;
    if (!tgt) return;
    // ① 拖任务（日历格里的任务条 / 右栏任务卡片）→ 移动日期
    const cellTask = tgt.closest('.cell-task[data-task]');
    const card = tgt.closest('.task-card[data-id]');
    if (cellTask || card) {
      const id = cellTask ? cellTask.dataset.task : card.dataset.id;
      if (id && tasks.some((t) => t.id === id)) {
        drag = { kind: 'task', taskId: id, sx: e.clientX, sy: e.clientY, moved: false };
        return;
      }
    }
    if (tgt.closest('.cell-img')) return;
    // ② 拖日期格子空白 → 生成桌面小组件
    const cell = tgt.closest('.day-cell');
    if (!cell) return;
    drag = { kind: 'widget', date: cell.dataset.date, sx: e.clientX, sy: e.clientY, moved: false };
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < THRESH) return;
    if (!drag.moved) {
      drag.moved = true;
      document.body.classList.add(drag.kind === 'task' ? 'dragging-task' : 'dragging-widget');
    }
    const g = $('#dragGhost');
    g.hidden = false;
    g.style.left = `${e.clientX}px`;
    g.style.top = `${e.clientY}px`;
    if (drag.kind === 'task') {
      const t = tasks.find((x) => x.id === drag.taskId);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const cell = under && under.closest ? under.closest('.day-cell') : null;
      const target = cell ? cell.dataset.date : '';
      clearHover();
      if (cell && t && target !== t.date) {
        cell.classList.add('drag-over');
        g.textContent = `松手把「${t.title}」移到 ${target}`;
      } else {
        g.textContent = t ? `拖动「${t.title}」到别的日期` : '拖动任务';
      }
    } else {
      g.textContent = `松手放到桌面 → 「${drag.date}」小组件`;
    }
  });

  document.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove('dragging-task', 'dragging-widget');
    $('#dragGhost').hidden = true;
    clearHover();
    if (!d.moved) return;
    suppressClickUntil = Date.now() + 400; // 拖拽后不触发选中/编辑

    if (d.kind === 'task') {
      const t = tasks.find((x) => x.id === d.taskId);
      if (!t) return;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const cell = under && under.closest ? under.closest('.day-cell') : null;
      const target = cell ? cell.dataset.date : '';
      if (!target || target === t.date) return; // 没落在别的日期上
      const moved = { ...t, date: target };
      await window.api.saveTask(moved);
      window.eveBus.emit('eve:task-saved', moved);
      selectedDate = target;
      const dd = dateOf(target);
      viewY = dd.getFullYear();
      viewM = dd.getMonth();
      await refresh();
      if (window.eve && window.eve.toast) {
        window.eve.toast(
          t.repeat && t.repeat !== 'none'
            ? `已把「${t.title}」的起始日改到 ${target}（重复任务从这天重新开始）`
            : `已把「${t.title}」移到 ${target}`,
          3500
        );
      }
      return;
    }

    // 小组件：只有松手位置在主窗口外才创建
    const outX = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth;
    const outY = e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (outX || outY) {
      const r = await window.api.createWidget({ date: d.date, x: e.screenX - 116, y: e.screenY - 40 });
      if (r && r.ok) window.eveBus.emit('eve:widget-created', d.date);
    }
  });

  document.addEventListener('pointercancel', () => {
    drag = null;
    document.body.classList.remove('dragging-task', 'dragging-widget');
    $('#dragGhost').hidden = true;
    clearHover();
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
      // 视频声音：默认静音；用户在设置里开启后按设定音量播放
      bgVideoEl.muted = theme.videoSound !== true;
      bgVideoEl.volume = Math.max(0, Math.min(1, (Number(theme.videoVolume) || 60) / 100));
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
  // 视频声音：只在设置了背景视频时才出现
  const soundOn = t.videoSound === true;
  const vol = Number.isFinite(Number(t.videoVolume)) ? Number(t.videoVolume) : 60;
  $('#videoSoundRow').hidden = !hasVid;
  $('#sVideoSound').checked = soundOn;
  $('#videoSoundWrap').hidden = !hasVid || !soundOn;
  $('#sVideoVolume').value = String(vol);
  $('#sVideoVolumeVal').textContent = `${vol}%`;
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

// 背景视频的声音：开关 + 音量（默认静音，避免突然出声）
$('#sVideoSound').addEventListener('change', async (e) => {
  const on = e.target.checked;
  prefs.theme = Object.assign({}, prefs.theme, { videoSound: on });
  $('#videoSoundWrap').hidden = !on;
  await saveTheme();
  if (bgVideoEl) {
    bgVideoEl.muted = !on;
    bgVideoEl.volume = Math.max(0, Math.min(1, (Number(prefs.theme.videoVolume) || 60) / 100));
    if (on) {
      const p = bgVideoEl.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
});
$('#sVideoVolume').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#sVideoVolumeVal').textContent = `${v}%`;
  prefs.theme = Object.assign({}, prefs.theme, { videoVolume: v });
  if (bgVideoEl) bgVideoEl.volume = Math.max(0, Math.min(1, v / 100));
});
$('#sVideoVolume').addEventListener('change', async () => {
  await saveTheme();
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
  await updateBackupUI();
  updateQuietUI();
  $('#settingsSaveHint').textContent = '';
  $('#settingsSaveHint').classList.remove('warn');
  $('#settingsModal').hidden = false;
});
$('#sAutoStart').addEventListener('change', async (e) => {
  const want = e.target.checked;
  try {
    const r = await window.api.setAutostart(want);
    const real = !!(r && r.enabled);
    if (real !== want) {
      // 写入后回读不一致：把勾选框纠正成真实状态，别让界面骗人
      e.target.checked = real;
      alert(want
        ? '开机自启没能写入系统启动项（可能被安全软件拦截）。\n可以手动把本程序的快捷方式放进「启动」文件夹（Win+R 输入 shell:startup）。'
        : '关闭开机自启失败，系统启动项里仍然有本程序。');
    }
  } catch (err) {
    e.target.checked = !want;
    alert('设置开机自启失败：' + (err && err.message ? err.message : '未知错误'));
  }
});

// 设置面板：把面板上的值一次性保存，并回读校验开机自启的真实状态
async function saveSettingsFromPanel() {
  const notes = [];
  const weekStart = Number($('#sWeekStart').value) === 0 ? 0 : 1;
  const notifySound = $('#sNotifySound').checked;
  prefs.weekStart = weekStart;
  prefs.notifySound = notifySound;
  try {
    await window.api.setPrefs({ weekStart, notifySound });
  } catch (e) {
    notes.push('基础设置保存失败');
  }

  const want = $('#sAutoStart').checked;
  try {
    const r = await window.api.setAutostart(want);
    const real = !!(r && r.enabled);
    $('#sAutoStart').checked = real;
    if (want && !real) notes.push('开机自启未生效（可能被安全软件拦截），已显示实际状态');
    if (!want && real) notes.push('开机自启关闭失败，仍处于启用状态');
  } catch (e) {
    notes.push('开机自启设置失败：' + (e && e.message ? e.message : '未知错误'));
  }
  return { ok: notes.length === 0, notes };
}

$('#btnSettingsSave').addEventListener('click', async () => {
  const btn = $('#btnSettingsSave');
  const hint = $('#settingsSaveHint');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '保存中…';
  hint.textContent = '';
  hint.classList.remove('warn');
  try {
    const r = await saveSettingsFromPanel();
    btn.textContent = r.ok ? '已保存 ✓' : '部分未生效';
    hint.textContent = r.ok ? '设置已保存到本机' : r.notes.join('；');
    hint.classList.toggle('warn', !r.ok);
  } catch (e) {
    btn.textContent = '保存失败';
    hint.textContent = String((e && e.message) || e);
    hint.classList.add('warn');
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 1800);
  }
});

// 点「完成」关闭前静默再保存一次，避免改了却没落盘
$('#btnSettingsDone').addEventListener('click', () => {
  saveSettingsFromPanel().catch(() => {});
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
let maaLevels = [];        // MAA 关卡清单（来自 MAA 的 resource/stages.json）
let maaLevelsError = '';

async function ensureMaaLevels(force, alwaysCheck) {
  if (maaLevels.length && !force && !alwaysCheck) return true;
  try {
    const r = await window.api.maaLevels(!!force);
    if (r && r.ok) {
      maaLevels = r.levels || [];
      maaLevelsError = '';
      // 主进程检测到 MAA 资源变化（MAA 更新过）时提示一次
      if (r.refreshed && window.eve && window.eve.toast) {
        window.eve.toast(`已同步 MAA 最新关卡数据（${r.count} 个关卡）`);
      }
      return true;
    }
    maaLevels = [];
    maaLevelsError = (r && r.error) || '未知错误';
    return false;
  } catch (e) {
    maaLevels = [];
    maaLevelsError = String(e && e.message ? e.message : e);
    return false;
  }
}

// 关卡匹配（与 src/maaconfig.js 同规则）
// 关卡开放状态标签
function openStateHtml(l) {
  if (!l) return '';
  if (l.openState === 'open') return '<span class="ml-open is-open">开放中</span>';
  if (l.openState === 'past') return '<span class="ml-open is-past">往期</span>';
  return '<span class="ml-open is-always">常驻</span>';
}

function stageKeyLocal(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[\s\-_]/g, '');
}

function normalizeStageCodeLocal(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  const key = stageKeyLocal(raw);
  if (!key) return null;
  return (maaLevels.find((l) => stageKeyLocal(l.code) === key)
    || maaLevels.find((l) => stageKeyLocal(l.code).startsWith(key))
    || maaLevels.find((l) => stageKeyLocal(l.code).endsWith(key))
    || {}).code || null;
}

function searchLevelsLocal(keyword) {
  const raw = String(keyword == null ? '' : keyword).trim();
  const rank = { current: 0, common: 1, special: 2, event: 3, resource: 4, main: 5, other: 6 };
  const rankOf = (l) => (rank[l.group] !== undefined ? rank[l.group] : 7);
  const byGroup = (a, b) => {
    const g = rankOf(a) - rankOf(b);
    if (g) return g;
    if (a.group === 'event' && b.group === 'event') {
      const byNew = (Number(b.eventOrder) || 0) - (Number(a.eventOrder) || 0);
      if (byNew) return byNew;
    }
    return String(a.code).localeCompare(String(b.code), 'zh-CN', { numeric: true, sensitivity: 'base' });
  };
  if (!raw) return [...maaLevels].sort(byGroup).slice(0, 12); // 常用资源本 + 最新活动置顶
  const key = stageKeyLocal(raw);
  const lower = raw.toLowerCase();
  const scored = [];
  for (const l of maaLevels) {
    const ck = stageKeyLocal(l.code);
    const label = String(l.groupLabel || '').toLowerCase();
    const groupName = String(l.group || '').toLowerCase();
    const stateTxt = l.openState === 'open' ? '开放中' : l.openState === 'past' ? '往期' : '常驻';
    let score = 0;
    if (ck === key) score = 100;
    else if (ck.startsWith(key)) score = 80;
    else if (ck.includes(key)) score = 60;
    else if (label && label.includes(lower)) score = 55;   // 按分组名搜（剿灭/常用/当期活动…）
    else if (groupName && groupName.includes(lower)) score = 50;
    else if (stateTxt.includes(raw)) score = 50;           // 开放状态（开放中/往期/常驻）
    else if ((l.drops || []).some((d) => String(d).toLowerCase().includes(lower))) score = 40;
    else if (String(l.stageId || '').toLowerCase().includes(lower)) score = 20;
    if (score) scored.push({ score, l });
  }
  scored.sort((a, b) => b.score - a.score || byGroup(a.l, b.l));
  return scored.slice(0, 30).map((x) => x.l);
}

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
  $('#maaPanelStatus').textContent = `已载入 ${r.tasks.length} 个任务 · 当前编辑：${r.current}${r.bound ? '（这一天专属）' : '（共享配置，改动会影响到所有未单独配置的日子）'}`;
  const sel = $('#maaCfgSelect');
  sel.innerHTML = '';
  (r.configs || []).forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = r.current;
  // 每次打开面板都让主进程核对 MAA 资源指纹（MAA 更新过就自动同步关卡数据）
  await ensureMaaLevels(false, true);
  renderMaaTaskList(r.tasks);
}

function maaFieldHtml(t, f) {
  const key = esc(f.key);
  if (f.widget === 'levels') {
    const picked = String(f.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const ph = maaLevels.length
      ? '输入关卡代号、分组名（如“剿灭”“常用”）或掉落物名，回车确认'
      : `关卡数据未载入${maaLevelsError ? '：' + maaLevelsError : ''}`;
    return `<div class="maa-f maa-f-wide">
      <span>${esc(f.label)}</span>
      <div class="maa-levels" data-key="${key}" data-type="list" data-levels="${esc(picked.join(','))}">
        <div class="ml-groups"></div>
        <div class="ml-chips"></div>
        <input type="text" class="ml-input" placeholder="${esc(ph)}" />
        <div class="ml-suggest" hidden></div>
      </div>
    </div>`;
  }
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
    bindLevelsWidget(card);
    box.appendChild(card);
  });
}

// 关卡选择控件：输入即搜索、回车自动修正、已选关卡按顺序执行
function bindLevelsWidget(scope) {
  scope.querySelectorAll('.maa-levels').forEach((box) => {
    const input = box.querySelector('.ml-input');
    const sug = box.querySelector('.ml-suggest');
    const chips = box.querySelector('.ml-chips');
    const getList = () => (box.dataset.levels || '').split(',').map((s) => s.trim()).filter(Boolean);
    const hideSuggest = () => { sug.hidden = true; sug.innerHTML = ''; };

    function renderChips() {
      const list = getList();
      chips.innerHTML = list.length
        ? list.map((c, i) => {
          const info = maaLevels.find((l) => l.code === c);
          const stateTxt = info ? (info.openState === 'open' ? '开放中' : info.openState === 'past' ? '往期' : '常驻') : '';
          const tip = `第 ${i + 1} 个执行${info && info.groupLabel ? ' · ' + info.groupLabel : ''}${stateTxt ? ' · ' + stateTxt : ''}${info && info.apCost ? ' · ' + info.apCost + ' 理智' : ''}`;
          return `<span class="ml-chip" title="${esc(tip)}">${esc(c)}<b data-i="${i}">✕</b></span>`;
        }).join('')
        : '<span class="ml-empty">还没有选择关卡</span>';
      chips.querySelectorAll('.ml-chip b').forEach((b) => {
        b.addEventListener('click', () => {
          const arr = getList();
          arr.splice(Number(b.dataset.i), 1);
          box.dataset.levels = arr.join(',');
          renderChips();
        });
      });
    }

    function add(code) {
      const arr = getList();
      if (!arr.includes(code)) arr.push(code);
      box.dataset.levels = arr.join(',');
      renderChips();
      input.value = '';
      hideSuggest();
    }

    function showSuggest(keyword) {
      if (!maaLevels.length) { hideSuggest(); return; }
      const hits = searchLevelsLocal(keyword);
      if (!hits.length) {
        sug.hidden = false;
        sug.innerHTML = '<div class="ml-item muted">没有匹配的关卡</div>';
        return;
      }
      sug.hidden = false;
      const groupHint = '<div class="ml-hint">可直接输入分组名搜索（如「剿灭」「常用」「当期活动」「往期」），或点上方分组按钮筛选</div>';
      sug.innerHTML = groupHint + hits.map((l) => `<div class="ml-item" data-code="${esc(l.code)}">
          <b>${esc(l.code)}</b>
          ${l.groupLabel ? `<span class="ml-group g-${esc(l.group || 'other')}">${esc(l.groupLabel)}</span>` : ''}
          ${openStateHtml(l)}
          <span class="ml-meta">${l.apCost ? l.apCost + ' 理智' : ''}${(l.drops || []).length ? ' · ' + esc((l.drops || []).slice(0, 3).join(' / ')) : ''}</span>
        </div>`).join('');
      sug.querySelectorAll('.ml-item[data-code]').forEach((it) => {
        it.addEventListener('mousedown', (e) => { e.preventDefault(); add(it.dataset.code); });
      });
    }

    const groupBox = box.querySelector('.ml-groups');
    if (groupBox) {
      const labels = [];
      const seen = new Set();
      for (const l of maaLevels) {
        if (l.groupLabel && !seen.has(l.groupLabel)) { seen.add(l.groupLabel); labels.push(l.groupLabel); }
      }
      groupBox.innerHTML = ['全部', ...labels]
        .map((t) => `<span class="ml-groupbtn" data-g="${esc(t)}">${esc(t)}</span>`).join('');
      groupBox.querySelectorAll('.ml-groupbtn').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const t = btn.dataset.g;
          if (t === '全部') {
            input.value = '';
            showSuggest('');
          } else {
            input.value = t;
            showSuggest(t);
          }
        });
      });
    }

    input.addEventListener('input', () => showSuggest(input.value));
    input.addEventListener('focus', () => showSuggest(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        const fixed = normalizeStageCodeLocal(v);
        if (fixed) {
          add(fixed);
          if (fixed.toUpperCase().replace(/[\s\-_]/g, '') !== v.toUpperCase().replace(/[\s\-_]/g, '') && window.eve && window.eve.toast) {
            window.eve.toast(`已修正为关卡「${fixed}」`);
          }
        } else {
          showSuggest(v);
        }
      } else if (e.key === 'Escape') {
        hideSuggest();
      }
    });
    input.addEventListener('blur', () => setTimeout(hideSuggest, 200));
    renderChips();
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
      if (el.classList.contains('maa-levels')) {
        patch.fields[el.dataset.key] = (el.dataset.levels || '').split(',').map((s) => s.trim()).filter(Boolean);
        return;
      }
      patch.fields[el.dataset.key] = el.dataset.type === 'bool' ? el.checked : el.value;
    });
    updates.push({ index: Number(card.dataset.index), patch });
  });
  return updates;
}

$('#btnMaaPanelSave').addEventListener('click', async () => {
  const msg = $('#maaPanelMsg');
  if (!maaPanelData) { msg.textContent = '没有可保存的数据'; return; }
  const updates = collectMaaUpdates(); // 先收集用户改动（后面可能重载面板）
  let targetConfig = maaPanelData.current;

  // 未绑定独立配置时提醒：保存会改到共享配置，影响其它日子
  if (maaPanelDate && !$('#maaBindDate').checked) {
    const ok = confirm(
      `当前编辑的是共享配置「${maaPanelData.current}」，保存会影响到所有未单独配置的日子。\n\n是否先为 ${maaPanelDate} 创建一套专属配置，再保存改动？`,
    );
    if (ok) {
      const typed = $('#maaNewCfgName').value.trim();
      const name = typed || suggestMaaConfigName(maaPanelDate, maaPanelData.configs || []);
      const cr = await window.api.maaConfigCreate(name, maaPanelData.current);
      if (!cr || !cr.ok) {
        msg.textContent = '创建专属配置失败：' + ((cr && cr.error) || '未知错误');
        return;
      }
      await window.api.maaSetDateConfig(maaPanelDate, cr.name);
      targetConfig = cr.name;
      $('#maaNewCfgName').value = '';
    }
  }

  const btn = $('#btnMaaPanelSave');
  btn.disabled = true;
  msg.textContent = '保存中…';
  try {
    const r = await window.api.maaConfigUpdateTasks(updates, targetConfig);
    if (r && r.ok) {
      msg.textContent = `已保存 ${r.changed} 个任务到配置「${r.config}」`;
      await loadMaaPanel();
    } else {
      msg.textContent = '保存失败：' + ((r && r.error) || '未知错误');
    }
  } finally {
    btn.disabled = false;
  }
});
$('#btnMaaPanelReload').addEventListener('click', () => loadMaaPanel());
$('#btnMaaSyncLevels').addEventListener('click', async () => {
  const btn = $('#btnMaaSyncLevels');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '同步中…';
  try {
    const ok = await ensureMaaLevels(true);
    if (ok) {
      renderMaaTaskList((maaPanelData && maaPanelData.tasks) || []);
      $('#maaPanelMsg').textContent = `已重新读取 MAA 关卡数据：${maaLevels.length} 个关卡`;
    } else {
      $('#maaPanelMsg').textContent = '同步失败：' + (maaLevelsError || '未知错误');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});
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

// 为这一天创建专属配置（复制当前配置）并绑定
$('#btnMaaCreateForDate').addEventListener('click', async () => {
  if (!maaPanelData) { alert('请先成功载入 MAA 配置'); return; }
  if (!maaPanelDate) { alert('请先在日历里选择一天'); return; }
  const typed = $('#maaNewCfgName').value.trim();
  const name = typed || suggestMaaConfigName(maaPanelDate, maaPanelData.configs || []);
  const r = await window.api.maaConfigCreate(name, maaPanelData.current);
  if (!r || !r.ok) { alert('创建失败：' + ((r && r.error) || '未知错误')); return; }
  await window.api.maaSetDateConfig(maaPanelDate, r.name);
  $('#maaNewCfgName').value = '';
  await loadMaaPanel();
  $('#maaPanelMsg').textContent = `已为 ${maaPanelDate} 创建专属配置「${r.name}」，之后的修改只影响这一天`;
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

// ---------- 赞助页面 ----------
$('#btnSponsor').addEventListener('click', () => {
  $('#sponsorModal').hidden = false;
});
$('#sponsorImg').addEventListener('click', () => {
  showLightbox($('#sponsorImg').src); // 复用大图查看
});
$('#btnSponsorStar').addEventListener('click', async () => {
  const repo = (prefs.update && prefs.update.repo) || '';
  if (!repo) {
    alert('还没有配置 GitHub 仓库。\n可在「⚙ 设置 → 应用更新」里填写仓库地址（用户名/仓库名），之后这里就能直接打开仓库页面。');
    return;
  }
  const r = await window.api.openExternal(`https://github.com/${repo}`);
  if (!r || !r.ok) alert('打开失败：' + ((r && r.error) || '未知错误'));
});

// ---------- 自动搜索电脑上的 MAA ----------
async function detectMaa(scope) {
  const btn = scope === 'global' ? $('#btnMaaAutoDetectGlobal') : $('#btnMaaAutoDetect');
  const box = scope === 'global' ? $('#maaDetectResultsGlobal') : $('#maaDetectResults');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '搜索中…';
  if (box) { box.hidden = true; box.innerHTML = ''; }
  try {
    const r = await window.api.maaAutoDetect();
    if (!r || !r.ok) { alert('搜索失败：' + ((r && r.error) || '未知错误')); return; }
    if (!r.count) {
      alert('没有在电脑上找到 MAA.exe。\n可以点「手动选择…」指定路径，或先运行一次 MAA 再搜索。');
      return;
    }
    renderDetectResults(r.results, box);
    if (r.count === 1) await applyMaaCandidate(r.results[0]);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function renderDetectResults(list, box) {
  if (!box) return;
  box.innerHTML = `<div class="hint" style="margin-bottom:4px">找到 ${list.length} 个 MAA，点「使用」即可设为当前 MAA：</div>`
    + list.map((c, i) => `<div class="detect-item">
        <div class="detect-meta"><b>${esc(c.version || 'MAA')}</b>
          <span class="detect-path" title="${esc(c.exePath)}">${esc(c.exePath)}</span></div>
        <button type="button" class="primary-btn small" data-i="${i}">使用</button>
      </div>`).join('');
  box.hidden = false;
  box.querySelectorAll('button[data-i]').forEach((b) => {
    b.addEventListener('click', () => applyMaaCandidate(list[Number(b.dataset.i)]));
  });
}

async function applyMaaCandidate(c) {
  if (!c) return;
  await window.api.maaSetPrefs({ exePath: c.exePath, workDir: c.dir });
  await updateMaaUI();
  for (const id of ['#maaDetectResults', '#maaDetectResultsGlobal']) {
    const box = $(id);
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }
  await renderMaaGlobal();
  if (window.eve && window.eve.toast) {
    window.eve.toast(`已设置 MAA：${c.exePath}${c.version ? '（' + c.version + '）' : ''}`, 4000);
  }
}

$('#btnMaaAutoDetect').addEventListener('click', () => detectMaa('settings'));
$('#btnMaaAutoDetectGlobal').addEventListener('click', () => detectMaa('global'));

// ---------- MAA 全局设置（每天定时自动启动） ----------
function maaGlobalStatusText(d) {
  const g = d.global || {};
  const boundDays = Object.keys(d.dateConfigs || {}).length;
  const last = g.lastRunDate ? `上次自动启动：${g.lastRunDate}` : '尚未自动启动过';
  return `MAA ${d.maaConfigured ? '已找到：' + (d.exePath || '') : '未配置路径（可点「自动搜索 MAA」）'} · 默认任务名「${d.autoStartTask}」 · ${d.skipIfRunning ? '已在运行则跳过' : '不跳过已运行'} · ${last}`
    + (boundDays ? ` · 已有 ${boundDays} 天绑定专属配置（优先级更高）` : '')
    + (d.configError ? ` · 配置读取：${d.configError}` : '');
}

// 只刷新状态文字：绝不碰输入框与下拉
// （改完设置若整体重渲染，会把用户正在操作的时间框/下拉重建掉，表现为"点不动、选不了"）
async function refreshMaaGlobalStatus() {
  let d = null;
  try { d = await window.api.maaGlobalGet(); } catch (e) { d = null; }
  if (!d || !d.ok) { $('#maaGlobalStatus').textContent = '读取失败'; return; }
  $('#maaGlobalStatus').textContent = maaGlobalStatusText(d);
}

// 完整渲染：只在打开弹窗时调用
async function renderMaaGlobal() {
  $('#maaGlobalMsg').textContent = '';
  let d = null;
  try { d = await window.api.maaGlobalGet(); } catch (e) { d = null; }
  if (!d || !d.ok) { $('#maaGlobalStatus').textContent = '读取失败'; return; }
  const g = d.global || {};
  $('#sMaaDaily').checked = !!g.dailyEnabled;
  $('#maaDailyTime').value = g.dailyTime || '08:00';
  const sel = $('#maaDailyConfig');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（不切换，使用 MAA 当前配置）';
  sel.appendChild(none);
  (d.configs || []).forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  if (g.configName && !(d.configs || []).includes(g.configName)) {
    const o = document.createElement('option');
    o.value = g.configName;
    o.textContent = g.configName + '（未找到）';
    sel.appendChild(o);
  }
  sel.value = g.configName || '';
  $('#maaGlobalStatus').textContent = maaGlobalStatusText(d);
  renderMaaWeekly(d);
}

// 每周计划表（按星期分别设定时间与配置）
const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function renderMaaWeekly(d) {
  const box = $('#maaWeekly');
  if (!box) return;
  const weekly = (d && d.weekly) || {};
  const configs = (d && d.configs) || [];
  box.innerHTML = WEEK_NAMES.map((name, i) => {
    const w = weekly[String(i)] || { enabled: false, time: '08:00', configName: '' };
    const opts = ['<option value="">（不切换配置）</option>']
      .concat(configs.map((c) => `<option value="${esc(c)}"${c === w.configName ? ' selected' : ''}>${esc(c)}</option>`))
      .concat((w.configName && !configs.includes(w.configName))
        ? [`<option value="${esc(w.configName)}" selected>${esc(w.configName)}（未找到）</option>`]
        : [])
      .join('');
    const dis = w.enabled ? '' : ' disabled';
    return `<div class="wk-row${w.enabled ? ' on' : ''}" data-day="${i}">
        <span class="wk-day">${name}</span>
        <label class="inline-check"><input type="checkbox" class="wk-en"${w.enabled ? ' checked' : ''} /></label>
        <input type="time" class="wk-time" value="${esc(w.time || '08:00')}"${dis} />
        <select class="wk-cfg"${dis}>${opts}</select>
      </div>`;
  }).join('');
}

// 只在打开弹窗时渲染；改动时仅保存 + 切换本行控件可用状态（不重建 DOM，避免打断操作）
$('#maaWeekly').addEventListener('change', async (e) => {
  const row = e.target.closest('.wk-row');
  if (row) {
    const en = row.querySelector('.wk-en').checked;
    row.classList.toggle('on', en);
    row.querySelector('.wk-time').disabled = !en;
    row.querySelector('.wk-cfg').disabled = !en;
  }
  const weekly = {};
  document.querySelectorAll('#maaWeekly .wk-row').forEach((r) => {
    if (r.querySelector('.wk-en').checked) {
      weekly[r.dataset.day] = {
        enabled: true,
        time: r.querySelector('.wk-time').value || '08:00',
        configName: r.querySelector('.wk-cfg').value || '',
      };
    }
  });
  await window.api.maaGlobalSet({ weekly });
  await refreshMaaGlobalStatus();
});

$('#btnMaaWidget').addEventListener('click', async () => {
  const r = await window.api.createMaaWidget({});
  if (!r || !r.ok) { alert('创建 MAA 监视小组件失败'); return; }
  $('#maaStatus').textContent = '已放到桌面（可拖动、可点 🎨 换配色）';
});
$('#btnMaaGlobal').addEventListener('click', async () => {
  $('#maaGlobalModal').hidden = false;
  await renderMaaGlobal();
});
$('#sMaaDaily').addEventListener('change', async (e) => {
  await window.api.maaGlobalSet({ dailyEnabled: e.target.checked });
  await refreshMaaGlobalStatus();
});
$('#maaDailyTime').addEventListener('change', async (e) => {
  await window.api.maaGlobalSet({ dailyTime: e.target.value || '08:00' });
  await refreshMaaGlobalStatus();
});
$('#maaDailyConfig').addEventListener('change', async (e) => {
  await window.api.maaGlobalSet({ configName: e.target.value });
  await refreshMaaGlobalStatus();
});
$('#btnMaaDailyStartNow').addEventListener('click', async () => {
  const r = await window.api.maaStartNow();
  $('#maaGlobalMsg').textContent = (!r || !r.ok)
    ? ('启动失败：' + ((r && r.error) || '未知错误'))
    : (r.skipped ? 'MAA 已在运行，已跳过' : `已启动 MAA（PID ${r.pid}）`);
  await refreshMaaGlobalStatus();
});
$('#btnMaaDailyCheck').addEventListener('click', async () => {
  const r = await window.api.maaDailyCheck();
  $('#maaGlobalMsg').textContent = (!r || r.ok === false)
    ? ('执行失败：' + ((r && r.error) || '未知错误'))
    : (r.skipped ? ('未启动：' + r.skipped) : (r.pid ? `已启动 MAA（PID ${r.pid}）` : '已执行检查'));
  await refreshMaaGlobalStatus();
});
$('#btnMaaGlobalOpenPanel').addEventListener('click', () => {
  $('#maaGlobalModal').hidden = true;
  openMaaPanel(selectedDate);
});

// ---------- 命令面板（Ctrl+K）与快捷键 ----------
let cmdItems = [];
let cmdIndex = 0;

function cmdClose() {
  $('#cmdModal').hidden = true;
  cmdItems = [];
  cmdIndex = 0;
}

function jumpToDate(dateStr, { openEditor } = {}) {
  const d = dateOf(dateStr);
  viewY = d.getFullYear();
  viewM = d.getMonth();
  selectedDate = dateStr;
  renderCalendar();
  renderDayPanel();
  if (openEditor) {
    const t = tasks.find((x) => x.date === dateStr);
    if (t) openTaskModal(t);
  }
}

// 极常用的三条日期规则走本地同步路径（零延迟），其余交给主进程的解析器
function cmdParseDateFast(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const now = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (/^(今天|今日)$/.test(s)) return fmt(now);
  if (/^(明天|明日)$/.test(s)) { const d = new Date(now); d.setDate(d.getDate() + 1); return fmt(d); }
  if (/^后天$/.test(s)) { const d = new Date(now); d.setDate(d.getDate() + 2); return fmt(d); }
  return null;
}

function cmdBuild(query, jumpDate) {
  const q = String(query || '').trim();
  const out = [];
  if (jumpDate) {
    out.push({ icon: '📅', label: `跳到 ${jumpDate}`, kind: '跳转', run: () => jumpToDate(jumpDate) });
  }
  if (q) {
    const hits = tasks.filter((t) => (t.title || '').toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    for (const t of hits) {
      out.push({
        icon: '🔔',
        label: `${t.date} ${t.time} ${t.title}`,
        kind: '任务',
        run: () => { jumpToDate(t.date, { openEditor: false }); openTaskModal(t); },
      });
    }
    out.push({ icon: '➕', label: `新建任务：${q}`, kind: '新建', run: () => cmdCreateTask(q) });
  }
  out.push({ icon: '⚙', label: '打开设置', kind: '命令', run: () => { $('#btnSettings').click(); } });
  out.push({ icon: '🎮', label: '打开 MAA 任务面板', kind: '命令', run: () => { $('#btnMaaGlobal').click(); } });
  out.push({ icon: '📅', label: '回到今天', kind: '命令', run: () => jumpToDate(fmtDate(new Date())) });
  out.push({ icon: '🗄', label: '立即备份数据', kind: '命令', run: async () => { const r = await window.api.createBackup(); alert(r && r.ok ? '已备份：' + r.name : '备份失败'); } });
  return out;
}

// 一句话建任务：优先用解析器，没有解析器时退化为"标题 + 当前时间"
async function cmdCreateTask(text) {
  let parsed = null;
  try { parsed = await window.api.parseQuickTask(text); } catch (e) { parsed = null; }
  if (parsed && parsed.ok) {
    openTaskModal(null);
    $('#fTitle').value = parsed.title || text;
    if (parsed.date) $('#fDate').value = parsed.date;
    if (parsed.time) $('#fTime').value = parsed.time;
    if (parsed.repeat) $('#fRepeat').value = parsed.repeat;
    if (Array.isArray(parsed.reminders) && parsed.reminders.length) {
      remindDraft = parsed.reminders.map((r, i) => ({
        id: 'r_q_' + i + '_' + Math.random().toString(36).slice(2, 5),
        offsetMinutes: Number(r.offsetMinutes) || 0,
        action: 'notify',
      }));
      renderReminders();
    }
  } else {
    openTaskModal(null);
    $('#fTitle').value = text;
  }
}

function cmdRender() {
  const list = $('#cmdList');
  if (!cmdItems.length) {
    list.innerHTML = '<div class="cmd-empty">没有匹配结果</div>';
    return;
  }
  list.innerHTML = cmdItems.map((it, i) => (
    `<div class="cmd-item${i === cmdIndex ? ' active' : ''}" data-i="${i}">
       <span>${it.icon}</span><span class="cmd-label">${esc(it.label)}</span><span class="cmd-kind">${esc(it.kind)}</span>
     </div>`
  )).join('');
  const active = list.querySelector('.cmd-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

async function cmdRun(i) {
  const it = cmdItems[i];
  cmdClose();
  if (it && typeof it.run === 'function') await it.run();
}

let cmdQueryToken = 0;
// 先本地极速渲染，再用主进程的中文解析器兜底（复用 src/nlp.js，不重复实现日期规则）
async function cmdRefresh(query) {
  const q = String(query || '').trim();
  const token = ++cmdQueryToken;
  const fast = cmdParseDateFast(q);
  cmdItems = cmdBuild(q, fast);
  cmdIndex = 0;
  cmdRender();
  if (!q || fast) return;
  let r = null;
  try { r = await window.api.parseDateExpr(q); } catch (e) { r = null; }
  if (token !== cmdQueryToken) return;   // 输入已变化，丢弃过期结果
  if (r && r.date) {
    cmdItems.unshift({ icon: '📅', label: `跳到 ${r.date}`, kind: '解析', run: () => jumpToDate(r.date) });
    cmdIndex = 0;
    cmdRender();
  }
}

function openCmdPalette(prefill) {
  $('#cmdModal').hidden = false;
  const input = $('#cmdInput');
  input.value = prefill || '';
  cmdRefresh(input.value);
  setTimeout(() => input.focus(), 30);
}

$('#cmdInput').addEventListener('input', (e) => cmdRefresh(e.target.value));
$('#cmdInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (cmdItems.length) { cmdIndex = (cmdIndex + 1) % cmdItems.length; cmdRender(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (cmdItems.length) { cmdIndex = (cmdIndex - 1 + cmdItems.length) % cmdItems.length; cmdRender(); } }
  else if (e.key === 'Enter') { e.preventDefault(); cmdRun(cmdIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); cmdClose(); }
});
$('#cmdList').addEventListener('click', (e) => {
  const it = e.target.closest('.cmd-item');
  if (it) cmdRun(Number(it.dataset.i));
});
$('#cmdModal').addEventListener('click', (e) => { if (e.target === $('#cmdModal')) cmdClose(); });

// 全局快捷键（在输入框里输入时不触发单键快捷键）
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '');
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if ($('#cmdModal').hidden) openCmdPalette(); else cmdClose();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); $('#btnSettings').click(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openTaskModal(null); return; }
    if (e.key === 'Escape') {
      const open = Array.from(document.querySelectorAll('.modal-mask')).find((m) => !m.hidden);
      if (open) { open.hidden = true; }
      return;
    }
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 't' || e.key === 'T') { jumpToDate(fmtDate(new Date())); }
    else if (e.key === 'ArrowLeft') { viewM -= 1; if (viewM < 0) { viewM = 11; viewY -= 1; } renderCalendar(); }
    else if (e.key === 'ArrowRight') { viewM += 1; if (viewM > 11) { viewM = 0; viewY += 1; } renderCalendar(); }
  });
}

// 免打扰时段 / 每日早报
function updateQuietUI() {
  const q = (prefs.quiet && typeof prefs.quiet === 'object') ? prefs.quiet : {};
  const mo = (prefs.morning && typeof prefs.morning === 'object') ? prefs.morning : {};
  $('#sQuiet').checked = !!q.enabled;
  $('#quietStart').value = q.start || '23:00';
  $('#quietEnd').value = q.end || '07:00';
  $('#quietHint').textContent = q.enabled ? '' : '（未启用）';
  $('#sMorning').checked = !!mo.enabled;
  $('#morningTime').value = mo.time || '08:00';
}
async function saveQuietPrefs() {
  prefs.quiet = {
    enabled: $('#sQuiet').checked,
    start: $('#quietStart').value || '23:00',
    end: $('#quietEnd').value || '07:00',
  };
  prefs.morning = {
    enabled: $('#sMorning').checked,
    time: $('#morningTime').value || '08:00',
  };
  await window.api.setPrefs({ quiet: prefs.quiet, morning: prefs.morning });
  $('#quietHint').textContent = $('#sQuiet').checked ? '' : '（未启用）';
}
$('#sQuiet').addEventListener('change', saveQuietPrefs);
$('#quietStart').addEventListener('change', saveQuietPrefs);
$('#quietEnd').addEventListener('change', saveQuietPrefs);
$('#sMorning').addEventListener('change', saveQuietPrefs);
$('#morningTime').addEventListener('change', saveQuietPrefs);

// ---------- 诊断信息 ----------
function diagFormat(d) {
  if (!d || !d.ok) return '诊断信息读取失败';
  const L = [];
  const kv = (k, v) => L.push(`${k}：${v}`);
  L.push('===== 开源日历 诊断信息 =====');
  L.push(`生成时间：${new Date().toLocaleString()}`);
  L.push('');
  L.push('【程序】');
  kv('版本', `v${d.app.version}（${d.app.packaged ? '安装版' : '开发模式'}）`);
  kv('运行时', `Electron ${d.app.electron} · Chrome ${d.app.chrome} · Node ${d.app.node}`);
  kv('系统', d.app.platform);
  kv('本次启动', `${d.app.startedAt}（已运行 ${d.app.uptimeMin} 分钟）`);
  L.push('');
  L.push('【数据】');
  kv('数据目录', d.paths.data);
  kv('备份目录', `${d.paths.backups}（${d.backup.count} 份，保留 ${d.backup.keep}）`);
  kv('最近备份', d.backup.latest);
  kv('插件目录', d.paths.plugins);
  kv('插件数量', d.plugins.count);
  kv('内容统计', `任务 ${d.counts.tasks} · 时间段 ${d.counts.segments} · 小组件 ${d.counts.widgets} · 贴纸图 ${d.counts.dayImages}`);
  for (const f of d.dataFiles) kv(`  ${f.name}`, `${(f.size / 1024).toFixed(1)} KB · ${f.mtime}`);
  L.push('');
  L.push('【本地接口】');
  kv('开关', d.api.enabled ? '已开启' : '已关闭');
  kv('端口', `${d.api.port}${d.api.listening ? '（监听中）' : '（未监听）'}`);
  kv('令牌', d.api.tokenSet ? '已设置' : '未设置');
  kv('webhook', d.api.webhook);
  L.push('');
  L.push('【应用更新】');
  kv('仓库', d.update.repo);
  kv('自动检查', d.update.autoCheck ? '开' : '关');
  kv('上次检查', d.update.lastCheck);
  kv('检查结果', d.update.lastResult);
  kv('忽略版本', d.update.ignored);
  L.push('');
  L.push('【MAA】');
  kv('可执行文件', d.maa.exePath);
  kv('已配置', d.maa.configured ? '是' : '否');
  kv('运行状态', d.maa.running ? `运行中${d.maa.runLabel ? '（' + d.maa.runLabel + '）' : ''}` : '未运行');
  kv('默认任务名', d.maa.autoStartTask);
  kv('每天设置', d.maa.dailyEnabled ? `开 · ${d.maa.dailyTime}` : '关');
  kv('每周计划', `${d.maa.weeklyPlans} 天单独设置`);
  kv('日期绑定', `${d.maa.dateBindings} 天`);
  L.push('');
  L.push('【提醒】');
  kv('免打扰', d.quiet.enabled ? `${d.quiet.start} → ${d.quiet.end}` : '未启用');
  kv('每日早报', d.morning.enabled ? `${d.morning.time} 发送` : '未启用');
  kv('插件异常', (window.__evePluginErrors && window.__evePluginErrors.length) ? JSON.stringify(window.__evePluginErrors) : '无');
  L.push('');
  L.push(`【最近日志（最多 40 条，共 ${d.errors.length} 条）】`);
  L.push(d.errors.length ? d.errors.join('\n') : '（无 warn / error）');
  return L.join('\n');
}

async function openDiag() {
  $('#diagModal').hidden = false;
  $('#diagText').textContent = '收集中…';
  $('#diagHint').textContent = '';
  let d = null;
  try { d = await window.api.diagCollect(); } catch (e) { d = null; }
  const text = diagFormat(d);
  $('#diagText').textContent = text;
  $('#diagHint').textContent = d && d.ok ? '排查问题时可直接「复制全部」' : '读取失败';
  return text;
}
$('#btnDiag').addEventListener('click', () => openDiag());
$('#btnDiagRefresh').addEventListener('click', () => openDiag());
$('#btnDiagCopy').addEventListener('click', async () => {
  const text = $('#diagText').textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    $('#diagHint').textContent = '已复制到剪贴板';
  } catch (e) {
    $('#diagHint').textContent = '复制失败，可手动全选复制';
  }
});
$('#btnDiagDir').addEventListener('click', () => window.api.openDataDir());

// ---------- 数据备份与恢复 ----------
async function updateBackupUI() {
  let d = null;
  try { d = await window.api.listBackups(); } catch (e) { d = null; }
  const st = $('#backupStatus');
  const sel = $('#backupList');
  if (!d || !d.ok) { st.textContent = '备份状态读取失败'; return; }
  const items = d.items || [];
  st.textContent = items.length
    ? `共 ${items.length} 份备份（最多保留 ${d.keep} 份）· 最近：${items[0].name.replace(/^backup-|\.json$/g, '')}`
      + `（${(items[0].size / 1024).toFixed(1)} KB）· 目录：${d.dir}`
    : `还没有备份 · 目录：${d.dir}（应用每天首次启动会自动备份一次）`;
  sel.innerHTML = items.length
    ? items.map((it) => {
      const label = it.name.replace(/^backup-/, '').replace(/\.json$/, '');
      const nice = label.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6');
      return `<option value="${it.name}">${nice} · ${(it.size / 1024).toFixed(1)} KB</option>`;
    }).join('')
    : '<option value="">（暂无备份）</option>';
}
$('#btnBackupNow').addEventListener('click', async () => {
  const btn = $('#btnBackupNow');
  btn.disabled = true;
  try {
    const r = await window.api.createBackup();
    if (r && r.ok) { $('#backupStatus').textContent = '已创建备份：' + r.name; await updateBackupUI(); }
    else alert('备份失败：' + ((r && r.error) || '未知错误'));
  } finally { btn.disabled = false; }
});
$('#btnBackupDir').addEventListener('click', () => window.api.openBackupDir());
$('#btnBackupDataDir').addEventListener('click', async () => {
  const r = await window.api.openDataDir();
  if (!r || !r.ok) alert('打开数据目录失败：' + ((r && r.error) || '未知错误'));
});
$('#btnBackupRestore').addEventListener('click', async () => {
  const name = $('#backupList').value;
  if (!name) { alert('还没有可恢复的备份'); return; }
  if (!confirm(`确定用这份备份覆盖当前数据吗？\n\n${name}\n\n恢复前会自动把当前数据再备份一份，所以可以反悔。`)) return;
  const r = await window.api.restoreBackup(name);
  if (!r || !r.ok) { alert('恢复失败：' + ((r && r.error) || '未知错误')); return; }
  alert(`已恢复（备份时间 ${r.at || '未知'}）：\n${(r.files || []).join('、')}\n\n界面已自动刷新。`);
  await updateBackupUI();
});
window.api.onDataReloaded(() => { refresh().catch(() => {}); });

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
  $('#updRepo').value = st.repo || '';
  $('#updRepo').readOnly = true; // 仓库地址由发行方锁定
  const last = st.lastCheck ? new Date(st.lastCheck).toLocaleString() : '从未';
  const r = st.lastResult;
  let txt = `当前版本 v${st.current} · 上次检查：${last}`;
  if (r && r.ok) txt += ` · 最新 v${r.latest}${r.hasUpdate ? '（有可用更新）' : '（已是最新）'}`;
  else if (r && r.error) txt += ` · 上次检查失败：${r.error}`;
  else if (!st.repo) txt += ' · 尚未配置仓库';
  $('#updStatus').textContent = txt;
  $('#btnUpdDownload').hidden = !(r && r.ok && r.hasUpdate);
  $('#btnUpdInstall').hidden = !st.downloaded;
  // 发布页按钮常显：即使检查失败（网络/证书问题），也能用浏览器手动下载安装包
  $('#btnUpdPage').hidden = false;
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
  alert('仓库地址已由发行方锁定，无法修改。');
});

// 旧的"填写仓库并立即检查"入口已随锁定取消，保留此处用于即时检查
async function checkUpdateNow() {
  const r = await window.api.checkUpdate();
  await updateUpdateUI();
  if (r && r.ok && r.hasUpdate) showUpdateToast(r);
  else if (r && r.ok) alert(`已是最新版本 v${r.latest}（当前 v${r.current}）`);
  else alert('检查更新失败：' + ((r && r.error) || '未知错误'));
}

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
// 插件异常集中记录（诊断面板会显示）
const pluginErrors = [];
window.__evePluginErrors = pluginErrors;
window.addEventListener('error', (e) => {
  try {
    const src = (e && (e.filename || '')) || '';
    // 只记插件脚本抛出的错误（应用自身脚本由控制台处理）
    if (src && !src.includes('/renderer/')) {
      pluginErrors.push({ id: 'runtime', name: src.split(/[\\/]/).pop(), error: e && e.message });
      window.__evePluginErrors = pluginErrors.slice();
    }
  } catch (err) { /* 忽略 */ }
});

async function loadPlugins() {
  let list = [];
  try { list = await window.api.listPlugins(); } catch (e) { console.error('读取插件失败', e); }
  for (const p of list) {
    if (!p.enabled || !p.rendererUrl) continue;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (err) {
          pluginErrors.push({ id: p.id, name: p.name, error: String(err) });
          window.__evePluginErrors = pluginErrors.slice();
          console.warn('[plugin] 加载异常：', p.id, err);
        }
        resolve();
      };
      // 5 秒超时：插件文件损坏 / 路径失效时不拖住应用启动
      const timer = setTimeout(() => finish('加载超时（5 秒）'), 5000);
      s.src = p.rendererUrl;
      s.onload = () => { clearTimeout(timer); finish(null); };
      s.onerror = () => { clearTimeout(timer); finish('脚本加载失败'); };
      document.head.appendChild(s);
    });
  }
  if (pluginErrors.length) console.warn(`[plugin] 共 ${pluginErrors.length} 个插件加载/运行异常`);
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
  if (calView === 'week') renderWeek(); else { renderCalendar(); bindCalEvents(); }
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
  initInfoTips();            // 选项旁的 ⓘ 说明浮层
  initInputFocusFallback();  // 输入框聚焦兜底
  initSettingsTabs();        // 设置面板的分类切换
  initShortcuts();           // 全局快捷键（Ctrl+K 命令面板等）
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
