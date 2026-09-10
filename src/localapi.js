// ============================================================
// 本地 HTTP 联动接口 —— 路由匹配与鉴权（纯逻辑，可单测）
// 供其它软件（如 MAA、脚本、快捷指令）调用日历数据与控制 MAA
// ============================================================

// 路由表：method + path 模式 → 名称
const ROUTES = [
  { method: 'GET', pattern: /^\/api\/ping$/i, name: 'ping', auth: false },
  { method: 'GET', pattern: /^\/api\/tasks$/i, name: 'tasks.list' },
  { method: 'POST', pattern: /^\/api\/tasks$/i, name: 'tasks.create' },
  { method: 'GET', pattern: /^\/api\/tasks\/([^/]+)$/i, name: 'tasks.get' },
  { method: 'PUT', pattern: /^\/api\/tasks\/([^/]+)$/i, name: 'tasks.update' },
  { method: 'DELETE', pattern: /^\/api\/tasks\/([^/]+)$/i, name: 'tasks.delete' },
  { method: 'GET', pattern: /^\/api\/segments$/i, name: 'segments.list' },
  { method: 'POST', pattern: /^\/api\/segments$/i, name: 'segments.create' },
  { method: 'GET', pattern: /^\/api\/now$/i, name: 'now' },
  { method: 'POST', pattern: /^\/api\/maa\/start$/i, name: 'maa.start' },
  { method: 'POST', pattern: /^\/api\/maa\/stop$/i, name: 'maa.stop' },
  { method: 'GET', pattern: /^\/api\/maa\/status$/i, name: 'maa.status' },
  { method: 'POST', pattern: /^\/api\/webhook\/test$/i, name: 'webhook.test' },
];

// 匹配路由：返回 { name, params, auth } 或 null（404）
function matchRoute(method, pathname) {
  const m = String(method || 'GET').toUpperCase();
  let path = String(pathname || '/');
  const qIndex = path.indexOf('?');
  if (qIndex >= 0) path = path.slice(0, qIndex);
  for (const r of ROUTES) {
    if (r.method !== m) continue;
    const hit = r.pattern.exec(path);
    if (hit) {
      return { name: r.name, params: hit.slice(1).map(decodeURIComponent), auth: r.auth !== false };
    }
  }
  return null;
}

// 鉴权：未配置 token 时不校验；否则比对 header 或 query
function checkToken(provided, expected) {
  const exp = String(expected == null ? '' : expected);
  if (!exp) return true;
  return String(provided == null ? '' : provided) === exp;
}

// 从请求里取 token（header 优先，其次 query）
function extractToken(headers, query) {
  const h = headers || {};
  const direct = h['x-api-token'] || h['X-API-Token'];
  if (direct) return Array.isArray(direct) ? direct[0] : direct;
  const auth = h.authorization || h.Authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return String(auth).replace(/^Bearer\s+/i, '');
  return (query && query.token) || '';
}

// 简单 query 解析
function parseQuery(url) {
  const q = {};
  const idx = String(url || '').indexOf('?');
  if (idx < 0) return q;
  const s = String(url).slice(idx + 1);
  for (const part of s.split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v == null ? '' : v.replace(/\+/g, ' '));
  }
  return q;
}

module.exports = { ROUTES, matchRoute, checkToken, extractToken, parseQuery };
