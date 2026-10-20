@echo off
setlocal
pushd "%~dp0" || exit /b 1

if exist "node_modules\.bin\esbuild.cmd" goto :build
call npm.cmd ci --ignore-scripts --no-audit --no-fund
if not "%errorlevel%"=="0" goto :done

:build
call npm.cmd run build:web -- %*
if not "%errorlevel%"=="0" goto :done
call npm.cmd run start:web

:done
set "exitCode=%errorlevel%"
popd
exit /b %exitCode%
