@echo off
:: ==========================================================================================
:: Worker One-Click Stop Script (Windows Batch)
:: Function: Auto-Elevation -> Safely Stop and Delete PM2 Worker Process
:: ==========================================================================================
title Stopping dcmw-worker...

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
echo Stopping and removing Worker background process...
echo ==================================================

cmd /c pm2 describe dcmw-worker >nul 2>&1
if %errorlevel% eq 0 (
    cmd /c pm2 delete dcmw-worker
    echo [SUCCESS] dcmw-worker has been safely stopped and removed from PM2.
) else (
    echo [WARN] dcmw-worker not found in PM2 list.
)

echo.
echo ==================================================
echo Current PM2 Status Dashboard
echo ==================================================
cmd /c pm2 list

echo.
echo ==================================================
echo  [SUCCESS] Stop process completed!
echo ==================================================
timeout /t 3
exit