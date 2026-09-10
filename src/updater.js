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

module.exports = { normalizeVersion, compareVersions, pickWindowsAsset, parseRelease, shouldNotify };
