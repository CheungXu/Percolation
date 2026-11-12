#!/usr/bin/env bash
# Arize Phoenix 单容器运维：轨迹可视化面板（派生视图，真相源是 NAS telemetry 仓）。
#
#   script/phoenix.sh init-db   用 ADMIN_ENV 指向的高权限账号建独立库/角色 percolation_obs，生成 config/phoenix.env
#   script/phoenix.sh up        启动容器（host 网络，只监听 127.0.0.1:6006 / 4317，开启认证）
#   script/phoenix.sh down|status|logs
#
# 远程查看：ssh -L 6006:127.0.0.1:6006 <server>，浏览器打开 http://127.0.0.1:6006
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/config/phoenix.env"
NAME="${PHOENIX_CONTAINER:-percolation-phoenix}"
IMAGE="${PHOENIX_IMAGE:-arizephoenix/phoenix:latest}"
ADMIN_ENV="${ADMIN_ENV:-/root/star-page/config/db.env}"
DB_NAME="percolation_obs"
DB_ROLE="percolation_obs"

token() { python3 -c 'import secrets; print(secrets.token_hex(24))'; }

init_db() {
  [[ -f "$ENV_FILE" ]] && { echo "已存在 $ENV_FILE，不覆盖"; exit 1; }
  [[ -r "$ADMIN_ENV" ]] || { echo "读不到管理账号配置 $ADMIN_ENV"; exit 1; }
  local password secret admin_secret ui_password
  password="$(token)"; secret="$(token)"; admin_secret="$(token)"; ui_password="$(token)"
  (
    set -a; . "$ADMIN_ENV"; set +a
    export PGDATABASE=postgres
    psql -v ON_ERROR_STOP=1 -q -v pw="$password" <<SQL
SELECT format('CREATE ROLE $DB_ROLE LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE') \gexec
SELECT format('ALTER ROLE $DB_ROLE PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_ROLE' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME') \gexec
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
GRANT CONNECT, TEMP ON DATABASE $DB_NAME TO $DB_ROLE;
SQL
    echo "PGHOST=$PGHOST" > /tmp/.phoenix_dbhost.$$
    echo "PGPORT=${PGPORT:-5432}" >> /tmp/.phoenix_dbhost.$$
  )
  # shellcheck disable=SC1090
  . /tmp/.phoenix_dbhost.$$; rm -f /tmp/.phoenix_dbhost.$$
  umask 077
  cat > "$ENV_FILE" <<ENV
# Phoenix 容器配置（自动生成，勿提交）。数据库是独立库 $DB_NAME，与业务库 percolation 隔离。
PHOENIX_SQL_DATABASE_URL=postgresql://$DB_ROLE:$password@$PGHOST:$PGPORT/$DB_NAME
PHOENIX_SQL_DATABASE_SCHEMA=phoenix
PHOENIX_HOST=127.0.0.1
PHOENIX_PORT=6006
PHOENIX_GRPC_PORT=4317
PHOENIX_ENABLE_AUTH=true
PHOENIX_SECRET=$secret
PHOENIX_ADMIN_SECRET=$admin_secret
PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=$ui_password
PHOENIX_TELEMETRY_ENABLED=false
PHOENIX_DISABLE_MODEL_COST_AUTO_UPDATE=true
PHOENIX_DEFAULT_RETENTION_POLICY_DAYS=90
ENV
  chmod 600 "$ENV_FILE"
  echo "已创建库 $DB_NAME / 角色 $DB_ROLE，配置写入 $ENV_FILE（600）"
  echo "UI 账号 admin@localhost，初始密码见 PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD（首次登录需修改）"
}

up() {
  [[ -f "$ENV_FILE" ]] || { echo "缺少 $ENV_FILE，先运行 init-db"; exit 1; }
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart unless-stopped --network host \
    --memory 1g --env-file "$ENV_FILE" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "http://127.0.0.1:6006/healthz"; then echo "Phoenix 已就绪：http://127.0.0.1:6006"; return; fi
    sleep 2
  done
  echo "Phoenix 启动超时，查看 script/phoenix.sh logs"; exit 1
}

case "${1:-}" in
  init-db) init_db ;;
  up) up ;;
  down) docker rm -f "$NAME" ;;
  status) docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}}'; docker stats --no-stream "$NAME" --format '{{.MemUsage}}' 2>/dev/null || true; ss -ltn | grep -E ':(6006|4317)\b' || true ;;
  logs) docker logs --tail "${2:-100}" "$NAME" ;;
  *) echo "用法：$0 {init-db|up|down|status|logs}"; exit 1 ;;
esac
