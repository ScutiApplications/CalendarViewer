@echo off
rem Run every local check: unit tests, ESLint, type check and Playwright end-to-end tests (uses the installed Edge).
rem Use it while GitHub Actions is unavailable.
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%" || exit /b 1

where pnpm >nul 2>nul || (
  echo pnpm 10 was not found on PATH. Install it with: winget install pnpm.pnpm
  echo Then open a new terminal and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing development tools...
  call pnpm install --frozen-lockfile || (echo Install failed. & pause & exit /b 1)
)

call pnpm run check
if errorlevel 1 (
  echo.
  echo CHECKS FAILED. Fix the problems above before pushing.
  pause
  exit /b 1
)
echo.
echo All checks passed.
pause
