#!/bin/bash
set -e

echo "🚀 开始部署 Doco..."

# 构建前端编辑器包
echo "📦 构建编辑器包..."
cd packages/editor && pnpm run build && cd ../..

# 构建 Docker 镜像
echo "🐳 构建 Docker 镜像..."
docker-compose build

# 启动服务
echo "✨ 启动服务..."
docker-compose up -d

echo "✅ 部署完成！访问 http://localhost:8000"
