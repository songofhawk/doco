# Docker 部署

Doco 的 Docker 包由两个容器组成：

- `frontend`：Caddy 提供前端静态文件，并把 REST API 和 WebSocket 同源代理到后端。
- `backend`：Node.js 22、Express、Hocuspocus 和 SQLite。

两个容器均以非 root 用户运行。数据库和附件保存在命名卷 `doco-data` 中，不会写入镜像或源码目录。

## 环境要求

- Docker Engine 24 或更高版本
- Docker Compose v2
- 使用预构建镜像时能够访问 Docker Hub
- 从源码构建时还需能够访问 npm 和 pnpm 软件源

官方发布镜像：

- `songofhawkg/doco-frontend:latest`
- `songofhawkg/doco-backend:latest`

`latest` 和日期版本（例如 `20260719`）都是多架构镜像，同时支持 `linux/amd64` 和 `linux/arm64`，Docker 会自动选择当前机器对应的架构。生产环境建议固定日期版本，便于回滚。

## 首次启动

```bash
cp .env.docker.example .env.docker
```

至少检查以下配置：

- `DOCO_HTTP_PORT`：宿主机监听端口，默认 `8080`。
- `ALLOWED_ORIGINS`：浏览器访问地址的完整 Origin，必须包含协议和端口。
- `COOKIE_SECURE`：直接使用 HTTP 时为 `false`；HTTPS 时为 `true`。
- `GOOGLE_CLIENT_ID`：需要 Google 登录时填写，重启容器即可生效。
- `SMTP_*`：需要邮箱验证码登录时填写。

使用 Docker Hub 预构建镜像启动（推荐）：

```bash
docker compose --env-file .env.docker up -d
```

如需固定版本，在 `.env.docker` 中设置：

```dotenv
DOCO_IMAGE_NAMESPACE=songofhawkg
DOCO_IMAGE_TAG=20260719
```

如需从当前源码自行构建并启动：

```bash
docker compose --env-file .env.docker up -d --build
```

仓库脚本执行的也是源码构建：

```bash
./deploy.sh
```

默认访问地址为 <http://localhost:8080>。

## 配置文件如何生效

命令中的 `--env-file .env.docker` 为 Compose 提供端口、镜像标签和数据卷等变量；`docker-compose.yml` 的 `env_file` 配置又会在创建后端容器时读取同一个文件，把认证、邮件和配额配置注入容器运行环境。

加载顺序如下，后面的同名配置覆盖前面的配置：

1. 仓库根目录 `.env`（可选）
2. `backend/.env.local`（可选）
3. `.env.docker`（必需）
4. `docker-compose.yml` 中明确声明的固定容器配置

接收镜像的用户不需要这些文件预先存在于镜像中，只需复制 `.env.docker.example` 为 `.env.docker` 并填写自己的配置。SMTP 密码、Google Client ID 等不会在构建时写入镜像；但拥有 Docker 守护进程管理权限的人可以查看正在运行的容器环境变量，因此应限制服务器和 Docker 的管理权限。

## 状态检查

```bash
docker compose --env-file .env.docker ps
curl --fail http://localhost:8080/healthz
docker compose --env-file .env.docker logs --tail=100 backend frontend
```

健康接口正常时返回：

```json
{"status":"ok"}
```

## 数据目录

容器中的持久化路径为：

| 数据 | 容器路径 |
|---|---|
| SQLite 数据库 | `/data/doco.db` |
| SQLite WAL/SHM | `/data/doco.db-wal`、`/data/doco.db-shm` |
| 附件 | `/data/attachments/` |

命名卷名称由 `DOCO_DATA_VOLUME` 控制，默认是 `doco-data`。不要只复制正在运行中的 `doco.db`，否则可能遗漏 WAL 中尚未合并的数据。

## 完整备份

下面的方式会短暂停止服务，并把数据库、WAL 和附件一起打包：

```bash
docker compose --env-file .env.docker stop
docker run --rm \
  -v doco-data:/data:ro \
  -v "$PWD":/backup \
  alpine:3.22 \
  tar czf /backup/doco-data-backup.tar.gz -C /data .
docker compose --env-file .env.docker start
```

如果修改了 `DOCO_DATA_VOLUME`，同步替换命令中的 `doco-data`。

## 恢复备份

恢复会覆盖目标卷中的现有数据，执行前应另存当前卷：

```bash
docker compose --env-file .env.docker down
docker volume create doco-data
docker run --rm \
  -v doco-data:/data \
  -v "$PWD":/backup:ro \
  alpine:3.22 \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/doco-data-backup.tar.gz -C /data'
docker compose --env-file .env.docker up -d
```

## 升级

使用 Docker Hub 镜像部署时：

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
curl --fail http://localhost:8080/healthz
```

从源码构建部署时：

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
curl --fail http://localhost:8080/healthz
```

新镜像复用现有命名卷，后端启动时会自动运行数据库迁移。升级前仍建议执行完整备份。

## HTTPS 反向代理

Docker 包自身监听 HTTP，适合放在宿主机 Caddy、Nginx、Traefik 或云负载均衡器后。代理必须支持 WebSocket，并转发以下路径：

- `/app-api/*`
- `/api/*`
- `/ws*`
- `/healthz`

启用 HTTPS 后，在 `.env.docker` 中设置：

```dotenv
ALLOWED_ORIGINS=https://doco.example.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```

修改环境变量后重新创建容器；只有修改前端配额值时才需要重新构建镜像。

## 常用命令

```bash
# 查看日志
docker compose --env-file .env.docker logs -f

# 重启
docker compose --env-file .env.docker restart

# 停止但保留数据
docker compose --env-file .env.docker down

# 查看命名卷
docker volume inspect doco-data
```

不要使用 `docker compose down -v`，该命令会删除数据库和附件所在的命名卷。
