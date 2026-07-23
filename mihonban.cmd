@echo off
rem Preferred mihonban entry point.
where python >nul 2>&1
if %ERRORLEVEL%==0 (
  python -m mihonban %*
  exit /b %ERRORLEVEL%
)
if defined MIHONBAN_CONFIG if exist "%MIHONBAN_CONFIG%" (
  for %%I in ("%MIHONBAN_CONFIG%") do set "MIHONBAN_DATA=%%~dpI"
)
if defined MIHONBAN_DATA if exist "%MIHONBAN_DATA%venv\Scripts\python.exe" (
  "%MIHONBAN_DATA%venv\Scripts\python.exe" -m mihonban %*
  exit /b %ERRORLEVEL%
)
echo mihonban: python not found. Install Python 3.11+ and: pip install -e ./pipeline
exit /b 1
