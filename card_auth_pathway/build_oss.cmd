@echo off
cd /d "%~dp0"

echo [1/2] Building card_auth PATHWAY server (OSS/GCC simulation mode)...
gcc -Wall -Wextra -std=c99 -I. -o card_auth_server.exe ^
    card_auth.c ^
    pathway_main.c ^
    pathway_req.c ^
    pathway_resp.c ^
    host_link.c

if %errorlevel% neq 0 (
    echo Server build failed.
    exit /b 1
)

echo [2/2] Building integration test driver...
gcc -Wall -Wextra -std=c99 -I. -o test_driver.exe ^
    card_auth.c ^
    pathway_req.c ^
    pathway_resp.c ^
    host_link.c ^
    test_driver.c

if %errorlevel% neq 0 (
    echo Test driver build failed.
    exit /b 1
)

echo Build succeeded: card_auth_server.exe, test_driver.exe
