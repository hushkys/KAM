@echo off
rem KAM — spuštění dvojklikem na Windows. Přepínače: -Lan, -Refresh
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
