// ============================================================
// 桌面小组件渲染层
// 由主进程用 widget.html?wid=xxx 打开；显示某一天的任务与液体倒计时
// 支持每个小组件单独配色（🎨 面板）
// ============================================================
(function () {
  'use strict';

  const wid = new URLSearchParams(location.search).get('wid');
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let state = { date: null, tasks: [], segments: [], alwaysOnTop: false };
  let globalAccent = '#4f6bff';
  let palette = { bg: '#ffffff', fg: '#2b3245', accent: '' };

  // 预设配色（accent 留空表示跟随日历主题的强调色）
  const PRESETS = [
    { name: '经典白', bg: '#ffffff', fg: '#2b3245', accent: '' },
    { name: '玻璃', bg: 'rgba(255,255,255,0.72)', fg: '#2b3245', accent: '' },
    { name: '墨黑', bg: '#1f2430', fg: '#e8ebf5', accent: '#7d95ff' },
    { name: '深蓝', bg: '#16233a', fg: '#d8e4ff', accent: '#5b8cff' },
    { name: '青瓷', bg: '#eef4f7', fg: '#26363f', accent: '#2f8f9d' },
    { name: '抹茶', bg: '#eff7ec', fg: '#2f4a33', accent: '#3f8f5a' },
    { name: '樱花', bg: '#fdf0f5', fg: '#5a3543', accent: '#e0709a' },
    { name: '琥珀', bg: '#fff6e7', fg: '#5a4326', accent: '#d08b28' },
  ];

  function dateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${m}月${d}日 周${'日一二三四五六'[dt.getDay()]}`;
  }

  function at(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = String(timeStr).split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
  }

  function segRangeMs(seg) {
    const start = at(seg.date, seg.start);
    let end = at(seg.date, seg.end);
    if (end <= start) end += 24 * 60 * 60 * 1000; // 跨夜
    return { start, end };
  }

  function activeSeg(nowMs) {
    const now = nowMs || Date.now();
    for (const s of state.segments) {
      const { start, end } = segRangeMs(s);
      if (now >= start && now < end) {
        return { seg: s, ratio: end > start ? (end - now) / (end - start) : 0, remainMs: end - now };
      }
    }
    return null;
  }

  function fmtRemain(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(min / 60);
    return h > 0 ? `${h}小时${min % 60}分` : `${min}分钟`;
  }

  // ---------- 配色 ----------
  function toColorInput(v, fb) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? v : fb;
  }

  function applyPalette(p, save) {
    palette = {
      bg: (p && p.bg) || '#ffffff',
      fg: (p && p.fg) || '#2b3245',
      accent: (p && p.accent) || '',
    };
    const root = document.documentElement.style;
    root.setProperty('--wd-bg', palette.bg);
    root.setProperty('--wd-fg', palette.fg);
    root.setProperty('--accent', palette.accent || globalAccent);

    $('#wdCustBg').value = toColorInput(palette.bg, '#ffffff');
    $('#wdCustFg').value = toColorInput(palette.fg, '#2b3245');
    $('#wdCustAccent').value = toColorInput(palette.accent || globalAccent, globalAccent);

    document.querySelectorAll('.wd-swatch').forEach((el, i) => {
      const s = PRESETS[i];
      el.classList.toggle('sel', s.bg === palette.bg && s.fg === palette.fg && (s.accent || '') === (palette.accent || ''));
    });

    if (save) {
      window.api.widgetSetPalette(wid, palette).catch(() => {});
    }
  }

  function renderSwatches() {
    $('#wdSwatches').innerHTML = PRESETS.map((p, i) => `
      <button class="wd-swatch" data-i="${i}" title="${esc(p.name)}" style="background:${esc(p.bg)}">
        <i style="background:${esc(p.accent || globalAccent)}"></i>
      </button>`).join('');
  }

  function renderList() {
    const box = $('#wdList');
    if (!state.tasks.length) {
      box.innerHTML = '<div class="wd-empty">这一天没有任务<br>从日历拖出其他日期试试</div>';
    } else {
      box.innerHTML = state.tasks
        .map((t) => `<div class="wd-item ${esc(t.priority || '')}" title="${esc(t.note || '')}">
            <span class="wd-time">${esc(t.time)}</span>
            <span class="wd-title">${esc(t.title)}</span>
          </div>`)
        .join('');
    }

    const foot = $('#wdFoot');
    if (!state.segments.length) {
      foot.innerHTML = '';
    } else {
      const act = activeSeg();
      const seg = act ? act.seg : state.segments[0];
      foot.innerHTML = `<div class="wd-seg" style="--lc:${esc(seg.color)}"><i></i>${esc(seg.start)}-${esc(seg.end)}${seg.title ? ' ' + esc(seg.title) : ''}</div>
        <div>${act ? '剩余 ' + esc(fmtRemain(act.remainMs)) : '未开始/已结束'}</div>`;
    }
  }

  function updateLiquid() {
    const el = $('#wdLiquid');
    const act = activeSeg();
    if (!act) {
      el.hidden = true;
      return;
    }
    const pct = Math.max(0, Math.min(100, act.ratio * 100));
    el.hidden = false;
    el.style.setProperty('--lc', act.seg.color);
    el.style.height = pct.toFixed(1) + '%';
    $('#wdPct').textContent = Math.round(pct) + '%';
  }

  async function load() {
    try {
      const d = await window.api.widgetData(wid);
      if (!d) {
        $('#wdDate').textContent = '小组件已失效';
        $('#wdList').innerHTML = '<div class="wd-empty">这个小组件已被移除</div>';
        return;
      }
      state = d;
      $('#wdDate').textContent = dateLabel(d.date);
      $('#wdPin').classList.toggle('on', !!d.alwaysOnTop);
      if (d.palette) applyPalette(d.palette, false);
      renderList();
      updateLiquid();
    } catch (e) {
      console.error('小组件取数失败', e);
    }
  }

  // ---- 交互 ----
  $('#wdClose').addEventListener('click', () => { window.api.widgetClose(wid); });
  $('#wdPin').addEventListener('click', async () => {
    const r = await window.api.widgetToggleTop(wid);
    if (r && r.ok) $('#wdPin').classList.toggle('on', !!r.alwaysOnTop);
  });
  $('#wdHead').addEventListener('dblclick', () => { window.api.widgetFocusMain(wid); });

  // 配色面板
  $('#wdColor').addEventListener('click', () => {
    const box = $('#wdPalette');
    box.hidden = !box.hidden;
    if (!box.hidden) applyPalette(palette, false);
  });
  $('#wdPalClose').addEventListener('click', () => { $('#wdPalette').hidden = true; });
  $('#wdSwatches').addEventListener('click', (e) => {
    const b = e.target.closest('.wd-swatch');
    if (!b) return;
    const p = PRESETS[Number(b.dataset.i)];
    if (p) applyPalette(p, true);
  });
  $('#wdCustBg').addEventListener('input', (e) => applyPalette({ ...palette, bg: e.target.value }, true));
  $('#wdCustFg').addEventListener('input', (e) => applyPalette({ ...palette, fg: e.target.value }, true));
  $('#wdCustAccent').addEventListener('input', (e) => applyPalette({ ...palette, accent: e.target.value }, true));

  // ---- 刷新循环 ----
  window.api.onWidgetUpdate(() => load());
  setInterval(updateLiquid, 1000);      // 液面随时间下降
  setInterval(load, 5 * 60 * 1000);     // 兜底刷新

  (async function init() {
    try {
      const p = await window.api.getPrefs();
      globalAccent = (p && p.theme && p.theme.accent) || '#4f6bff';
      document.documentElement.style.setProperty('--accent', globalAccent);
    } catch (e) { /* noop */ }
    renderSwatches();
    applyPalette(palette, false);
    await load();
  })();
})();
