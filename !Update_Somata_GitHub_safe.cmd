@echo off
setlocal EnableExtensions EnableDelayedExpansion
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

for /f "usebackq delims=" %%B in (`git branch --show-current`) do set "BRANCH=%%B"
if /I not "!BRANCH!"=="main" (
  echo ERROR: Current branch is "!BRANCH!", expected "main".
  echo Switch to main first and run this script again.
  pause
  exit /b 1
)

rem Do not start a new update while an old rebase is unresolved.
git rev-parse -q --verify REBASE_HEAD >nul 2>&1
if not errorlevel 1 (
  echo ERROR: A Git rebase is already in progress.
  echo Resolve it first, then run this script again.
  echo Useful commands:
  echo   git status
  echo   git add .
  echo   git rebase --continue
  echo Or, to cancel that rebase:
  echo   git rebase --abort
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
set "DIFF_RC=!errorlevel!"

if "!DIFF_RC!"=="1" (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%I"

  git commit -m "Update site !STAMP!"
  if errorlevel 1 (
    echo.
    echo ERROR: Commit failed.
    pause
    exit /b 1
  )
) else if "!DIFF_RC!"=="0" (
  echo No local changes to commit.
) else (
  echo ERROR: Cannot inspect staged changes.
  pause
  exit /b 1
)

set /a ATTEMPT=1
set /a MAX_ATTEMPTS=4

:SYNC_RETRY
echo.
echo Syncing with GitHub... attempt !ATTEMPT!/!MAX_ATTEMPTS!

git fetch origin main
if errorlevel 1 goto :SYNC_ERROR

git rebase origin/main
if errorlevel 1 goto :REBASE_ERROR

echo.
echo Uploading to GitHub...
git push origin main
if not errorlevel 1 goto :SUCCESS

rem The most common reason here is that origin/main changed after fetch/rebase
rem but before GitHub accepted our push. Fetch, rebase, and try again.
if !ATTEMPT! GEQ !MAX_ATTEMPTS! goto :PUSH_ERROR

set /a ATTEMPT+=1
echo.
echo NOTICE: Push was rejected or interrupted.
echo The remote main may have changed during upload.
echo Fetching the newest main, rebasing, and retrying...
timeout /t 2 /nobreak >nul
goto :SYNC_RETRY

:REBASE_ERROR
echo.
echo ERROR: Rebase stopped, most likely because of a conflict.
echo Nothing has been force-pushed and remote commits are safe.
echo.
echo Run:
echo   git status
echo.
echo Resolve the reported files, then run:
echo   git add .
echo   git rebase --continue
echo.
echo If you want to cancel the rebase instead:
echo   git rebase --abort
echo.
echo Do NOT use git push --force.
pause
exit /b 1

:SYNC_ERROR
echo.
echo ERROR: Could not fetch from GitHub.
echo Check the network, GitHub authentication, and remote URL.
echo.
git remote -v
pause
exit /b 1

:PUSH_ERROR
echo.
echo ERROR: Push failed after !MAX_ATTEMPTS! attempts.
echo No force push was used.
echo.
echo Current Git status:
git status --short --branch
echo.
echo Remote state:
git log --oneline --decorate --max-count=8 --all
pause
exit /b 1

:SUCCESS
echo.
echo SUCCESS: GitHub is up to date.
echo GitHub Pages will update automatically.
echo.
pause
exit /b 0
