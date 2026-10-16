@echo off
rem Stops the ATS Resume Analyzer if it's still running (only the Next.js server on port 3221).
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next.*start -p 3221' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; 'ATS Resume Analyzer stopped.' } else { 'ATS Resume Analyzer was not running.' }"
timeout /t 3 >nul
