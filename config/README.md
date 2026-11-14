# config

Percolation 运行配置目录。真实凭据存放在 `*.env`（已被 `config/.gitignore` 忽略，权限 `600`，严禁入库），版本库仅跟踪 `*.env.example` 模板与无密钥的 `models.json`。

## 文件说明

| 文件 | 用途 | 关键约定 |
| --- | --- | --- |
| `db.env` (`db.env.example`) | PostgreSQL 连接与连接池参数 | `DATABASE_URL` / `PGUSER` 固定使用受强制 RLS 约束的 `percolation_app`；`MIGRATE_DATABASE_URL` 使用 `percolation_owner`，仅限 DDL 迁移与运维工具（`e2e_percolation.py`、`backfill_workspace_head.py`、`trace_cli.py reproduce` 建/删 `e2e-`/`replay-` 临时租户）调用；在线服务、检索与整理的运行路径禁止读取。 |
| `storage.env` (`storage.env.example`) | 共享文件存储与沙箱参数 | 定义 `NAS_ROOT_DIR`（`/mnt/percolation`）、单用户阶段默认租户 `DEFAULT_USER_SLUG` / `DEFAULT_USER_ID`、沙箱驱动 `SANDBOX_DRIVER`（`bwrap`）、连发合并窗口 `BURST_WINDOW_SECONDS`（默认 180 秒）以及 `MEMORY_LINE_LIMIT`（默认 200 行）。 |
| `llm.env` (`llm.env.example`) | 模型通道 API 密钥 | 存放阿里云百炼 `QWEN_API_KEY` 与火山方舟 `ARK_API_KEY`。 |
| `models.json` | 逻辑槽位与多模型目录 | 通过 `slots` 将业务能力解耦映射到具体模型定义，切换模型时无需改动业务代码。`pricing` 字段（人民币 / 每百万 token：`input`、`cached_input`、`output`）用于成本账本，没配的模型成本记为未知。 |
| `facets.json` | 多维 Wiki 受控词表 | 定义页面节点类型 `page_types`、关系边类型 `relation_types` 及核心正交维度 `dimensions`（`domain`、`form`、`status`、`topic`），与工作区 `MEMORY_CACHE/facets.md` 合并注入路由与整理节点。 |
| `observability.env` (`observability.env.example`) | 轨迹仓与导出 | `TELEMETRY_ROOT`（NAS 上与 `workspaces/` 平级的隔离目录）、`TRACE_LEVEL`（`full`/`summary`）、`TRACE_BLOB_THRESHOLD`、单次运行预算 `RUN_MAX_COST_CNY` / `RUN_MAX_TOKENS`、`OTLP_ENDPOINT` / `OTLP_PROJECT` / `OTLP_HEADERS`（Phoenix 认证用 Bearer）。 |
| `phoenix.env` (`phoenix.env.example`) | Phoenix 容器 | 由 `script/phoenix.sh init-db` 生成：独立库/角色 `percolation_obs`（schema `phoenix`）、认证密钥、UI 初始密码。 |
| `web.env` (`web.env.example`) | 拾记凝境网页端 | `AUTH_MODE`（`star_page` 线上复用星页登录 / `header` 本机调试）、星页鉴权地址与 cookie 名、登录协议版本（与星页前端 `LEGAL_POLICY_VERSION` 一致）、协议链接、每日询问 / 记录上限。无密钥，但按约定不入库。 |

## 模型槽位约定（`models.json`）

- `router_model`：在线意图路由与检索词改写（默认 `qwen-flash`，关闭思考以压低首包延迟）。
- `search_model`：主路径核验作答与候选缓存区沙箱探查循环（默认 `qwen-flash`）。
- `dream_model`：夜间离线整理、语境拼图与热温区升降级决策（默认 `qwen-max`，开启思考）。
- `embedding_model`：主题页切片向量化（默认百炼 `text-embedding-v4`，固定 `dimensions=1024`，对应数据库 `halfvec(1024)`）。
- `rerank_model`：多路召回候选集交叉精排（默认百炼 `gte-rerank-v2`，走 DashScope 原生 `text-rerank` 端点）。

修改 `llm.env` 或 `models.json` 后，可运行 `python3 script/probe_retrieval_models.py` 验证向量维度与重排连通性。

## systemd（`systemd/`，2026-11-15 起全部启用）

- `percolation-api.service`：拾记凝境网页与接口，`127.0.0.1:8710`，2 个 worker。
- `percolation-dream.service` + `percolation-dream.timer`：每晚 03:30（随机延后 10 分钟内）执行 `percolation_cli.py dream --all`，处理全部脏租户（含网页端的 `sp-<uuid>` 租户）。
- `percolation-ui-previews.service`：界面备选方案预览（`alternatives/product-ui/`，3011..3015）。

API 与整理依赖 `remote-fs.target`，NAS 没挂上时不会启动。安装 / 更新方法写在各文件开头的注释里（`cp` 到 `/etc/systemd/system/` 后 `daemon-reload`）。

## Nginx 片段（`nginx/`）

两份片段都由星页站点 `/etc/nginx/sites-available/star-page` 引入（星页仓库副本 `/root/star-page/config/nginx/star-page.conf` 同步写了 include 行），文件本身以这里为准，改完 `cp` 到 `/etc/nginx/snippets/` 再 `nginx -t && systemctl reload nginx`：

- `percolation.conf`：在 `stars-page.com` 的 443 server 里把 `/Percolation/` 去前缀转到 `127.0.0.1:8710`，`/percolation`、`/Percolation` 跳转到带斜杠的正式地址，读超时 180 秒。
- `ningjing-previews.conf`：只在 IP 直连的 80 default_server 里，把 `/ningjing/*` 转到备选方案预览 3011..3015。
