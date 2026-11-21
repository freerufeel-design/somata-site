@echo off
rem Somata: starts a local server (serve.ps1, uses the PowerShell built into Windows) and opens the browser.
rem Keep this window open while using Somata; close it to stop the server.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 pause
