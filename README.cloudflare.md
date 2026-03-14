# Cloudflare 部署指南

## 前置准备

1. 安装 Wrangler CLI：
```bash
npm install -g wrangler
```

2. 登录 Cloudflare：
```bash
wrangler login
```

## 一键部署

```bash
./deploy-cloudflare.sh
```

## 手动部署步骤

### 1. 创建 D1 数据库

```bash
wrangler d1 create doco
```

复制返回的 `database_id`，更新到 [wrangler.toml](wrangler.toml#L14)

### 2. 初始化数据库表

```bash
wrangler d1 execute doco --file=backend/schema.sql
```

### 3. 部署后端 Worker

```bash
wrangler deploy
```

记录返回的 Worker URL（如 `https://doco-backend.your-account.workers.dev`）

### 4. 更新前端配置

编辑 [.env.production](.env.production)，将 Worker URL 填入：
```
VITE_WS_URL=wss://doco-backend.your-account.workers.dev/ws
```

### 5. 部署前端到 Pages

```bash
cd packages/editor && pnpm run build && cd ../..
pnpm run build
wrangler pages deploy dist --project-name=doco
```

## 访问地址

- 前端：`https://doco.pages.dev`
- 后端：`https://doco-backend.your-account.workers.dev`

## 注意事项

- Cloudflare Workers 免费版限制：每天 100,000 次请求
- D1 数据库免费版限制：5GB 存储
- Durable Objects 用于 WebSocket 协同，按使用量计费
