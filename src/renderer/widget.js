// ============================================================
// 桌面小组件渲染层
// 由主进程用 widget.html?wid=xxx 打开；显示某一天的任务与液体倒计时
// ============================================================
(function () {
  'use strict';

  const wid = new URLSearchParams(location.search).get('wid');
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let state = { date: null, tasks: [], segments: [], alwaysOnTop: false };

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

  // ---- 刷新循环 ----
  window.api.onWidgetUpdate(() => load());
  setInterval(updateLiquid, 1000);      // 液面随时间下降
  setInterval(load, 5 * 60 * 1000);     // 兜底刷新

  (async function init() {
    try {
      const p = await window.api.getPrefs();
      const accent = (p && p.theme && p.theme.accent) || '#4f6bff';
      document.documentElement.style.setProperty('--accent', accent);
    } catch (e) { /* noop */ }
    await load();
  })();
})();
