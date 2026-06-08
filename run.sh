#!/bin/bash

echo "========================================"
echo "  Stock Monitor Web v3.0"
echo "  A股价格预警监控系统（Web版）"
echo "========================================"
echo ""

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 not found. Please install Python 3.8+"
    exit 1
fi

# 检查Flask
if ! python3 -c "import flask" &> /dev/null; then
    echo "[INFO] Installing Flask..."
    pip3 install flask
fi

echo "[INFO] Starting server at http://localhost:5000"
echo "[INFO] Press Ctrl+C to stop"
echo ""

python3 app.py
