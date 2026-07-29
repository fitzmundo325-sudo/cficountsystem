@echo off
REM =============================================================
REM   Auto-Activate Virtual Environment
REM =============================================================

REM ── Check if venv exists ─────────────────────────────────────
IF NOT EXIST venv\Scripts\activate.bat (
    echo  [ERROR] Virtual environment not found!
    echo  Please run setup_env.bat first.
    echo.
    pause
    exit /b 1
)

REM ── Activate the environment ─────────────────────────────────
echo  [INFO] Activating virtual environment...
CALL venv\Scripts\activate.bat
echo  [OK] Environment is ready!

CALL run.cmd