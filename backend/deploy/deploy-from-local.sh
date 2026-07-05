#!/bin/bash
# 在本地（Mac）执行：推送代码到服务器并运行远端初始化
# 用法：backend/deploy/deploy-from-local.sh root@<服务器IP> /path/to/key.pem
set -euo pipefail
TARGET="${1:?用法: deploy-from-local.sh user@host /path/to/key.pem}"
KEY="${2:?缺少私钥路径}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # backend/

echo "== 上传 backend 到 $TARGET:/opt/doco/backend/ =="
rsync -az --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude 'doco.db*' --exclude '*.backup-*' \
  "$DIR/" "$TARGET:/opt/doco/backend/" --rsync-path="mkdir -p /opt/doco/backend && rsync"

echo "== 执行远端初始化 =="
if ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$TARGET" 'bash /opt/doco/backend/deploy/remote-setup.sh'; then
  echo "== 部署完成 =="
else
  status=$?
  echo "远端初始化失败，退出码：$status" >&2
  exit "$status"
fi
