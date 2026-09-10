// 应用更新逻辑单测：node test/updater.test.js
const { normalizeVersion, compareVersions, pickWindowsAsset, parseRelease, shouldNotify } = require('../src/updater');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 版本解析与比较');
{
  ok('去掉 v 前缀', JSON.stringify(normalizeVersion('v1.2.3')) === '[1,2,3]');
  ok('忽略预发布后缀', JSON.stringify(normalizeVersion('1.2.3-beta.1')) === '[1,2,3]');
  ok('非法版本返回 null', normalizeVersion('abc') === null && normalizeVersion('') === null);
  ok('1.2.3 > 1.2.2', compareVersions('1.2.3', '1.2.2') === 1);
  ok('1.2.3 < 1.3.0', compareVersions('v1.2.3', '1.3.0') === -1);
  ok('相同版本（带前缀）相等', compareVersions('v1.0.0', '1.0.0') === 0);
  ok('10 > 9（按数字比较）', compareVersions('1.10.0', '1.9.9') === 1);
  ok('无法解析时视为相同', compareVersions('x', '1.0.0') === 0);
}

console.log('\n[2] 挑选 Windows 安装包');
{
  const assets = [
    { name: 'EveCalendar 0.1.0.exe', browser_download_url: 'u1', size: 100 },
    { name: 'EveCalendar Setup 0.1.0.exe', browser_download_url: 'u2', size: 200 },
    { name: 'app.dmg', browser_download_url: 'u3' },
    { name: 'latest.yml', browser_download_url: 'u4' },
  ];
  const a = pickWindowsAsset(assets);
  ok('优先选择 Setup 安装包', a && a.name === 'EveCalendar Setup 0.1.0.exe', JSON.stringify(a));
  const onlyPortable = pickWindowsAsset([{ name: 'EveCalendar 0.2.0.exe', browser_download_url: 'p' }]);
  ok('没有 Setup 时选便携版', onlyPortable && onlyPortable.name === 'EveCalendar 0.2.0.exe');
  ok('没有 exe 时返回 null', pickWindowsAsset([{ name: 'a.dmg' }]) === null);
  ok('空输入安全', pickWindowsAsset(null) === null);
}

console.log('\n[3] 解析 Release 与更新判断');
{
  const release = {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/me/evecal/releases/tag/v0.2.0',
    body: '新增：自定义语音',
    published_at: '2026-09-10T00:00:00Z',
    prerelease: false,
    assets: [{ name: 'EveCalendar Setup 0.2.0.exe', browser_download_url: 'https://dl/0.2.0.exe', size: 111 }],
  };
  const info = parseRelease(release, '0.1.0');
  ok('解析成功', info.ok === true);
  ok('最新版本去掉 v 前缀', info.latest === '0.2.0', info.latest);
  ok('判定有更新', info.hasUpdate === true);
  ok('带上下载地址与包名', info.downloadUrl === 'https://dl/0.2.0.exe' && info.assetName.includes('Setup'));
  ok('带上发布页与说明', info.pageUrl.includes('github.com') && info.notes.includes('自定义语音'));

  const same = parseRelease(release, '0.2.0');
  ok('版本相同不提示更新', same.hasUpdate === false && same.reason === '已是最新版本');

  const newer = parseRelease(release, '0.3.0');
  ok('本地版本更新时不提示', newer.hasUpdate === false);

  const noAsset = parseRelease({ tag_name: '0.2.0', assets: [] }, '0.1.0');
  ok('无安装包时仍判定有更新但提示原因', noAsset.hasUpdate === true && /安装包/.test(noAsset.reason || ''));

  ok('空 Release 安全失败', parseRelease(null, '0.1.0').ok === false);
  ok('无法识别版本号时失败', parseRelease({ tag_name: 'nightly' }, '0.1.0').ok === false);
}

console.log('\n[4] 是否提示（忽略某个版本）');
{
  const info = parseRelease({ tag_name: 'v0.2.0', assets: [{ name: 'x Setup.exe', browser_download_url: 'u' }] }, '0.1.0');
  ok('有更新时提示', shouldNotify(info, null) === true);
  ok('已忽略该版本则不提示', shouldNotify(info, '0.2.0') === false);
  ok('忽略的是旧版本仍提示', shouldNotify(info, '0.1.5') === true);
  ok('没有更新不提示', shouldNotify(parseRelease({ tag_name: 'v0.1.0', assets: [] }, '0.1.0'), null) === false);
}

console.log(`\n结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
