@echo off
setlocal

set SCRIPT_DIR=%~dp0
set CLIENT_DIR=%SCRIPT_DIR%client
set PUBLIC_DIR=%SCRIPT_DIR%gateway\public

echo [1/3] Installing client dependencies...
cd /d "%CLIENT_DIR%"
call npm install
if errorlevel 1 goto :error

echo [2/3] Building client...
call npm run build
if errorlevel 1 goto :error

echo [3/3] Copying dist to gateway\public...
if not exist "%PUBLIC_DIR%" mkdir "%PUBLIC_DIR%"
del /q "%PUBLIC_DIR%\*" 2>nul
for /d %%i in ("%PUBLIC_DIR%\*") do rd /s /q "%%i" 2>nul
xcopy /e /y /q "%CLIENT_DIR%\dist\*" "%PUBLIC_DIR%\"
if errorlevel 1 goto :error

echo Done. Client deployed to gateway\public.
goto :end

:error
echo Build failed.
exit /b 1

:end
endlocal
