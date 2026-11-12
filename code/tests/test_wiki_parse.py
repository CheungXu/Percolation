from datetime import date
from pathlib import Path

from percolation.memory_fs import memory_validators
from percolation.wiki import (
    WikiLink,
    effective_facets_catalog,
    format_facets_taxonomy,
    load_facets_catalog,
    lookup_link,
    parse_page,
    resolve_link_targets,
)

LEGACY_PAGE = """---
title: 数码外设与待购清单
aliases: [便携显示器, 外接副屏]
---
# 数码外设与待购清单

## 待购比价
- [confirmed] CFORCE 15.6 寸 OLED 便携屏，目标价 999 元 [#msg_12]
- [inferred] 可能配合 [[home-study-desk|书房改造]] 使用 [#msg_13] [#msg_15]

## 已入手
- [inferred] 支架可能已经买了 [#msg_20]
"""

MULTIDIM_PAGE = """---
title: 常用学习网站与课程收藏
type: resource
aliases: [网课, 自学网站]
facets:
  domain: [学习, 编程]
---

## 计算机基础
- [confirmed] MIT Missing Semester 课程主页，周末刷完前两讲 [form:网站] [topic:命令行] [status:进行中] [@2026-11-15] [#msg_42]
- [confirmed] CSAPP 第三版配套实验 [form:文档书籍] [@2026-11-20..2026-12-01] [[belongs_to::cs-self-study|计算机自学]] [#msg_45] [#msg_46]
- [inferred] 准备替代旧笔记工作流 replaces::[[old-notes]] [无效日期] [@2026-02-30] [课程主页](https://missing.csail.mit.edu) [#msg_48]
"""


def test_legacy_page_backward_compatibility():
    page = parse_page("wiki/digital-gear.md", LEGACY_PAGE)
    assert page.title == "数码外设与待购清单"
    assert page.page_type == "topic"
    assert page.facets == {}
    assert page.aliases == ["便携显示器", "外接副屏"]
    assert [c.section_heading for c in page.chunks] == ["待购比价", "已入手"]
    assert page.chunks[0].source_msg_seqs == [12, 13, 15]
    assert page.chunks[0].certainty == "confirmed"
    assert page.chunks[1].certainty == "inferred"
    assert page.links == [WikiLink("home-study-desk", "书房改造", "related")]
    assert page.source_msg_seqs == [12, 13, 15, 20]
    assert len(page.chunks[0].content_hash) == 64


def test_multidim_facets_events_and_typed_links():
    page = parse_page("wiki/learning-sites.md", MULTIDIM_PAGE)
    assert page.page_type == "resource"
    assert page.frontmatter_facets == {"domain": ["学习", "编程"]}
    # 页面级 facets 聚合了 frontmatter 与页内条目的行内维度，但不串扰各条目自身注解
    assert page.facets == {
        "domain": ["学习", "编程"],
        "form": ["网站", "文档书籍"],
        "status": ["进行中"],
        "topic": ["命令行"],
    }
    assert len(page.item_annotations) == 3
    first, second, third = page.item_annotations
    assert first.msg_seqs == [42]
    assert first.facets == {"domain": ["学习", "编程"], "form": ["网站"], "status": ["进行中"], "topic": ["命令行"]}
    assert first.event_start == date(2026, 11, 15) and first.event_end == date(2026, 11, 15)

    assert second.msg_seqs == [45, 46]
    assert second.facets == {"domain": ["学习", "编程"], "form": ["文档书籍"]}
    assert second.event_start == date(2026, 11, 20) and second.event_end == date(2026, 12, 1)

    # 非法公历日期 2026-02-30 与 Markdown 外链被安全忽略，不会污染事件时间或维度
    assert third.msg_seqs == [48]
    assert third.event_start is None and third.event_end is None
    assert third.facets == {"domain": ["学习", "编程"]}

    assert page.links == [
        WikiLink("cs-self-study", "计算机自学", "belongs_to"),
        WikiLink("old-notes", "old-notes", "replaces"),
    ]
    assert "domain=学习,编程" in page.chunks[0].embed_text
    assert "form 网站" in page.chunks[0].facet_text


def test_facet_change_invalidates_chunk_hash():
    base = parse_page("wiki/a.md", "---\ntitle: A\nfacets:\n  domain: [学习]\n---\n- [confirmed] x [#msg_1]")
    changed = parse_page("wiki/a.md", "---\ntitle: A\nfacets:\n  domain: [工作]\n---\n- [confirmed] x [#msg_1]")
    assert base.chunks[0].content_hash != changed.chunks[0].content_hash


def test_facets_catalog_and_user_extension():
    config_dir = Path(__file__).resolve().parents[2] / "config"
    base = load_facets_catalog(config_dir)
    merged = effective_facets_catalog(base, "# 自定义词\n- topic: 强化学习, 编译器\n- 形态: 播客\n")
    assert "强化学习" in merged["dimensions"]["topic"]["values"]
    assert "播客" in merged["dimensions"]["form"]["values"]
    prompt_text = format_facets_taxonomy(merged)
    assert "domain（主题域）" in prompt_text and "强化学习" in prompt_text


def test_link_resolution_by_stem_title_alias():
    pages = [
        parse_page("wiki/digital-gear.md", LEGACY_PAGE),
        parse_page("wiki/home-study-desk.md", "---\ntitle: 书房改造\n---\n- x"),
    ]
    index = resolve_link_targets(pages)
    assert lookup_link(index, "home-study-desk") == "wiki/home-study-desk.md"
    assert lookup_link(index, "书房改造") == "wiki/home-study-desk.md"
    assert lookup_link(index, "便携显示器") == "wiki/digital-gear.md"
    assert lookup_link(index, "不存在") is None


def test_memory_validators():
    memory_rules, path_rules = memory_validators(3)
    assert memory_rules("MEMORY.md", "a\nb\nc\nd")
    assert memory_rules("MEMORY.md", "- [inferred] x")
    assert memory_rules("MEMORY.md", "- 老张：供应商") is None
    assert path_rules("wiki/数码.md", "")
    assert path_rules("wiki/digital-gear.md", "") is None
    assert path_rules("MEMORY_CACHE/sub/x.md", "")


def test_chunk_facets_isolation_and_inferred_no_bleed():
    md = """---
title: 小黑与课程备注
type: person
facets:
  domain: [家庭]
---

## 基本信息
- [confirmed] 小黑是用户家的猫 [#msg_1]

## 医疗与猜测
- [confirmed] 周六上午打疫苗 [form:约定日程] [status:待办] [@2026-11-21] [#msg_2]
- [inferred] 顺便去旁边电脑城看显示器 [domain:数码] [form:硬件外设] [#msg_2]
"""
    page = parse_page("wiki/xiaohei.md", md)
    # 1. [inferred] 推测行上的异类标签不得污染整页 facets
    assert page.facets == {"domain": ["家庭"], "form": ["约定日程"], "status": ["待办"]}
    # 2. 切片级维度严格按小节隔离：基本信息小节不含约定日程，医疗小节不含数码/硬件外设
    assert page.chunks[0].facets == {"domain": ["家庭"]}
    assert page.chunks[1].facets == {"domain": ["家庭"], "form": ["约定日程"], "status": ["待办"]}
    # 3. 原话级注解中 [inferred] 行不会把 #msg_2 标成硬件外设
    msg2_dims = {dim: vals for item in page.item_annotations if 2 in item.msg_seqs for dim, vals in item.facets.items()}
    assert "硬件外设" not in msg2_dims.get("form", [])


def test_chinese_dim_key_mapping_and_unknown_cjk_fallback():
    md = """---
title: 编程语言笔记
---
- [confirmed] 学 Rust 所有权 [主题:系统编程] [语言:Rust] [#msg_9]
"""
    page = parse_page("wiki/rust.md", md)
    # "主题" 映射到 topic 而非 domain；未内置短中文键 "语言" 收拢进 topic 而不静默丢失
    assert "domain" not in page.facets
    assert page.facets["topic"] == ["系统编程", "语言:Rust"]
