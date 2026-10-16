@echo off
rem Double-click to run the ATS Resume Analyzer locally (built-in engine, no API credits).
rem Close this window, or press Ctrl+C, to stop the app. "Stop ATS Analyzer.cmd" also stops it.
title ATS Resume Analyzer
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies, this takes a minute...
  call npm install || (pause & exit /b 1)
)

if not exist .next\BUILD_ID (
  echo Building the app...
  call npm run build || (pause & exit /b 1)
)

echo.
echo ATS Resume Analyzer is starting at http://localhost:3221
echo Leave this window open while you use it; close it to stop.
echo.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3221"
rem Run Next.js directly (not through npm.cmd): Ctrl+C then stops the server itself instead of
rem leaving it running behind a half-closed batch file, and the window closes afterwards.
node node_modules\next\dist\bin\next start -p 3221
exit
