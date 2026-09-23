@echo off
cd /d "%~dp0"
start "Organiza+ Server" /min cmd /c "node scripts\serve.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"