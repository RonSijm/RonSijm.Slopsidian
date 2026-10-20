@echo off
setlocal
pushd "%~dp0" || exit /b 1

if exist "node_modules\.bin\esbuild.cmd" goto :runtime
call npm.cmd ci --ignore-scripts --no-audit --no-fund
if not "%errorlevel%"=="0" goto :done

:runtime
call npm.cmd run setup:runtime
if not "%errorlevel%"=="0" goto :done
call npm.cmd run build
if not "%errorlevel%"=="0" goto :done
call npm.cmd start -- %*

:done
set "exitCode=%errorlevel%"
popd
exit /b %exitCode%
