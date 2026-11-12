"""主题页的确定性解析与受控维度词表。格式约定见 skills/wiki-format/SKILL.md。"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

MAX_CHUNK_CHARS = 1200
MSG_ANCHOR_RE = re.compile(r"#msg_(\d+)")
CERTAINTY_RE = re.compile(r"\[(confirmed|inferred)\]")
# 兼容 [[rel::target#sec|anchor]]、rel::[[target|anchor]] 与普通 [[target|anchor]]
LINK_RE = re.compile(
    r"(?:([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]{0,30})::)?"
    r"\[\[(?:([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]{0,30})::)?"
    r"([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]"
)
# 行内维度 [dim:val]，避开 [[wiki链]]、[文本](url)、[#msg_N]、[@date]
INLINE_FACET_RE = re.compile(
    r"(?<!\[)\[([A-Za-z\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]{0,30})\s*[:：]\s*([^\]\n]+?)\](?!\(|\[)"
)
EVENT_DATE_RE = re.compile(r"\[@(\d{4}-\d{2}-\d{2})(?:(?:\.\.|~)(\d{4}-\d{2}-\d{2}))?\]")
USER_FACET_LINE_RE = re.compile(r"^\s*[-*]?\s*([A-Za-z\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]{0,30})\s*[:：]\s*(.+)$")

DIM_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
CJK_DIM_KEY_RE = re.compile(r"^[\u4e00-\u9fff]{1,8}$")
REL_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")

VALID_PAGE_TYPES = ("topic", "entity", "person", "project", "resource", "event")
PAGE_TYPE_ALIASES = {
    "主题": "topic",
    "实体": "entity",
    "物品": "entity",
    "人物": "person",
    "联系人": "person",
    "宠物": "person",
    "项目": "project",
    "资源": "resource",
    "收藏": "resource",
    "事件": "event",
    "日程": "event",
}

VALID_REL_TYPES = ("belongs_to", "part_of", "uses", "replaces", "about", "related")
REL_TYPE_ALIASES = {
    "属于": "belongs_to",
    "归属": "belongs_to",
    "组成部分": "part_of",
    "部分": "part_of",
    "使用": "uses",
    "依赖": "uses",
    "替代": "replaces",
    "替换": "replaces",
    "涉及": "about",
    "关于": "about",
    "关联": "related",
    "相关": "related",
}

DIM_KEY_ALIASES = {
    "主题域": "domain",
    "领域": "domain",
    "分类": "domain",
    "形态": "form",
    "载体": "form",
    "载体形态": "form",
    "媒介": "form",
    "状态": "status",
    "进度": "status",
    "话题": "topic",
    "主题": "topic",
    "细分": "topic",
    "细分话题": "topic",
    "标签": "topic",
}
IGNORED_DIM_KEYS = {"http", "https", "mailto", "tel", "msg"}

DEFAULT_FACETS_CATALOG: dict[str, Any] = {
    "page_types": {
        "topic": "长期主题汇编",
        "entity": "具体物品或专有对象",
        "person": "人物或宠物",
        "project": "持续项目",
        "resource": "网站、工具或资料收藏",
        "event": "日程或事件",
    },
    "relation_types": {
        "belongs_to": "属于/上下位",
        "part_of": "组成部分",
        "uses": "使用/依赖",
        "replaces": "替代",
        "about": "涉及人物或项目",
        "related": "一般相关",
    },
    "dimensions": {
        "domain": {"label": "主题域", "values": ["工作", "学习", "生活", "健康", "财务", "数码", "家庭", "出行", "娱乐"]},
        "form": {"label": "载体形态", "values": ["网站", "工具软件", "硬件外设", "文档书籍", "图片视频", "账号凭据", "线下地点", "约定日程"]},
        "status": {"label": "状态", "values": ["想法", "待办", "进行中", "待购", "在用", "已完成", "已放弃"]},
        "topic": {"label": "细分话题", "values": []},
    },
}


@dataclass(frozen=True)
class WikiLink:
    target: str
    anchor: str
    rel_type: str = "related"


@dataclass
class ItemAnnotation:
    msg_seqs: list[int]
    facets: dict[str, list[str]] = field(default_factory=dict)
    event_start: date | None = None
    event_end: date | None = None


@dataclass
class WikiChunk:
    chunk_index: int
    section_heading: str
    content: str
    certainty: str
    source_msg_seqs: list[int]
    facets: dict[str, list[str]] = field(default_factory=dict)
    facet_text: str = ""
    embed_text: str = ""
    content_hash: str = ""


@dataclass
class WikiPage:
    doc_path: str
    title: str
    aliases: list[str]
    chunks: list[WikiChunk]
    page_type: str = "topic"
    frontmatter_facets: dict[str, list[str]] = field(default_factory=dict)
    facets: dict[str, list[str]] = field(default_factory=dict)
    links: list[WikiLink] = field(default_factory=list)
    item_annotations: list[ItemAnnotation] = field(default_factory=list)
    mtime: datetime | None = None

    @property
    def source_msg_seqs(self) -> list[int]:
        seqs = {seq for chunk in self.chunks for seq in chunk.source_msg_seqs}
        seqs.update(seq for item in self.item_annotations for seq in item.msg_seqs)
        return sorted(seqs)


def normalize_page_type(raw: Any) -> str:
    value = str(raw or "").strip().lower().replace("-", "_")
    value = PAGE_TYPE_ALIASES.get(value, value)
    return value if value in VALID_PAGE_TYPES else "topic"


def normalize_rel_type(raw: Any) -> str:
    value = str(raw or "").strip().lower().replace("-", "_")
    value = REL_TYPE_ALIASES.get(value, value)
    if not value or not REL_KEY_RE.match(value):
        return "related"
    return value if value in VALID_REL_TYPES else value


def normalize_dim_key(raw: Any) -> str | None:
    key = str(raw or "").strip().lower().replace("-", "_")
    key = DIM_KEY_ALIASES.get(key, key)
    if not key or key in IGNORED_DIM_KEYS or not DIM_KEY_RE.match(key):
        return None
    return key


def _normalize_dim_pair(raw_key: Any, raw_vals: Any) -> tuple[str | None, list[str]]:
    """标准化维度键值；未内置别名但合法的简短中文键（如 [语言:Rust]）收拢到 topic，避免静默丢失。"""
    vals = _clean_values(raw_vals)
    if not vals:
        return None, []
    key = normalize_dim_key(raw_key)
    if key:
        return key, vals
    raw_str = str(raw_key or "").strip()
    if CJK_DIM_KEY_RE.match(raw_str) and raw_str not in IGNORED_DIM_KEYS:
        prefixed = [f"{raw_str}:{v}" for v in vals if len(f"{raw_str}:{v}") <= 64]
        return ("topic", prefixed) if prefixed else (None, [])
    return None, []


def _clean_values(raw: Any) -> list[str]:
    if raw is None:
        return []
    items = raw if isinstance(raw, list | tuple | set) else re.split(r"[,，、]", str(raw))
    cleaned: list[str] = []
    for item in items:
        text = str(item).strip()
        if text and len(text) <= 64 and text not in cleaned:
            cleaned.append(text)
    return cleaned


def merge_facets(*maps: dict[str, Any]) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    for mapping in maps:
        for raw_key, raw_vals in (mapping or {}).items():
            key, vals = _normalize_dim_pair(raw_key, raw_vals)
            if not key:
                continue
            bucket = merged.setdefault(key, [])
            for val in vals:
                if val not in bucket:
                    bucket.append(val)
    return {k: merged[k] for k in sorted(merged) if merged[k]}


def parse_frontmatter_facets(raw: Any) -> dict[str, list[str]]:
    if isinstance(raw, dict):
        return merge_facets(raw)
    if isinstance(raw, list):
        parsed: dict[str, list[str]] = {}
        for entry in raw:
            text = str(entry)
            if ":" in text or "：" in text:
                k, v = re.split(r"[:：]", text, maxsplit=1)
                key, vals = _normalize_dim_pair(k, v)
                if key:
                    parsed.setdefault(key, []).extend(vals)
        return merge_facets(parsed)
    return {}


def parse_inline_facets(text: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for match in INLINE_FACET_RE.finditer(text):
        key, vals = _normalize_dim_pair(match.group(1), match.group(2))
        if not key:
            continue
        found.setdefault(key, []).extend(vals)
    return merge_facets(found)


def parse_event_dates(text: str) -> tuple[date | None, date | None]:
    for match in EVENT_DATE_RE.finditer(text):
        try:
            start = date.fromisoformat(match.group(1))
            end = date.fromisoformat(match.group(2)) if match.group(2) else start
        except ValueError:
            continue
        return (end, start) if end < start else (start, end)
    return None, None


def format_facets_summary(facets: dict[str, list[str]]) -> str:
    if not facets:
        return ""
    return "；".join(f"{dim}={','.join(vals)}" for dim, vals in sorted(facets.items()) if vals)


def split_frontmatter(text: str) -> tuple[dict, str]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            try:
                meta = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                meta = {}
            return (meta if isinstance(meta, dict) else {}), parts[2]
    return {}, text


def _split_items(text: str) -> list[str]:
    """把小节拆成逻辑条目块（列表项及其续行，或独立段落）。"""
    blocks = re.split(r"\n(?=\s*(?:[-*]|\d+\.) |\s*$)", text)
    return [block.strip() for block in blocks if block.strip()]


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    pieces: list[str] = []
    current = ""
    for block in re.split(r"\n(?=\s*[-*] |\n)", text):
        if current and len(current) + len(block) > MAX_CHUNK_CHARS:
            pieces.append(current.strip())
            current = ""
        current += ("\n" if current else "") + block
    if current.strip():
        pieces.append(current.strip())
    return [piece for piece in pieces if piece]


def _is_pure_inferred(text: str) -> bool:
    markers = CERTAINTY_RE.findall(text)
    return bool(markers) and all(marker == "inferred" for marker in markers)


def _confirmed_inline_facets_in_piece(piece: str) -> dict[str, list[str]]:
    """只提取块内非纯 inferred 条目的行内维度；若整块全是 inferred 则退回块内自身标签。"""
    items = _split_items(piece)
    confirmed = [parse_inline_facets(it) for it in items if not _is_pure_inferred(it)]
    if confirmed:
        return merge_facets(*confirmed)
    return parse_inline_facets(piece) if _is_pure_inferred(piece) else {}


def parse_page(doc_path: str, text: str, mtime: datetime | None = None) -> WikiPage:
    meta, body = split_frontmatter(text)
    title = str(meta.get("title") or "").strip()
    page_type = normalize_page_type(meta.get("type"))
    raw_aliases = meta.get("aliases") or []
    if isinstance(raw_aliases, str):
        raw_aliases = re.split(r"[,，、]", raw_aliases)
    aliases = [str(item).strip() for item in raw_aliases if str(item).strip()]
    fm_facets = parse_frontmatter_facets(meta.get("facets"))

    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in body.splitlines():
        if line.startswith("## "):
            sections.append((line[3:].strip(), []))
        elif line.startswith("# ") and len(sections) == 1:
            title = title or line[2:].strip()
        else:
            sections[-1][1].append(line)
    title = title or PurePosixPath(doc_path).stem

    confirmed_inline_facets: list[dict[str, list[str]]] = []
    annotations: list[ItemAnnotation] = []
    for _, lines in sections:
        section_body = "\n".join(lines).strip()
        if not section_body:
            continue
        for item_block in _split_items(section_body):
            inferred_only = _is_pure_inferred(item_block)
            inline_facets = parse_inline_facets(item_block)
            if inline_facets and not inferred_only:
                confirmed_inline_facets.append(inline_facets)
            seqs = sorted({int(value) for value in MSG_ANCHOR_RE.findall(item_block)})
            if not seqs:
                continue
            ev_start, ev_end = parse_event_dates(item_block)
            # 纯 inferred 顺带推测行不把异类行内标签外溢到原话级 message_facets
            combined_facets = fm_facets if inferred_only else merge_facets(fm_facets, inline_facets)
            if combined_facets or ev_start is not None:
                annotations.append(
                    ItemAnnotation(msg_seqs=seqs, facets=combined_facets, event_start=ev_start, event_end=ev_end)
                )

    page_facets = merge_facets(fm_facets, *confirmed_inline_facets)

    chunks: list[WikiChunk] = []
    for heading, lines in sections:
        content = "\n".join(lines).strip()
        if not content:
            continue
        for piece in _split_long(content):
            certainty = "inferred" if _is_pure_inferred(piece) else "confirmed"
            seqs = sorted({int(value) for value in MSG_ANCHOR_RE.findall(piece)})
            chunk_facets = merge_facets(fm_facets, _confirmed_inline_facets_in_piece(piece))
            facet_tokens = " ".join(f"{dim} {' '.join(vals)}" for dim, vals in chunk_facets.items())
            facet_summary = format_facets_summary(chunk_facets)
            alias_text = f"（{'、'.join(aliases)}）" if aliases else ""
            meta_line = f"[{page_type}" + (f" | {facet_summary}" if facet_summary else "") + "]"
            embed_text = f"{title}{alias_text} {meta_line}\n{heading}\n{piece}".strip()
            digest = hashlib.sha256(
                f"{embed_text}\x00{page_type}\x00{facet_summary}\x00{certainty}\x00{seqs}".encode()
            ).hexdigest()
            chunks.append(
                WikiChunk(
                    chunk_index=len(chunks),
                    section_heading=heading,
                    content=piece,
                    certainty=certainty,
                    source_msg_seqs=seqs,
                    facets=chunk_facets,
                    facet_text=facet_tokens,
                    embed_text=embed_text,
                    content_hash=digest,
                )
            )

    links: list[WikiLink] = []
    seen: set[tuple[str, str]] = set()
    for match in LINK_RE.finditer(body):
        rel = normalize_rel_type(match.group(2) or match.group(1) or "related")
        target = match.group(3).strip()
        anchor = (match.group(4) or target).strip()
        if target and (target, rel) not in seen:
            seen.add((target, rel))
            links.append(WikiLink(target=target, anchor=anchor, rel_type=rel))

    return WikiPage(
        doc_path=doc_path,
        title=title,
        aliases=aliases,
        chunks=chunks,
        page_type=page_type,
        frontmatter_facets=fm_facets,
        facets=page_facets,
        links=links,
        item_annotations=annotations,
        mtime=mtime,
    )


def resolve_link_targets(pages: list[WikiPage]) -> dict[str, str]:
    """把 [[目标]] 的各种写法（文件名、路径、标题、别名）映射到 doc_path。"""
    index: dict[str, str] = {}
    for page in pages:
        stem = PurePosixPath(page.doc_path).stem
        for key in [page.doc_path, page.doc_path.removeprefix("wiki/"), stem, page.title, *page.aliases]:
            index.setdefault(_norm(key), page.doc_path)
    return index


def _norm(value: str) -> str:
    value = value.strip().lower().removeprefix("wiki/")
    return value[:-3] if value.endswith(".md") else value


def lookup_link(index: dict[str, str], target: str) -> str | None:
    return index.get(_norm(target))


def load_facets_catalog(config_dir: Path | None = None) -> dict[str, Any]:
    if config_dir is not None:
        path = Path(config_dir) / "facets.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return json.loads(json.dumps(DEFAULT_FACETS_CATALOG, ensure_ascii=False))


def parse_user_facets_file(text: str) -> dict[str, list[str]]:
    """解析工作区 MEMORY_CACHE/facets.md 中的用户自定义维度值。"""
    custom: dict[str, list[str]] = {}
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = USER_FACET_LINE_RE.match(stripped)
        if not match:
            continue
        key, vals = _normalize_dim_pair(match.group(1), match.group(2))
        if key:
            custom.setdefault(key, []).extend(vals)
    return merge_facets(custom)


def effective_facets_catalog(base_catalog: dict[str, Any], user_facets_md: str = "") -> dict[str, Any]:
    """合并全局 config/facets.json 与用户工作区的自定义维度值。"""
    catalog = json.loads(json.dumps(base_catalog or DEFAULT_FACETS_CATALOG, ensure_ascii=False))
    dims = catalog.setdefault("dimensions", {})
    custom = parse_user_facets_file(user_facets_md)
    for key, vals in custom.items():
        entry = dims.setdefault(key, {"label": key, "values": []})
        existing = entry.setdefault("values", [])
        for val in vals:
            if val not in existing:
                existing.append(val)
    return catalog


def format_facets_taxonomy(catalog: dict[str, Any]) -> str:
    """生成注入给 Router / Dreaming 的紧凑维度词表说明。"""
    dims = (catalog or {}).get("dimensions") or {}
    lines = []
    for key, info in dims.items():
        label = info.get("label") or key
        vals = "、".join(info.get("values") or []) or "（按具体话题自由填写，优先复用已有词）"
        lines.append(f"- {key}（{label}）：{vals}")
    return "\n".join(lines)
