@echo off
rem Local cloud dev: stage cloud/ off OneDrive, build web, wrangler dev.
rem Stage dir comes from MIHONBAN_STAGE or a temporary directory.
setlocal
set "SRC=%~dp0..\cloud"
if defined MIHONBAN_STAGE set "STAGE=%MIHONBAN_STAGE%"
if defined MIHONBAN_STAGE goto :have_stage
if not defined STAGE set "STAGE=%TEMP%\mihonban-cloud-build"
:have_stage
if defined MIHONBAN_STAGE set "STAGE=%MIHONBAN_STAGE%"

echo Staging to %STAGE%
robocopy "%SRC%\worker" "%STAGE%\worker" /e /xd node_modules /njh /njs /ndl /nc /ns >nul
if errorlevel 8 exit /b 1
robocopy "%SRC%\web" "%STAGE%\web" /e /xd node_modules dist /njh /njs /ndl /nc /ns >nul
if errorlevel 8 exit /b 1

pushd "%STAGE%\web"
if not exist node_modules call npm install --no-fund --no-audit || (popd & exit /b 1)
call npm run build || (popd & exit /b 1)
popd

pushd "%STAGE%\worker"
if not exist node_modules call npm install --no-fund --no-audit || (popd & exit /b 1)
if not exist .dev.vars powershell -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0make-cloud-secrets.ps1" -OutFile "%STAGE%\worker\.dev.vars" || (popd & exit /b 1)
call npx wrangler d1 execute DB --local --file schema.sql || (popd & exit /b 1)
echo.
echo dev server: http://127.0.0.1:8787  (password in .dev.vars APP_PASSWORD / ADMIN_PASSWORD)
call npx wrangler dev --ip 0.0.0.0 --port 8787
popd
