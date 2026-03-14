#!/bin/bash
set -e

echo "🚀 部署到 Cloudflare..."

# 检查是否安装 wrangler
if ! command -v wrangler &> /dev/null; then
    echo "❌ 未安装 wrangler，正在安装..."
    npm install -g wrangler
fi

# 1. 构建编辑器包
echo "📦 构建编辑器包..."
cd packages/editor && pnpm run build && cd ../..

# 2. 构建前端
echo "🎨 构建前端..."
pnpm run build

# 3. 部署后端到 Workers
echo "☁️  部署后端到 Cloudflare Workers..."
wrangler deploy

# 4. 部署前端到 Pages
echo "📄 部署前端到 Cloudflare Pages..."
wrangler pages deploy dist --project-name=doco

echo "✅ 部署完成！"
echo "📝 请在 .env.production 中更新 VITE_WS_URL 为你的 Workers 地址"
