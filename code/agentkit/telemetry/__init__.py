"""轨迹落盘与导出。

- TraceStore：本地/NAS 文件仓，是轨迹的唯一真相源（zstd 压缩、超长文本 CAS 去重、月度索引）。
- OtlpExporter：把同一份轨迹转成 OTLP protobuf（OpenInference + GenAI 语义约定）推给
  Phoenix / Langfuse / 任何 OTel 后端。导出失败不影响落盘。
"""

from agentkit.telemetry.otlp import OtlpExporter, build_export_request
from agentkit.telemetry.store import TraceStore

__all__ = ["OtlpExporter", "TraceStore", "build_export_request"]
