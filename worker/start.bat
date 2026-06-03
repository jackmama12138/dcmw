@echo off
cd /d "%~dp0"
pm2 start ./src/index.js