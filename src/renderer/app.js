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
let prefs = { weekStart: 1, notifySound: true };
let viewY = new Date().getFullYear();
let viewM = new Date().getMonth();
let selectedDate = fmtDate(new Date());
let remindDraft = []; // 当前编辑任务草稿中的提醒 [{id, offsetMinutes}]

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

// ---------- 渲染月历 ----------
function renderCalendar() {
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

    html += `<div class="day-cell ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-date="${ds}">
      <div class="day-num">${d.getDate()}</div>
      ${dayImgUrls[ds] ? `<img class="cell-img" src="${dayImgUrls[ds]}" alt="" />` : ''}
      ${cellTasks ? `<div class="cell-tasks">${cellTasks}</div>` : ''}
    </div>`;
  }
  $('#calGrid').innerHTML = html;

  // 标题（"YYYY年 M月"）
  $('#monthTitle').textContent = `${viewY}年 ${viewM + 1}月`;
}

// 绑定月历格子点击：用事件委托一次性绑定，DOM 重建也不会失效
let calEventsBound = false;
function bindCalEvents() {
  if (calEventsBound) return;
  calEventsBound = true;
  document.addEventListener('click', (e) => {
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
  $('#dayTitle').innerHTML = `${selectedDate} <span style="color:#9aa1b0;font-size:13px;font-weight:500">周${wd}</span>`;

  const list = tasksOn(selectedDate);
  const box = $('#dayTasks');
  if (!list.length) {
    $('#emptyTip').style.display = 'block';
    box.querySelectorAll('.task-card').forEach((n) => n.remove());
    return;
  }
  $('#emptyTip').style.display = 'none';
  box.querySelectorAll('.task-card').forEach((n) => n.remove());

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
        <div class="tc-tags">${tagHtml}</div>
        <div class="tc-actions">
          <button class="mini-btn" data-act="edit" title="编辑">✎</button>
          <button class="mini-btn del" data-act="del" title="删除">🗑</button>
        </div>
      </div>`;
    box.appendChild(el);
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
  $('#taskModal').hidden = false;
}

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
function askDelete(task) {
  deleteTarget = task;
  $('#confirmText').textContent = `删除任务「${task.title}」？重复任务将同时删除其后续安排。`;
  $('#confirmWrap').hidden = false;
}
$('#confirmNo').addEventListener('click', () => { $('#confirmWrap').hidden = true; deleteTarget = null; });
$('#confirmYes').addEventListener('click', async () => {
  if (deleteTarget) {
    await window.api.deleteTask(deleteTarget.id);
    window.eveBus.emit('eve:task-deleted', deleteTarget.id);
    await refresh();
  }
  $('#confirmWrap').hidden = true;
  deleteTarget = null;
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
  await loadPlugins(); // 加载启用的渲染层插件（此时 eveBus 与 window.api 均已就绪）
  window.eveBus.__ready = true;
  window.eveBus.emit('eve:ready');
})();
