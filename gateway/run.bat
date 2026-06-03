@echo off
:: ==========================================================================================
:: Project One-Click Startup Script (Windows Batch)
:: Function: Auto-Elevation -> Ensure Redis Active -> Idempotent PM2 Start/Reload
:: ==========================================================================================
title Starting dcmw-gateway...

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
    :: Ensure the working directory is the script folder
    cd /d "%~dp0"

echo ==================================================
echo [1/3] Checking background dependency (Redis)...
echo ==================================================
:: Check Redis service status, start it if not running
sc query Redis | findstr /i "RUNNING" >nul
if %errorlevel% neq 0 (
    echo [WARN] Redis service is not running. Attempting to start...
    net start Redis >nul 2>&1
    timeout /t 2 >nul
)
sc query Redis | findstr /i "RUNNING" >nul
if %errorlevel% eq 0 (
    echo [SUCCESS] Redis service is ready and running.
) else (
    echo [ERROR] Failed to start Redis service. Please check if Redis is installed!
)

echo.
echo ==================================================
echo [2/3] Managing gateway process via PM2...
echo ==================================================
:: Check if PM2 is already running this app to prevent duplicates
cmd /c pm2 describe dcmw-gateway >nul 2>&1
if %errorlevel% eq 0 (
    echo [INFO] dcmw-gateway detected in PM2 list. Performing a graceful reload...
    cmd /c pm2 reload dcmw-gateway
) else (
    echo [INFO] Registering and starting new application 'dcmw-gateway' in PM2...
    cmd /c pm2 start src/index.js --name "dcmw-gateway"
)

echo.
echo ==================================================
echo [3/3] Current PM2 Status Dashboard
echo ==================================================
cmd /c pm2 list

echo.
echo ==================================================
echo  [SUCCESS] Startup commands executed. Gateway is running in the background!
echo  Note: You can safely close this window; the app will keep running.
echo ==================================================
timeout /t 5
exit