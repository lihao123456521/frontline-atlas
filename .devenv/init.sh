#!/bin/bash
# DevStation / GitCode 云开发环境初始化脚本
# 容器启动后会自动执行；仓库会被拉取到工作目录。
set -e

# 进入项目目录（不同环境工作目录可能不同，做兜底）
if [ -d "/workspace/project" ]; then
  cd /workspace/project
elif [ -d "$HOME/project" ]; then
  cd "$HOME/project"
else
  cd "$(dirname "$0")/.."
fi

# 纯静态站点，仅需 Python 标准库即可运行
python3 -m compileall -q server.py 2>/dev/null || true

# DevStation 端口转发仅支持 8080-8089
export HOST=0.0.0.0
export PORT=8080

# 避免重复启动
pkill -f "server.py" 2>/dev/null || true

nohup python3 server.py > /tmp/steelambition-web.log 2>&1 &
echo "game server started at http://0.0.0.0:8080 (log: /tmp/steelambition-web.log)"