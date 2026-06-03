@echo off
chcp 65001 >nul
setlocal
REM ============================================================
REM  启动 gateway（便携 node；首次自动安装依赖）
REM  前置：把便携 node 解压到  deploy\node-portable\
REM ============================================================

set "ROOT=%~dp0"
set "NODE=%ROOT%deploy\node-portable\node.exe"
set "NPM=%ROOT%deploy\node-portable\node_modules\npm\bin\npm-cli.js"

if not exist "%NODE%" ( echo [错误] 请把便携 node 解压到 %ROOT%deploy\node-portable\ & pause & exit /b 1 )

cd /d "%ROOT%gateway"

REM 首次启动自动装依赖（含 better-sqlite3 原生模块）
if not exist "node_modules" (
  echo [..] 首次启动，安装 gateway 依赖...
  "%NODE%" "%NPM%" install --omit=dev
  if errorlevel 1 ( echo [错误] 依赖安装失败 & pause & exit /b 1 )
)

REM ----- gateway 配置 -----
set "PORT=7777"
set "STORAGE_BACKEND=sqlite"
REM 如需 Redis，改 STORAGE_BACKEND=redis 并设 REDIS_HOST/REDIS_PORT

echo [OK] 启动 gateway（HTTP/WS :%PORT%，UDP 发现 :7778）...
"%NODE%" src\index.js
echo.
echo [警告] gateway 已退出
pause
