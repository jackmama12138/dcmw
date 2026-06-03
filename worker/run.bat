@echo off
:: ==========================================================================================
:: Worker One-Click Startup Script (Windows Batch)
:: Function: Auto-Elevation -> Idempotent Start/Reload PM2 Worker Process
:: ==========================================================================================
title Starting dcmw-worker...

:: 1. Auto-detect and request Admin privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo [INFO] Requesting administrator privileges...
    goto UACPrompt
) else ( goto skipUAC )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c """"%~s0""""", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:skipUAC
    cd /d "%~dp0"

echo ==================================================
echo Managing Worker process via PM2...
echo ==================================================

:: Check if PM2 is already running this Worker to prevent duplicates
cmd /c pm2 describe dcmw-worker >nul 2>&1
if %errorlevel% eq 0 (
    echo [INFO] dcmw-worker detected in PM2 list. Performing a graceful reload...
    cmd /c pm2 reload dcmw-worker
) else (
    echo [INFO] Registering and starting new application 'dcmw-worker' in PM2...
    :: Note: If your entry point is not src/index.js, change the path below accordingly
    cmd /c pm2 start src/index.js --name "dcmw-worker"
)

echo.
echo ==================================================
echo Current Worker Status Dashboard
echo ==================================================
cmd /c pm2 list

echo.
echo ==================================================
echo  [SUCCESS] Worker is now safely running in the background!
echo ==================================================
timeout /t 5
exit