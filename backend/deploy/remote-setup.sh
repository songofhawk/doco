#!/bin/bash
# Doco 后端服务器端一键初始化（幂等，可重复执行）
# 前提：代码已 rsync 到 /opt/doco/backend（见 deploy-from-local.sh）
set -euo pipefail

NODE_MIN_MAJOR=20

node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

node_is_usable() {
  command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]
}

os_id() {
  . /etc/os-release 2>/dev/null || true
  echo "${ID:-unknown}"
}

echo "== 1/5 基础依赖 =="
if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 执行远端初始化脚本" >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  PKG_MANAGER=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG_MANAGER=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG_MANAGER=yum
else
  echo "未找到 apt-get/dnf/yum，当前脚本仅支持 Debian/Ubuntu/RHEL/CentOS/OpenCloudOS 等 systemd Linux。" >&2
  exit 1
fi

install_base_packages() {
  case "$PKG_MANAGER" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq curl rsync ca-certificates build-essential python3 cron xz-utils >/dev/null
      ;;
    dnf)
      dnf install -y -q curl rsync ca-certificates make gcc-c++ python3 cronie xz >/dev/null
      ;;
    yum)
      yum install -y -q curl rsync ca-certificates make gcc-c++ python3 cronie xz >/dev/null
      ;;
  esac
}

install_node_from_packages() {
  if [ "$(os_id)" = "opencloudos" ]; then
    echo "== OpenCloudOS 不走 NodeSource，直接使用 Node 官方二进制 =="
    return 1
  fi

  case "$PKG_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y -qq nodejs >/dev/null
      ;;
    dnf)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      dnf install -y -q nodejs >/dev/null
      ;;
    yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      yum install -y -q nodejs >/dev/null
      ;;
  esac
  node_is_usable
}

install_node_from_tarball() {
  case "$(uname -m)" in
    x86_64 | amd64)
      NODE_ARCH=x64
      ;;
    aarch64 | arm64)
      NODE_ARCH=arm64
      ;;
    *)
      echo "不支持的 CPU 架构：$(uname -m)" >&2
      return 1
      ;;
  esac

  NODE_DIST=https://nodejs.org/dist
  NODE_VERSION="$(curl -fsSL "$NODE_DIST/index.tab" | awk -v prefix="v${NODE_MIN_MAJOR}." 'NR > 1 && index($1, prefix) == 1 { print $1; exit }')"
  if [ -z "$NODE_VERSION" ]; then
    echo "无法从 nodejs.org 获取 Node ${NODE_MIN_MAJOR}.x 版本索引" >&2
    return 1
  fi

  NODE_ARCHIVE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  NODE_TMP="/tmp/${NODE_ARCHIVE}"
  NODE_PREFIX="/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-${NODE_ARCH}"

  echo "== NodeSource 不可用，改用 Node 官方二进制：${NODE_VERSION} ${NODE_ARCH} =="
  curl -fL "$NODE_DIST/${NODE_VERSION}/${NODE_ARCHIVE}" -o "$NODE_TMP"
  mkdir -p /usr/local/lib/nodejs
  rm -rf "$NODE_PREFIX"
  tar -xJf "$NODE_TMP" -C /usr/local/lib/nodejs
  ln -sfn "$NODE_PREFIX/bin/node" /usr/local/bin/node
  ln -sfn "$NODE_PREFIX/bin/npm" /usr/local/bin/npm
  ln -sfn "$NODE_PREFIX/bin/npx" /usr/local/bin/npx
  hash -r
  node_is_usable
}

install_node() {
  if install_node_from_packages; then
    return 0
  fi

  install_node_from_tarball
}

install_base_packages

if ! node_is_usable; then
  echo "== 安装 Node ${NODE_MIN_MAJOR}+ =="
  install_node
fi
node -v
npm -v

echo "== 2/5 运行用户与目录 =="
NOLOGIN=/usr/sbin/nologin
[ -x "$NOLOGIN" ] || NOLOGIN=/sbin/nologin
[ -x "$NOLOGIN" ] || NOLOGIN=/bin/false
id doco >/dev/null 2>&1 || useradd --system --home-dir /opt/doco --shell "$NOLOGIN" doco
mkdir -p /opt/doco/backend /opt/doco/backups

echo "== 3/5 安装依赖 =="
cd /opt/doco/backend
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
chown -R doco:doco /opt/doco

echo "== 4/5 systemd 服务 =="
NODE_BIN="$(command -v node)"
cp deploy/doco-backend.service /etc/systemd/system/
sed -i "s|^ExecStart=.*|ExecStart=${NODE_BIN} server.js|" /etc/systemd/system/doco-backend.service
systemctl daemon-reload
systemctl enable doco-backend >/dev/null 2>&1 || true
systemctl restart doco-backend
sleep 2
systemctl is-active doco-backend

echo "== 5/5 本机自检 =="
if [ "$(curl -s -o /tmp/doco-auth-check.json -w '%{http_code}' http://127.0.0.1:8000/api/auth/me)" = "401" ]; then
  cat /tmp/doco-auth-check.json
  echo " <- /api/auth/me OK"
else
  cat /tmp/doco-auth-check.json >&2 || true
  echo "后端自检失败：/api/auth/me 未返回预期 401" >&2
  exit 1
fi

echo "== 备份 cron =="
systemctl enable --now crond >/dev/null 2>&1 || systemctl enable --now cron >/dev/null 2>&1 || true
chmod +x deploy/backup.sh
{
  crontab -l 2>/dev/null | grep -v doco/backend/deploy/backup.sh || true
  echo "30 4 * * * /opt/doco/backend/deploy/backup.sh"
} | crontab -

echo
echo "完成。下一步：配置域名 + Caddy（deploy/README.md 第 5 节），然后更新前端 .env.production 并重新部署。"
