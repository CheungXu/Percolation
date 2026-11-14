# code

Percolation 的实现代码，一个 Python 工程（`pyproject.toml`），包含两个包：

- `agentkit/`：通用 agent 内核，不依赖业务，内置轨迹（span 树、成本、护栏）与 `telemetry/` 落盘/OTLP 导出。见 `agentkit/README.md`。
- `percolation/`：记忆系统业务层，Search Agent 和 Dreaming Agent，以及 HTTP 接口与网页端服务支撑（`product/`）。见 `percolation/README.md`。
- `web/`：面向用户的产品「拾记凝境」网页（原生 JS，无构建），由 `percolation.api` 托管，线上 <https://stars-page.com/Percolation/>。见 `web/README.md`。
- `console/`：Percolation 运维控制台（融合版，原生 JS，无构建），由 `percolation.api` 托管在 `https://stars-page.com/Percolation/console/`，仅白名单手机号可见。见 `console/README.md`。
- `db/`：数据库扩展、表结构、受控函数和连接约定。
- `tests/`：单测和连库测试。

## 环境

```bash
cd code
python3 -m venv .venv
.venv/bin/pip install -e '.[dev,obs]'   # obs 额外装 duckdb，供 script/trace_cli.py stats/sql 使用
.venv/bin/pytest -q
```

`.venv/` 不进版本库。运行配置都在仓库根目录的 `config/`。
