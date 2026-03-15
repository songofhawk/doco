# 前端构建阶段
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# 后端运行阶段
FROM python:3.11-slim
WORKDIR /app

# 安装 Python 依赖
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend ./backend

# 复制前端构建产物
COPY --from=frontend-builder /app/dist ./frontend/dist

# 暴露端口
EXPOSE 8000

# 启动后端服务
CMD ["python", "backend/main.py"]
