@echo off
setlocal EnableExtensions
cd /d C:\Docker\www

if errorlevel 1 (
  echo ERROR: Cannot open C:\Docker\www
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: C:\Docker\www is not a Git repository.
  pause
  exit /b 1
)

echo.
echo === Somata GitHub update ===
echo.

git add -A
if errorlevel 1 (
  echo ERROR: git add failed.
  pause
  exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%I"

  git commit -m "Update site %STAMP%"
  if errorlevel 1 (
    echo.
    echo ERROR: Commit failed.
    pause
    exit /b 1
  )
) else (
  echo No local changes to commit.
)

echo.
echo Syncing with GitHub...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo ERROR: GitHub sync failed.
  echo If Git reports a conflict, do not delete anything - send me the text from this window.
  pause
  exit /b 1
)

echo.
echo Uploading to GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo ERROR: Push failed.
  pause
  exit /b 1
)

echo.
echo SUCCESS: GitHub is up to date.
echo GitHub Pages will update automatically.
echo.
pause
