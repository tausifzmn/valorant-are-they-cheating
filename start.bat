@echo off
cd /d "%~dp0"
echo Checking for node_modules...
if not exist node_modules ( echo Installing dependencies... && call npm install )
echo.
echo Starting Are They Cheating? on http://localhost:3000
echo (Open that URL in your browser. For live data, set HENRIK_API_KEY in .env first.)
echo.
call npm start
pause
