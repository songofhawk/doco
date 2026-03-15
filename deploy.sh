#!/bin/bash
set -e

echo "🚀 开始部署 Doco..."

# 构建 Docker 镜像
echo "🐳 构建 Docker 镜像..."
docker-compose build

# 启动服务
echo "✨ 启动服务..."
docker-compose up -d

echo "✅ 部署完成！访问 http://localhost:8000"
