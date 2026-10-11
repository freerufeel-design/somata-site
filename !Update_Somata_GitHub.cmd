@echo off
setlocal
cd /d C:\Docker\www

if errorlevel 1 (
  echo ERROR: Cannot open C:\Docker\www
  pause
  exit /b 1
)

git add -A

rem Check whether there is anything to commit
git diff --cached --quiet
if %errorlevel%==0 (
  echo.
  echo No changes to commit.
  echo.
  pause
  exit /b 0
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%I"

git commit -m "Update site %STAMP%"
if errorlevel 1 (
  echo.
  echo ERROR: Commit failed.
  echo.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo.
  echo ERROR: Push failed.
  echo.
  pause
  exit /b 1
)

echo.
echo SUCCESS: Site changes were committed and pushed to GitHub.
echo GitHub Pages will update automatically.
echo.
pause
