@echo off
rem Release: raise the version when the changelog has Unreleased entries (tools\bump-version.js), run the checks, push, then wait for
rem the GitHub Actions release workflow to publish the ZIP and release, and publish the signed manifest. It asks before every push.
rem Usage: tools\release.bat [patch|minor|major] [--mandatory] [--skip-checks]   (default: patch)
rem Releases are always signed. The key defaults to %USERPROFILE%\Documents\calendarviewer-signing.pem; set CV_SIGNING_KEY to use
rem another file. The key stays outside the repository. Needs gh logged in to github.com, pnpm 10 and Node.
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%" || exit /b 1
if not defined CV_SIGNING_KEY set "CV_SIGNING_KEY=%USERPROFILE%\Documents\calendarviewer-signing.pem"
if not exist "%CV_SIGNING_KEY%" (
  echo Signing key not found: %CV_SIGNING_KEY%
  echo Set CV_SIGNING_KEY to the private key file, or restore it from your offline backup.
  pause
  exit /b 1
)
where gh >nul 2>nul || if not exist "%ProgramFiles%\GitHub CLI\gh.exe" (
  echo GitHub CLI was not found. Install it with: winget install GitHub.cli
  pause
  exit /b 1
)
node tools\release.js --key "%CV_SIGNING_KEY%" %*
if errorlevel 1 (
  echo.
  echo RELEASE STOPPED. Read the message above.
  pause
  exit /b 1
)
echo.
echo Release finished.
pause
