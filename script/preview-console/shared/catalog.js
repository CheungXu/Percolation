window.PERC_CATALOG = {
  product: {
    name: "Percolation",
    tagline: "零负担备忘 · 后台成体系 · 极度模糊也能找回",
    layers: [
      { id: "L4", name: "热区", path: "MEMORY.md", rule: "每次检索注入，≤200 行，仅 confirmed" },
      { id: "L3", name: "温区", path: "MEMORY_CACHE/", rule: "低频暗语，首轮未中才静默翻查" },
      { id: "L2", name: "导航", path: "wiki/*.md", rule: "主题页 + 混合索引，绑定 #msg_N" },
      { id: "L1", name: "原话", path: "raw_messages", rule: "只追加，180s 连发同批，不算向量" }
    ]
  },
  stack: [
    { id: "entry", layer: "entry", name: "入口", sub: "CLI · API · Timer", detail: "capture / ask / clarify / dream · /v1/* · 03:30 定时" },
    { id: "search", layer: "biz", name: "Search Agent", sub: "四步在线检索", detail: "路由 → 双轨召回核验 → 候选区穿透 → 最小化追问" },
    { id: "dream", layer: "biz", name: "Dreaming Agent", sub: "五步夜间整理", detail: "脏队列 → 归档 → 索引 → 升降级 → Git 快照" },
    { id: "retriever", layer: "biz", name: "召回 / 索引", sub: "确定性程序", detail: "RRF + Rerank + 一跳邻居 · SHA-256 增量向量" },
    { id: "kit", layer: "kit", name: "agentkit", sub: "157 行循环", detail: "AgentSpec + run_agent · 沙箱 · RLS 事务 · 技能按需加载" },
    { id: "infra", layer: "infra", name: "底座", sub: "NAS · PG 18 · 百炼", detail: "工作区 Git · 强制 RLS · 重叠二字 + trgm + halfvec(1024)" }
  ],
  agents: [
    {
      id: "search",
      name: "Search Agent",
      file: "code/percolation/agents/search.py",
      job: "把模糊提问变成可核验的答案，尽量不打扰人。",
      entry: "search.ask(user, query)",
      slots: ["router_model", "search_model"],
      specs: ["search_router", "search_answer", "search_cache_probe"],
      context: [
        { id: "sys", name: "固定前缀", items: ["节点 system prompt", "输出 JSON Schema"] },
        { id: "hot", name: "L4 热区", items: ["MEMORY.md 全文"] },
        { id: "q", name: "本轮问题", items: ["query", "可选澄清补充"] },
        { id: "ret", name: "预取证据", items: ["双轨召回 Top-6", "同批次原话", "一跳邻居页"] },
        { id: "probe", name: "仅穿透时", items: ["unknown_terms", "候选区命中线索"] }
      ]
    },
    {
      id: "dream",
      name: "Dreaming Agent",
      file: "code/percolation/agents/dream.py",
      job: "把当天原话拼进主题页，按命中热度升降级记忆。",
      entry: "dream.run_for_user(user) / dream --all",
      slots: ["dream_model", "embedding_model"],
      specs: ["dream_archive", "dream_tiering", "dream_tiering_defrag"],
      context: [
        { id: "sys", name: "固定前缀", items: ["节点 system prompt", "wiki-format 一行索引", "输出 JSON Schema"] },
        { id: "hot", name: "只读热区", items: ["MEMORY.md"] },
        { id: "pending", name: "待整理", items: ["pending 原话，按批次 ≤40 条"] },
        { id: "map", name: "现有地图", items: ["主题页清单", "CACHE 文件名"] },
        { id: "heat", name: "仅升降级时", items: ["14 天命中统计", "30 天热区使用", "悬空链接"] }
      ]
    }
  ],
  scopes: {
    search_router: { read: [], write: [], db: false, sandbox: false, del: false, note: "纯推理，不碰文件和库" },
    search_answer: { read: ["wiki/"], write: [], db: true, sandbox: false, del: false, note: "只读本人数据，RLS 隔离" },
    search_cache_probe: { read: ["MEMORY_CACHE/"], write: [], db: false, sandbox: true, del: false, note: "bwrap 只读挂载、断网" },
    dream_archive: { read: ["全部工作区"], write: ["wiki/", "MEMORY_CACHE/"], db: true, sandbox: true, del: false, note: "MEMORY.md 只读" },
    dream_tiering: { read: ["全部工作区"], write: ["MEMORY.md", "MEMORY_CACHE/"], db: false, sandbox: true, del: false, note: "MEMORY.md 写入受 200 行上限校验" },
    dream_tiering_defrag: { read: ["全部工作区"], write: ["MEMORY.md", "MEMORY_CACHE/", "wiki/"], db: false, sandbox: true, del: true, note: "唯一允许删除文件的节点" }
  },
  specMeta: {
    search_router: {
      step: "S1",
      title: "意图路由",
      duty: "扩检索词，标未知暗语。不回答。",
      input: ["MEMORY.md", "提问", "可选澄清"],
      outputHint: "queries · unknown_terms · memory_clues_used · clarify_now",
      boundary: "无工具，单轮。clarify_now 仅当提问完全无检索内容。",
      promptFile: "prompts/search_router.md"
    },
    search_answer: {
      step: "S2",
      title: "核验作答",
      duty: "对照原话给答案。证据够就不要调工具。",
      input: ["热区", "提问", "召回结果", "同批次原话"],
      outputHint: "status · answer · verified_msg_seqs · hit_doc_paths",
      boundary: "hybrid_search · fetch_raw · read_file(wiki)。无 list_dir / bash。",
      promptFile: "prompts/search_answer.md"
    },
    search_cache_probe: {
      step: "S3",
      title: "候选区穿透",
      duty: "在 CACHE 里找暗语，改写检索词。不许猜。",
      input: ["提问", "unknown_terms", "主路径未中原因"],
      outputHint: "found · rewritten_queries · cache_hits · files_probed",
      boundary: "沙箱只挂 MEMORY_CACHE/，看不见热区与 wiki。",
      promptFile: "prompts/search_probe.md"
    },
    dream_archive: {
      step: "D1",
      title: "批次归档",
      duty: "原话并入主题页。本步禁写热区。",
      input: ["MEMORY.md", "主题页清单", "CACHE 文件", "一批 pending 原话"],
      outputHint: "archived_msg_seqs · skipped_msg_seqs · files_changed",
      boundary: "可写 wiki/ 与 MEMORY_CACHE/。先 read_skill(wiki-format)。",
      promptFile: "prompts/dream_archive.md"
    },
    dream_tiering: {
      step: "D3",
      title: "日常升降级",
      duty: "高频 confirmed 晋升热区。inferred 不准进热区。",
      input: ["MEMORY.md", "14 天命中", "30 天使用"],
      outputHint: "promotions · demotions",
      boundary: "可写 MEMORY.md 与 MEMORY_CACHE/。无 delete。",
      promptFile: "prompts/dream_tiering.md"
    },
    dream_tiering_defrag: {
      step: "D3*",
      title: "全局重整",
      duty: "下沉冷条目，合并重复页，修死链。",
      input: ["MEMORY.md", "命中统计", "主题页", "悬空链接"],
      outputHint: "promotions · demotions · merged_pages · fixed_links",
      boundary: "可写热区 / CACHE / wiki，可删文件。触发：行数>180 · 死链≥5 · ≥7 天。",
      promptFile: "prompts/dream_tiering.md"
    }
  },
  searchFlow: [
    { id: "cap", title: "录入", code: "capture_message", note: "180s 同批，dirty_since，不算向量" },
    { id: "s1", title: "路由", spec: "search_router", note: "扩词 · 标未知暗语" },
    { id: "s2", title: "双轨召回", code: "retriever.search", note: "wiki 三路 RRF + pending 原话 → rerank Top-6" },
    { id: "s2b", title: "核验", spec: "search_answer", note: "原话为准 · 够了就直接答" },
    { id: "s3", title: "穿透", spec: "search_cache_probe", note: "仅未答上且 CACHE 非空 · 改写后重跑召回" },
    { id: "s4", title: "追问", code: "clarify()", note: "clarification 入库后带补充重查" }
  ],
  dreamFlow: [
    { id: "d0", title: "脏队列", code: "list_dirty_users + lock", note: "incremental 或 defrag · 无活则 noop" },
    { id: "d1", title: "归档", spec: "dream_archive", note: "批次 ≤40 · 锚点 · 禁写热区" },
    { id: "d2", title: "索引", code: "sync_wiki", note: "hash 增量向量 · 刷新边表" },
    { id: "d3", title: "升降级", spec: "dream_tiering", note: "14 天 ≥2 次 confirmed 晋升" },
    { id: "d4", title: "对账", code: "文件 #msg_N ∪ 模型汇报", note: "短事务推进状态" },
    { id: "d5", title: "快照", code: "git commit", note: "失败 reset --hard + 重建索引" }
  ],
  loopFlow: [
    { id: "l1", title: "拼前缀", note: "prompt + 技能一行 + Schema" },
    { id: "l2", title: "流式调用", note: "拼回 tool_calls 分片" },
    { id: "l3", title: "执行工具", note: "异常变 ERROR 回灌，不崩" },
    { id: "l4", title: "轮数用尽", note: "撤工具，强制给结论" },
    { id: "l5", title: "校验输出", note: "失败修 1 次" }
  ],
  ops: [
    { id: "capture", agent: "search", label: "录入", hint: "零等待落盘" },
    { id: "ask", agent: "search", label: "提问", hint: "四步检索" },
    { id: "clarify", agent: "search", label: "澄清", hint: "高优入库再查" },
    { id: "dream", agent: "dream", label: "整理", hint: "夜间增量" },
    { id: "reindex", agent: "dream", label: "重建索引", hint: "文件 → 库" }
  ],
  demos: {
    capture: { title: "录入", steps: ["capture_message()", "msg_seq +1", "180s 内同 batch_id", "dirty_since 置位"] },
    ask: { title: "提问「雕牌屏多少钱」", steps: ["注入 MEMORY.md", "search_router 扩词", "双轨召回 + 原话", "未中则沙箱翻 CACHE", "改写后重查", "写 search_logs"] },
    clarify: { title: "澄清「小黑是我家猫」", steps: ["source_kind=clarification", "绑 reply_to_search_id", "带补充重跑 ask"] },
    dream: { title: "夜间整理", steps: ["咨询锁", "dream_archive", "sync_wiki", "命中≥2 晋升热区", "锚点对账", "git commit"] },
    reindex: { title: "重建索引", steps: ["扫 wiki/*.md", "hash 比对", "只对变更切片 embed"] }
  }
};
