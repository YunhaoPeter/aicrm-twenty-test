#!/bin/bash
set -e

echo "🚀 启动 Twenty CRM..."
docker compose up -d

echo ""
echo "⏳ 等待服务就绪..."
sleep 5

# 等待 healthcheck 通过
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/healthz > /dev/null 2>&1; then
    echo "✅ Twenty CRM 已就绪！"
    echo "🌐 访问地址: http://localhost:3000"
    echo ""
    echo "📋 查看日志: docker compose logs -f"
    echo "🛑 停止服务: docker compose down"
    exit 0
  fi
  printf "."
  sleep 2
done

echo ""
echo "⚠️  服务启动中，请稍后访问 http://localhost:3000"
echo "   查看详细日志: docker compose logs -f"
