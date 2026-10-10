@echo off
echo Starting IPTV Player...
echo.
echo Choose an option:
echo 1. Development server (npm run dev)
echo 2. Preview production build (npm run preview)
echo 3. Build for production (npm run build)
echo.
set /p choice="Enter choice [1-3]: "

if "%choice%"=="1" (
    echo Starting development server...
    npm run dev
) else if "%choice%"=="2" (
    echo Starting preview server...
    npm run preview
) else if "%choice%"=="3" (
    echo Building for production...
    npm run build
) else (
    echo Invalid choice. Starting development server by default...
    npm run dev
)

pause