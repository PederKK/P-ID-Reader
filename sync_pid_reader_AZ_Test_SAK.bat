@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Always run relative to this script's folder (fixes running from shortcuts/other CWD)
cd /d "%~dp0"

REM Default behavior: pause so the window doesn't instantly close when double-clicked.
REM Pass --nopause to disable (useful when calling from another script).
set "PAUSE_ON_EXIT=1"
if /I "%~1"=="--nopause" set "PAUSE_ON_EXIT=0"

REM --- Config ---
set "REPO_URL=https://github.com/PederKK/P-ID-Reader.git"
set "BRANCH=AZ_Test_SAK"
set "TARGET_DIR=P-ID-Reader"

echo.
echo === P-ID-Reader Sync (%BRANCH%) ===
echo Repo:   %REPO_URL%
echo Folder: %CD%\%TARGET_DIR%
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or not on PATH.
  echo Install Git for Windows: https://git-scm.com/download/win
  goto :error
)

if exist "%TARGET_DIR%\" (
  if not exist "%TARGET_DIR%\.git\" (
    echo ERROR: "%TARGET_DIR%" exists but is not a git repository.
    echo Rename/delete that folder or set TARGET_DIR in this script.
    goto :error
  )

  echo Updating existing repo...
  pushd "%TARGET_DIR%" >nul

  for /f "usebackq delims=" %%U in (`git remote get-url origin 2^>nul`) do set "ORIGIN_URL=%%U"
  if not defined ORIGIN_URL (
    echo ERROR: Could not read origin remote URL.
    popd >nul
    goto :error
  )

  echo Origin: !ORIGIN_URL!
  if /I not "!ORIGIN_URL!"=="%REPO_URL%" (
    echo WARNING: origin does not match expected URL.
    echo Expected: %REPO_URL%
    echo Found:    !ORIGIN_URL!
    echo.
  )

  git fetch origin
  if errorlevel 1 goto :error

  REM Ensure we are on the intended branch (create tracking branch if needed)
  git checkout "%BRANCH%" >nul 2>nul
  if errorlevel 1 (
    echo Local branch "%BRANCH%" not found. Creating tracking branch from origin...
    git checkout -b "%BRANCH%" "origin/%BRANCH%"
    if errorlevel 1 goto :error
  )

  REM Fast-forward only to avoid overwriting local changes
  git pull --ff-only origin "%BRANCH%"
  if errorlevel 1 (
    echo.
    echo ERROR: Pull failed (likely due to local commits/changes).
    echo Run: git status
    git status
    goto :error
  )

  popd >nul
  echo.
  echo Update complete.
  goto :success
) else (
  echo Cloning repo...
  git clone -b "%BRANCH%" "%REPO_URL%" "%TARGET_DIR%"
  if errorlevel 1 goto :error

  echo.
  echo Clone complete.
  goto :success
)

:success
echo.
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b 0

:error
echo.
echo FAILED.
if defined TARGET_DIR (
  if exist "%TARGET_DIR%\" (
    echo Folder: %CD%\%TARGET_DIR%
  )
)
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b 1
