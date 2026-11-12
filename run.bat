@echo off
rem ICS Calendar Viewer: with no argument, start the server if needed (or restart it after an update), then open the calendar.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\calendar.ps1" %*
if errorlevel 1 pause
