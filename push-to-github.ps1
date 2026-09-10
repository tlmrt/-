# 推送到 GitHub
# 用途：绕过本机的 git 镜像重写配置（url.*.insteadOf 会把 github.com 地址改写掉），直连 GitHub 推送。
# 用法：在本文件所在目录执行  powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1
# 需要：本机能访问 GitHub（必要时先设置代理），并且已登录过 GitHub 凭据（Git Credential Manager）。

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/tlmrt/-'

Set-Location -Path $PSScriptRoot

# 用空的全局配置启动 git，避免本机 url.*.insteadOf 镜像规则改写 GitHub 地址
$emptyConfig = Join-Path $env:TEMP 'empty-gitconfig'
if (-not (Test-Path $emptyConfig)) { New-Item -ItemType File -Path $emptyConfig | Out-Null }
$env:GIT_CONFIG_GLOBAL = $emptyConfig

Write-Host "== 当前分支 ==" -ForegroundColor Cyan
git branch --show-current

Write-Host "== 配置 remote ==" -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin $repoUrl
git remote -v

Write-Host "== 推送 master ==" -ForegroundColor Cyan
git push -u origin master

Write-Host "== 推送标签 ==" -ForegroundColor Cyan
git tag -l | ForEach-Object { git push origin $_ }

Write-Host "== 完成 ==" -ForegroundColor Green
Write-Host "之后到 https://github.com/tlmrt/-/releases/new 用页面创建 Release 并上传 release\ 下的安装包（tag 建议 v0.1.0）"
