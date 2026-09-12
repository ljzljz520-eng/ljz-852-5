#!/usr/bin/env bash
# 启动本地 Meilisearch（无 Docker 环境时使用）。有 Docker 时优先：docker compose up -d
set -e
cd "$(dirname "$0")/.."
mkdir -p .bin/meili-data
if [ ! -x .bin/meilisearch ]; then
  ARCH=$(uname -m); case "$ARCH" in
    x86_64|amd64) A=x86_64 ;; aarch64|arm64) A=aarch64 ;; *) echo "不支持的架构: $ARCH"; exit 1 ;;
  esac
  echo "下载 Meilisearch ($A)…"
  curl -sL -o .bin/meilisearch \
    "https://github.com/meilisearch/meilisearch/releases/download/v1.10.2/meilisearch-linux-$A"
  chmod +x .bin/meilisearch
fi
exec .bin/meilisearch --db-path .bin/meili-data --http-addr 127.0.0.1:7700 \
  --master-key "${MEILI_API_KEY:-patchIndexDevKey2026}" --no-analytics
