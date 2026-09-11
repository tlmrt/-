// 打包后裁剪：去掉本应用用不到的 Chromium 组件，减小安装包体积
// 保留清单（有明确用途，不要删）：
//   ffmpeg.dll        视频/音频解码（背景视频、自定义提醒语音都要它）
//   vk_swiftshader.dll 无显卡 / 远程桌面时的软件渲染后备
//   d3dcompiler_47.dll 老显卡的 D3D 着色器编译
//   LICENSES.chromium.html Chromium 许可声明（合规要求）
const fs = require('fs');
const path = require('path');

const REMOVE = [
  // DirectX Shader Compiler：只有 WebGPU/Dawn 才用到，本应用不用；
  // 实测删除后应用启动、渲染、视频背景均正常。约 24.6MB。
  'dxcompiler.dll',
  // electron-builder 生成的自动更新配置：本项目用内置的 GitHub 更新器，不需要它
  path.join('resources', 'app-update.yml'),
];

exports.default = async function afterPack(context) {
  const dir = context.appOutDir;
  for (const rel of REMOVE) {
    const full = path.join(dir, rel);
    try {
      if (fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
        console.log(`  • 已裁剪 ${rel}`);
      }
    } catch (e) {
      console.warn(`  • 裁剪 ${rel} 失败：${e.message}`);
    }
  }
};
