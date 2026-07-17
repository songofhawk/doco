# Doco 后端部署（Linux + systemd）

目标布局：代码在 `/opt/doco/backend`，以专用用户 `doco` 运行 systemd 服务，
Caddy 在 443 终结 TLS 并反代到 `127.0.0.1:8000`。当前免费后端域名使用
`doco-124-156-169-69.sslip.io`，会自动解析到 `124.156.169.69`。

## 1. 一键上传并初始化（推荐）

本地执行：

```bash
bash backend/deploy/deploy-from-local.sh root@<服务器IP> /path/to/key.pem
```

脚本会把 `backend/` 同步到 `/opt/doco/backend/`，再在远端执行 `deploy/remote-setup.sh`。
远端初始化脚本会自动识别 `apt-get`、`dnf` 或 `yum`，适配 Debian/Ubuntu/RHEL/CentOS/OpenCloudOS
等常见 systemd Linux。若看到 `apt-get: command not found`，说明旧脚本把远端误认为 Debian/Ubuntu，
请重新运行新版脚本。

Node 安装优先走 NodeSource 系统包；OpenCloudOS 会直接跳过 NodeSource，因为 NodeSource
当前不识别该发行版。脚本会改用 Node 官方 Linux 二进制包安装到 `/usr/local/lib/nodejs/`，
并把 `node`/`npm`/`npx` 链接到 `/usr/local/bin/`。

## 2. 手动初始化（root 执行一次）

Debian/Ubuntu：

```bash
apt-get update
apt-get install -y curl git rsync ca-certificates build-essential python3 cron
# Node 20 LTS（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
# 运行用户与目录
useradd --system --home /opt/doco --shell /usr/sbin/nologin doco
mkdir -p /opt/doco/backend /opt/doco/backups
```

RHEL/CentOS/OpenCloudOS：

```bash
yum install -y curl git rsync ca-certificates make gcc-c++ python3 cronie
# 或 dnf install -y curl git rsync ca-certificates make gcc-c++ python3 cronie
# RHEL/CentOS 可用 NodeSource；OpenCloudOS 请使用上方一键脚本，它会自动安装 Node 官方二进制包。
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
# 运行用户与目录
useradd --system --home-dir /opt/doco --shell /sbin/nologin doco
mkdir -p /opt/doco/backend /opt/doco/backups
```

## 3. 上传代码（本地执行）

```bash
rsync -az --delete \
  --exclude node_modules --exclude 'doco.db*' \
  backend/ root@<服务器IP>:/opt/doco/backend/
```

## 4. 安装依赖并启动服务（root 执行）

```bash
cd /opt/doco/backend && npm install --omit=dev
chown -R doco:doco /opt/doco
cp deploy/doco-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now doco-backend
systemctl status doco-backend --no-pager
curl -i http://127.0.0.1:8000/api/auth/me   # 未登录时应返回 401
```

生产服务默认只接受指定前端的浏览器请求：

```ini
Environment=ALLOWED_ORIGINS=https://doco-editor.pages.dev
Environment=GOOGLE_CLIENT_ID=321174610881-tv7v2e0e1u0300pqkk0t9dv2v4esl7f2.apps.googleusercontent.com
Environment=COOKIE_SAMESITE=none
Environment=COOKIE_SECURE=true
```

邮箱验证码登录所需的 SMTP 密钥不要写入仓库或 service 文件。创建服务器本地配置：

```bash
install -m 600 /dev/null /etc/doco-backend.env
editor /etc/doco-backend.env
```

内容示例：

```ini
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Doco <no-reply@example.com>"
```

`doco-backend.service` 通过 `EnvironmentFile=-/etc/doco-backend.env` 读取它，
`deploy-from-local.sh` 不会上传或覆盖该文件。修改后重启服务生效。

若前端域名变化，或需要临时允许 Cloudflare Pages 预览域名，修改
`/etc/systemd/system/doco-backend.service` 中的 `ALLOWED_ORIGINS`，多个 Origin 用英文逗号分隔，
然后执行：

```bash
systemctl daemon-reload
systemctl restart doco-backend
```

无 `Origin` 的本机健康检查和服务端调用仍允许；带 `Origin` 的 REST 与 WebSocket 请求必须命中白名单。

## 5. TLS 入口（Caddy）

前端托管在 HTTPS 的 Cloudflare Pages 上，浏览器禁止混合内容，
**必须**用 `wss://`，因此需要一个域名 + 证书（Caddy 全自动）：

当前可直接使用免费解析域名：

```text
doco-124-156-169-69.sslip.io
```

`sslip.io` 会按域名里的 IP 自动返回 `124.156.169.69`，无需手动配置 DNS。

Debian/Ubuntu：

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

RHEL/CentOS/OpenCloudOS：

```bash
yum install -y yum-plugin-copr
yum copr enable @caddy/caddy -y
yum install -y caddy
```

然后：

```bash
# 把 deploy/Caddyfile 中的域名改成你的，然后：
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

DNS：域名 A 记录 → 服务器 IP。若 DNS 托管在 Cloudflare，**先用灰云（DNS only）**
让 Let's Encrypt 签发通过；之后可切橙云（Proxied，需在 CF 开启 WebSocket 支持，默认开）。

云平台防火墙（腾讯云轻量在控制台"防火墙"页）：放行 443；**不要**放行 8000。

## 6. 前端指向新后端

`.env.production`：

```
VITE_WS_URL=wss://doco-124-156-169-69.sslip.io/ws
VITE_API_BASE=https://doco-124-156-169-69.sslip.io/api
```

然后 `pnpm run deploy`。

## 7. 日常运维

```bash
journalctl -u doco-backend -f          # 看日志
systemctl restart doco-backend         # 重启（SIGTERM 会先 flush 未落库文档）
crontab -e                             # 加一行每日备份：
# 30 4 * * * /opt/doco/backend/deploy/backup.sh
```

数据库就是单文件 `/opt/doco/backend/doco.db`，备份=复制（backup.sh 用在线 backup API，WAL 安全）。
