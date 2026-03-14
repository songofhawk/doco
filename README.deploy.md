# Doco 部署指南

## 快速部署（Docker）

```bash
# 一键部署
./deploy.sh

# 或手动执行
docker-compose up -d
```

## 本地开发

```bash
# 前端
pnpm run dev

# 后端
cd backend && python main.py
```

## 生产部署

### 方式 1：Docker Compose（推荐）

```bash
docker-compose up -d
```

### 方式 2：手动部署

```bash
# 1. 构建前端
cd packages/editor && pnpm run build && cd ../..
pnpm run build

# 2. 启动后端
cd backend
source venv/bin/activate
python main.py
```

## 端口说明

- 前端：http://localhost:5173（开发）
- 后端：http://localhost:8000（生产）
- WebSocket：ws://localhost:8000/ws/{room}

## 数据持久化

- 数据库：`backend/doco.db`
- 导出文件：`exports/`
