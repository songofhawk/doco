#!/usr/bin/env bash
# 在本地构建并发布 Doco 的服务器直连前端。
# 用法：bash backend/deploy/deploy-frontend-from-local.sh root@<服务器IP> /path/to/key.pem
set -euo pipefail

TARGET="${1:?用法：bash backend/deploy/deploy-frontend-from-local.sh user@host /path/to/key.pem}"
KEY="${2:?缺少私钥路径}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT_DIR"
pnpm run build:server

echo "== 上传直连前端到 $TARGET:/opt/doco/frontend/ =="
rsync -az --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  dist/ "$TARGET:/opt/doco/frontend/"

echo "== 更新 Caddy 路由 =="
scp -i "$KEY" -o StrictHostKeyChecking=accept-new \
  backend/deploy/Caddyfile "$TARGET:/tmp/doco-Caddyfile"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$TARGET" \
  'caddy validate --config /tmp/doco-Caddyfile && install -m 644 /tmp/doco-Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy'

echo "== 直连前端部署完成 =="
