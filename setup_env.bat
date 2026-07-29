@echo off
REM =============================================================
REM   Virtual Environment Setup Script (Windows)
REM   For: Icount System
REM =============================================================

echo.
echo  Setting up virtual environment for Webservice...
echo.

REM ── Step 1: Check Python ─────────────────────────────────────
python --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo  [ERROR] Python not found. Please install Python 3.7 or higher.
    echo  Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

FOR /F "tokens=*" %%i IN ('python --version') DO echo  [OK] Found: %%i

REM ── Step 2: Create virtual environment ───────────────────────
SET ENV_NAME=env

IF EXIST %ENV_NAME%\ (
    echo  [SKIP] Virtual environment '%ENV_NAME%' already exists.
) ELSE (
    echo.
    echo  [INFO] Creating virtual environment: %ENV_NAME%
    python -m env %ENV_NAME%
    echo  [OK] Virtual environment created.
)

REM ── Step 3: Activate it ──────────────────────────────────────
echo.
echo  [INFO] Activating virtual environment...
CALL %ENV_NAME%\Scripts\activate.bat

REM ── Step 4: Upgrade pip ──────────────────────────────────────
echo.
echo  [INFO] Upgrading pip...
python -m pip install --upgrade pip --quiet

REM ── Step 5: Install dependencies ─────────────────────────────
IF NOT EXIST requirements.txt (
    echo  [ERROR] requirements.txt not found in current directory.
    pause
    exit /b 1
)

echo.
echo  [INFO] Installing dependencies from requirements.txt...
pip install -r requirements.txt

REM ── Step 6: Confirm installed packages ───────────────────────
echo.
echo  [INFO] Installed packages:
pip list

REM ── Done ─────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Setup complete!
echo.
echo   To activate the environment later, run:
echo     env\Scripts\activate
echo
echo.
echo   To deactivate the environment:
echo     deactivate
echo ============================================================
echo.
pause
