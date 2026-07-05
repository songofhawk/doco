#!/bin/bash
# SQLite 每日备份（WAL 安全：用 better-sqlite3 的在线 backup API，不是直接 cp）
# crontab: 30 4 * * * /opt/doco/backend/deploy/backup.sh
set -e
BACKUP_DIR=/opt/doco/backups
mkdir -p "$BACKUP_DIR"
cd /opt/doco/backend
node -e "require('better-sqlite3')('doco.db').backup('$BACKUP_DIR/doco-'+new Date().toISOString().slice(0,10)+'.db').then(()=>process.exit(0))"
# 保留最近 14 天
ls -1t "$BACKUP_DIR"/doco-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
