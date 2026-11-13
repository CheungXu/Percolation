#!/usr/bin/env python3
"""NAS 轨迹仓查询工具（只读，导出命令除外）。

  trace_cli.py list [--name search] [--status failed] [--user default] [--limit 20]
  trace_cli.py show <trace_id前缀> [--payload] [--messages AGENT]
  trace_cli.py hydrate <trace_id前缀> [-o out.json]      还原外置原文，输出完整 JSON
  trace_cli.py stats [--month 2026-11]                   DuckDB 汇总：按运行类型/天/模型/agent 指纹
  trace_cli.py sql "SELECT name, count(*) FROM runs GROUP BY 1"   对索引跑任意 DuckDB SQL
  trace_cli.py export-otlp <trace_id前缀...> | --since 2026-11-13   回放到 Phoenix（OTLP）
  trace_cli.py du                                         轨迹仓占用
  trace_cli.py reproduce <trace_id前缀> [--runs 3] [--keep] [--json]   按执行环境锚点复现一次检索/整理
  trace_cli.py purge --tenant <user_id> [--dry-run]       删某租户全部轨迹并清扫无人引用的 blob

list / stats 默认不含复现产生的回放轨迹（metadata.replay_of），加 --include-replays 才包含。
运行：code/.venv/bin/python script/trace_cli.py ...
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "code"))

from agentkit.telemetry import OtlpExporter, TraceStore  # noqa: E402
from agentkit.telemetry.otlp import parse_headers  # noqa: E402
from percolation.config import load_settings  # noqa: E402


def open_store() -> tuple[TraceStore, object]:
    settings = load_settings(ROOT)
    return TraceStore(settings.telemetry.root), settings


def fmt_cost(value) -> str:
    return "-" if value in (None, 0) else f"¥{value:.4f}"


def is_replay(row: dict) -> bool:
    return bool(row.get("metadata", {}).get("replay_of"))


def cmd_list(args) -> None:
    store, _ = open_store()
    rows = [
        row
        for row in store.iter_index()
        if (not args.name or row["name"] == args.name)
        and (not args.status or row["status"] == args.status)
        and (not args.user or row["metadata"].get("user_slug") == args.user)
        and (args.include_replays or not is_replay(row))
    ]
    rows.sort(key=lambda row: row["started_at"], reverse=True)
    print(f"{'trace_id':12} {'started_at':19} {'name':7} {'status':14} {'ms':>7} {'llm':>4} {'tool':>4} {'tokens':>8} {'cost':>9}  user")
    for row in rows[: args.limit]:
        usage = row["usage"]
        tokens = usage["input_tokens"] + usage["output_tokens"]
        print(
            f"{row['trace_id'][:12]} {row['started_at'][:19]} {row['name']:7} {row['status']:14} {row['duration_ms']:>7} "
            f"{row['llm_calls']:>4} {row['tool_calls']:>4} {tokens:>8} {fmt_cost(row['cost']):>9}  {row['metadata'].get('user_slug', '')}"
        )


def _short(value, limit: int = 160) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = text.replace("\n", "⏎ ")
    return text if len(text) <= limit else text[:limit] + f"…(+{len(text) - limit})"


def cmd_show(args) -> None:
    store, _ = open_store()
    data = store.load(args.trace_id, hydrate=bool(args.payload or args.messages))
    usage = data["usage"]
    print(f"{data['name']} {data['trace_id']} · {data['status']} · {data['started_at'][:19]} · {data['duration_ms']} ms")
    print(f"tokens in {usage['input_tokens']} (cached {usage['cached_input_tokens']}) / out {usage['output_tokens']} (reasoning {usage['reasoning_tokens']}) · {fmt_cost(data['cost']['total'])}")
    for model, entry in data["usage_by_model"].items():
        u = entry["usage"]
        print(f"  · {model}: {u['calls']} 次 · in {u['input_tokens']} / out {u['output_tokens']} · {fmt_cost(entry['cost'])}")
    if data["summary"]:
        print("summary:", _short(data["summary"], 400))
    if data["metadata"].get("replay_of"):
        print(f"回放：replay_of={data['metadata']['replay_of']} run={data['metadata'].get('replay_run')}")
    root_attrs = next((s for s in data["spans"] if s.get("parent_id") is None), {}).get("attributes", {})
    if root_attrs.get("env_digest"):
        print(f"环境：digest={root_attrs['env_digest']} · {_short(root_attrs.get('env_watermark'), 300)}")

    children = defaultdict(list)
    for span in data["spans"]:
        children[span.get("parent_id")].append(span)

    def describe(span) -> str:
        a = span["attributes"]
        bits = [f"{span['duration_ms']}ms" if span.get("duration_ms") is not None else ""]
        if span.get("usage"):
            u = span["usage"]
            bits.append(f"{u['input_tokens']}→{u['output_tokens']}tok")
        if span.get("cost"):
            bits.append(fmt_cost(span["cost"]))
        if span["kind"] == "agent":
            bits.append(f"fp={a.get('spec_fingerprint')} turns={a.get('turns')}")
        if span["kind"] == "llm":
            bits.append(f"finish={a.get('finish_reason')}" + (f" calls={a.get('tool_call_names')}" if a.get("tool_call_names") else ""))
        if span["kind"] == "tool":
            bits.append(_short(a.get("arguments", ""), 100))
            if a.get("truncated"):
                bits.append(f"原文{a.get('output_chars')}字/回灌{a.get('fed_chars')}字")
            if a.get("blocked"):
                bits.append("已拦截")
        if span["kind"] == "retrieval":
            bits.append(f"hits={a.get('hits')} reranked={a.get('reranked')}")
        if span["status"] == "error":
            bits.append(f"✗ {_short(span.get('error', ''), 120)}")
        return " · ".join(bit for bit in bits if bit)

    def walk(span, depth: int) -> None:
        print(f"{'  ' * depth}{'└ ' if depth else ''}[{span['kind']}] {span['name']}  {describe(span)}")
        if args.payload and span.get("payload"):
            payload = span["payload"]
            if span["kind"] == "llm":
                output = payload.get("output", {})
                if output.get("reasoning"):
                    print(f"{'  ' * (depth + 2)}思考: {_short(output['reasoning'], 300)}")
                if output.get("content"):
                    print(f"{'  ' * (depth + 2)}回复: {_short(output['content'], 300)}")
            elif span["kind"] == "tool":
                print(f"{'  ' * (depth + 2)}原文: {_short(payload.get('output', ''), 300)}")
        for child in children.get(span["span_id"], []):
            walk(child, depth + 1)

    for root in children[None]:
        walk(root, 0)

    if args.messages:
        agent = next((s for s in data["spans"] if s["kind"] == "agent" and s["name"] == args.messages), None)
        if agent is None:
            sys.exit(f"轨迹里没有 agent {args.messages}")
        print(f"\n===== {args.messages} 完整 messages =====")
        for index, message in enumerate(agent["payload"].get("messages", [])):
            print(f"\n--- [{index}] {message['role']} {message.get('tool_call_id', '')}")
            if message.get("content"):
                print(message["content"])
            for call in message.get("tool_calls") or []:
                print(f"→ {call['function']['name']}({call['function']['arguments']})")


def cmd_hydrate(args) -> None:
    store, _ = open_store()
    data = store.hydrate_assets(store.load(args.trace_id))
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"已写出 {args.output}（{len(text)} 字）")
    else:
        print(text)


def _duck(store: TraceStore):
    import duckdb

    pattern = str(store.root / "index" / "*.runs.jsonl")
    con = duckdb.connect()
    con.execute(f"CREATE VIEW runs AS SELECT * FROM read_ndjson_auto('{pattern}', union_by_name=true)")
    return con


def _print_rows(cursor) -> None:
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) if rows else len(str(c)) for i, c in enumerate(columns)]
    print("  ".join(str(c).ljust(w) for c, w in zip(columns, widths, strict=True)))
    for row in rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(row, widths, strict=True)))


def cmd_stats(args) -> None:
    store, _ = open_store()
    con = _duck(store)
    conditions = []
    if args.month:
        conditions.append(f"strftime(started_at::TIMESTAMPTZ, '%Y-%m') = '{args.month}'")
    if not args.include_replays:
        conditions.append("json_extract_string(to_json(metadata), '$.replay_of') IS NULL")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    print("== 按运行类型 ==")
    _print_rows(
        con.execute(
            f"""
            SELECT name, count(*) AS runs, sum(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) AS failed,
                   round(avg(duration_ms)) AS avg_ms, round(quantile_cont(duration_ms, 0.95)) AS p95_ms,
                   round(avg(llm_calls), 1) AS avg_llm, round(avg(tool_calls), 1) AS avg_tools,
                   sum(tool_errors) AS tool_errors, sum(blocked_calls) AS blocked,
                   sum(usage.input_tokens + usage.output_tokens) AS tokens, round(sum(cost), 4) AS cost_cny
            FROM runs {where} GROUP BY name ORDER BY runs DESC
            """
        )
    )
    print("\n== 按天 ==")
    _print_rows(
        con.execute(
            f"""
            SELECT strftime(started_at::TIMESTAMPTZ, '%Y-%m-%d') AS day, name, count(*) AS runs, round(sum(cost), 4) AS cost_cny,
                   sum(usage.input_tokens + usage.output_tokens) AS tokens
            FROM runs {where} GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 60
            """
        )
    )
    print("\n== 按结果 ==")
    _print_rows(con.execute(f"SELECT name, status, count(*) AS runs FROM runs {where} GROUP BY 1, 2 ORDER BY 1, 3 DESC"))

    # 模型、agent 指纹的键是动态的，用 Python 汇总更稳。
    models: dict[str, dict] = defaultdict(lambda: {"calls": 0, "in": 0, "out": 0, "cost": 0.0})
    fingerprints: dict[tuple[str, str], int] = defaultdict(int)
    for row in store.iter_index([args.month] if args.month else None):
        if is_replay(row) and not args.include_replays:
            continue
        for model, entry in row["usage_by_model"].items():
            item = models[model]
            item["calls"] += entry["usage"]["calls"]
            item["in"] += entry["usage"]["input_tokens"]
            item["out"] += entry["usage"]["output_tokens"]
            item["cost"] += entry["cost"] or 0
        for agent, fp in row["fingerprints"].items():
            fingerprints[(agent, fp)] += 1
    print("\n== 按模型 ==")
    for model, item in sorted(models.items(), key=lambda kv: -kv[1]["cost"]):
        print(f"{model:16} calls {item['calls']:>6} · in {item['in']:>9} · out {item['out']:>8} · {fmt_cost(item['cost'])}")
    print("\n== agent 版本（spec 指纹）==")
    for (agent, fp), count in sorted(fingerprints.items()):
        print(f"{agent:20} {fp}  {count} 次")


def cmd_sql(args) -> None:
    store, _ = open_store()
    _print_rows(_duck(store).execute(args.query))


def cmd_export(args) -> None:
    store, settings = open_store()
    telemetry = settings.telemetry
    if not telemetry.otlp_endpoint:
        sys.exit("config/observability.env 没有配置 OTLP_ENDPOINT")
    exporter = OtlpExporter(
        telemetry.otlp_endpoint,
        headers=parse_headers(telemetry.otlp_headers),
        project=args.project or telemetry.otlp_project,
        service_name="percolation",
    )
    if args.since:
        targets = [row["path"] for row in store.iter_index() if row["started_at"] >= args.since]
        paths = [store.root / rel for rel in targets]
    else:
        paths = [store.find(prefix) for prefix in args.trace_ids]
    for path in paths:
        exporter.export(store.hydrate_assets(store.load(path)))
    print(f"已导出 {len(paths)} 条轨迹到 {telemetry.otlp_endpoint}（project={exporter.project}）")


def cmd_du(args) -> None:
    store, _ = open_store()
    for sub in ("traces", "blobs", "index", "datasets"):
        files = [p for p in (store.root / sub).rglob("*") if p.is_file()]
        print(f"{sub:9} {len(files):>7} 个文件 {sum(p.stat().st_size for p in files) / 1024 / 1024:>9.2f} MiB")


def print_reproduce(report: dict) -> None:
    print(f"复现 {report['name']} {report['trace_id']} · as_of {report['as_of']}")
    print(f"原入参：{_short(report['input'], 200)}")
    for warning in report.get("warnings", []):
        print(f"注意：{warning}")
    base = report["original"]
    print(f"\n[原运行] {_short({k: v for k, v in base.items() if k != 'fingerprints'}, 600)}")
    for run in report["runs"]:
        s = run["summary"]
        diff_keys = [key for key, same in run["same"].items() if not same]
        setup = run["setup"]
        print(
            f"\n[重跑 {run['run']}] trace {str(run['trace_id'])[:12]} · 租户 {run['tenant']} · {fmt_cost(s.get('cost_cny'))} · {s.get('duration_ms')} ms"
        )
        print(
            f"  环境：复制检索日志 {setup['search_logs']} · 原话 {setup['raw_messages']}（pending {setup['pending']}）"
            f" · 主题页 {setup['docs']} · 新算向量 {setup['embedded_fresh']} · 水位一致 {all(run['watermark_match'].values())}"
        )
        if setup.get("unmapped_replies"):
            print(f"  有 {setup['unmapped_replies']} 条原话引用的检索日志不在水位内，关联置空")
        print(f"  一致：{', '.join(k for k, same in run['same'].items() if same) or '无'}")
        if diff_keys:
            print(f"  不同：{', '.join(diff_keys)}")
            for key in diff_keys:
                print(f"    {key}: 原 {_short(base.get(key), 160)} → 现 {_short(s.get(key), 160)}")
        if report["name"] == "search":
            print(f"  回答：{_short(s.get('answer'), 200)}")
        for item in run.get("file_diffs", []):
            if not item["same"]:
                print(f"  文件不同：{item['file']} +{item['added']} -{item['removed']}")
        if run["replay_blocked_tools"]:
            print(f"  回放拦截了 {run['replay_blocked_tools']} 次副作用工具调用")
    print("\n[稳定性] " + " · ".join(f"{key} {count}/{len(report['runs'])}" for key, count in report["stability"].items()))
    if report.get("env_diff"):
        print("\n[环境差异]")
        for item in report["env_diff"]:
            print(f"  {item['key']}: {_short(item['original'], 80)} → {_short(item['replay'], 80)}")
    else:
        print("\n[环境差异] 无（代码、依赖、配置指纹与原运行一致）")
    if report.get("old_code_hint"):
        print("\n" + report["old_code_hint"])
    if report.get("kept_tenants"):
        print(f"\n已保留回放租户：{', '.join(report['kept_tenants'])}（清理：script/e2e_percolation.py --drop <slug>）")


def cmd_reproduce(args) -> None:
    from percolation.replay import ReplayError, reproduce
    from percolation.services import Services

    async def run() -> dict:
        services = await Services.open(load_settings(ROOT))
        try:
            return await reproduce(services, args.trace_id, runs=args.runs, keep=args.keep)
        finally:
            await services.close()

    try:
        report = asyncio.run(run())
    except ReplayError as exc:
        sys.exit(f"无法复现：{exc}")
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    else:
        print_reproduce(report)


def cmd_purge(args) -> None:
    from percolation.tenants import is_disposable

    store, _ = open_store()
    slugs = {row["metadata"].get("user_slug", "") for row in store.iter_index() if row.get("tenant_id") == args.tenant}
    real = sorted(slug for slug in slugs if not is_disposable(slug))
    if real and not args.force:
        sys.exit(f"租户 {real} 不是 e2e-/replay- 临时租户，删除真实用户轨迹需要加 --force")
    result = store.purge(lambda row: row.get("tenant_id") == args.tenant, dry_run=args.dry_run)
    verb = "将删除" if args.dry_run else "已删除"
    print(
        f"{verb}租户 {args.tenant} 的 {result['traces']} 条轨迹（{result['trace_bytes'] / 1024:.1f} KiB），"
        f"无人引用的 blob {result['blobs_deleted']} 个（{result['blob_bytes'] / 1024:.1f} KiB）"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Percolation NAS 轨迹仓查询")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list")
    p.add_argument("--name")
    p.add_argument("--status")
    p.add_argument("--user")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--include-replays", action="store_true", help="包含复现产生的回放轨迹")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show")
    p.add_argument("trace_id")
    p.add_argument("--payload", action="store_true", help="展示思考链、回复与工具原文摘要")
    p.add_argument("--messages", metavar="AGENT", help="打印某个 agent 的完整 messages")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("hydrate")
    p.add_argument("trace_id")
    p.add_argument("-o", "--output")
    p.set_defaults(func=cmd_hydrate)

    p = sub.add_parser("stats")
    p.add_argument("--month", help="YYYY-MM")
    p.add_argument("--include-replays", action="store_true", help="包含复现产生的回放轨迹")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("sql")
    p.add_argument("query")
    p.set_defaults(func=cmd_sql)

    p = sub.add_parser("export-otlp")
    p.add_argument("trace_ids", nargs="*")
    p.add_argument("--since", help="ISO 时间下限，如 2026-11-13")
    p.add_argument("--project")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("du")
    p.set_defaults(func=cmd_du)

    p = sub.add_parser("reproduce", help="按执行环境锚点在临时 replay 租户里重跑并对比")
    p.add_argument("trace_id")
    p.add_argument("--runs", type=int, default=3, help="重跑次数，每次一个全新租户")
    p.add_argument("--keep", action="store_true", help="保留 replay 租户与工作区，便于人工查看")
    p.add_argument("--json", action="store_true", help="输出完整 JSON 报告")
    p.set_defaults(func=cmd_reproduce)

    p = sub.add_parser("purge", help="删除某租户的全部轨迹并清扫 blob")
    p.add_argument("--tenant", required=True, help="租户 user_id（uuid）")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="允许删除非临时租户（真实用户）的轨迹")
    p.set_defaults(func=cmd_purge)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
