@echo off
:: ==========================================================================================
:: Automated Environment Deployment Bootstrapper (Windows Batch)
:: Function: Auto Admin Elevation -> Bypass Policy -> Silently Invoke Backend PowerShell Script
:: ==========================================================================================
title Preparing environment deployment...

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
    :: Change directory back to the script folder to prevent UAC from resetting it to System32
    cd /d "%~dp0"

:: 2. Fully automated invocation of the companion PowerShell script
echo [INFO] Privileges secured. Launching core PowerShell script...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\init_env.ps1"

echo.
echo ==================================================
echo  Deployment process initiated. Press any key to exit.
echo ==================================================
pause>nul