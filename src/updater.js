// ============================================================
// 应用更新：版本比较与 GitHub Release 解析 —— 纯逻辑，可单测
// ============================================================

// 归一化版本号：去掉 v 前缀、去掉预发布后缀（1.2.3-beta.1 → 1.2.3）
function normalizeVersion(v) {
  const s = String(v == null ? '' : v).trim().replace(/^v/i, '');
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// 比较版本：a>b 返回 1，a<b 返回 -1，相等 0（无法解析时返回 0，视为相同）
function compareVersions(a, b) {
  const A = normalizeVersion(a);
  const B = normalizeVersion(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) {
    if (A[i] > B[i]) return 1;
    if (A[i] < B[i]) return -1;
  }
  return 0;
}

// 从 GitHub Release JSON 里挑出 Windows 安装包（优先 Setup/安装包，其次便携版）
function pickWindowsAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const exe = list.filter((a) => a && typeof a.name === 'string' && /\.exe$/i.test(a.name));
  if (!exe.length) return null;
  const setup = exe.find((a) => /setup|install|安装/i.test(a.name));
  const portable = exe.find((a) => /portable|便携/i.test(a.name));
  const chosen = setup || portable || exe[0];
  return { name: chosen.name, url: chosen.browser_download_url || '', size: chosen.size || 0 };
}

// 解析 Release → 更新信息
function parseRelease(release, currentVersion) {
  if (!release || typeof release !== 'object') return { ok: false, error: '发布信息为空' };
  const tag = release.tag_name || release.name || '';
  const latest = normalizeVersion(tag) ? String(tag).replace(/^v/i, '') : '';
  if (!latest) return { ok: false, error: '无法识别版本号' };
  const asset = pickWindowsAsset(release.assets);
  const info = {
    ok: true,
    current: String(currentVersion || ''),
    latest,
    hasUpdate: compareVersions(latest, currentVersion) > 0,
    pageUrl: release.html_url || '',
    notes: typeof release.body === 'string' ? release.body.slice(0, 2000) : '',
    publishedAt: release.published_at || '',
    prerelease: !!release.prerelease,
    asset,
    downloadUrl: asset ? asset.url : '',
    assetName: asset ? asset.name : '',
  };
  if (!info.hasUpdate) info.reason = '已是最新版本';
  else if (!info.downloadUrl) info.reason = '该版本没有可下载的安装包（将打开发布页）';
  return info;
}

// 是否应该提示用户（可忽略某个版本）
function shouldNotify(info, ignoredVersion) {
  if (!info || !info.ok || !info.hasUpdate) return false;
  if (ignoredVersion && compareVersions(info.latest, ignoredVersion) === 0) return false;
  return true;
}

// ---------------- 网络错误翻译 ----------------
// 把底层错误（含 cause 链）压成一行文本
function errText(e) {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  const parts = [];
  try {
    if (e.message) parts.push(String(e.message));
    if (e.cause) parts.push(e.cause && e.cause.message ? String(e.cause.message) : String(e.cause));
    if (e.code) parts.push(String(e.code));
  } catch (_) { /* 忽略取值异常 */ }
  return parts.filter(Boolean).join(' | ') || String(e);
}

// 把网络错误翻成用户能看懂、能自己动手解决的中文提示。
// 背景：本机若装了 Steam++ / Watt Toolkit 之类的 HTTPS 加速器，会把 github.com 解析到 127.0.0.1
// 做中间人转发，此时「证书不被信任」和「代理没开导致连接被拒」是最常见的两种失败。
function describeNetError(e) {
  const raw = errText(e).trim().slice(0, 200);
  const s = raw.toLowerCase();
  const manualTip = '也可在「设置 → 应用更新」点「打开发布页」，用浏览器手动下载安装包。';
  if (/unable to verify|self[- ]signed|local issuer|err_tls|certificate|cert_|ssl|schannel/.test(s)) {
    return `HTTPS 证书校验失败：GitHub 流量正被本机代理/加速器（Steam++ / Watt Toolkit / Clash 等）转发，而它的根证书未被信任。请打开加速器的「网络加速」后重试，或关闭加速器让应用直连。${manualTip}（原始错误：${raw}）`;
  }
  if (/enotfound|eai_again|getaddrinfo|name resolution|no such host/.test(s)) {
    return `域名解析失败，找不到 GitHub 服务器：请检查网络或代理设置。${manualTip}（原始错误：${raw}）`;
  }
  if (/etimedout|timeout|econnrefused|econnreset|econnaborted|socket hang up|network|fetch failed|offline|enetunreach|ehostunreach|epipe/.test(s)) {
    return `无法连接 GitHub 服务器：网络不通，或代理/加速器没开启。请检查网络后重试。${manualTip}（原始错误：${raw}）`;
  }
  if (/404|not found|不存在/.test(s)) {
    return `仓库或 Release 不存在：请确认该 GitHub 仓库已发布 Release（tag 形如 v0.2.0）。${manualTip}（原始错误：${raw}）`;
  }
  if (/403|rate limit|forbidden|频率/.test(s)) {
    return `GitHub API 访问受限（可能触发了频率限制），稍后再试。${manualTip}（原始错误：${raw}）`;
  }
  return raw ? `检查更新失败：${raw} ${manualTip}` : '检查更新失败（未知错误）';
}

module.exports = {
  normalizeVersion,
  compareVersions,
  pickWindowsAsset,
  parseRelease,
  shouldNotify,
  errText,
  describeNetError,
};
