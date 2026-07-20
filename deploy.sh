#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.docker ]]; then
  echo "缺少 .env.docker，请先执行：cp .env.docker.example .env.docker" >&2
  exit 1
fi

echo "正在构建并启动 Doco..."
docker compose --env-file .env.docker up -d --build

echo "Doco 已启动。请使用 .env.docker 中 DOCO_HTTP_PORT 配置的端口访问。"
