(function (w) {
  const { G, C, esc } = w.Perc;

  /* ---------- icons ---------- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    flow: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    stack: '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="4" rx="1"/><rect x="3" y="17" width="18" height="3" rx="1"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h14"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;
  const tag = (t, tone = "") => `<span class="tag ${tone}">${esc(t)}</span>`;

  /* ---------- data helpers ---------- */
  const specs = () => G.specs;
  const specOf = (n) => G.specs.find((s) => s.name === n);
  const metaOf = (n) => C.specMeta[n] || {};
  const scopeOf = (n) => C.scopes[n] || {};
  const agentOf = (id) => C.agents.find((a) => a.id === id);
  const modelOf = (key) => G.models.models.find((m) => m.key === key) || {};
  const allTools = () => {
    const map = new Map();
    G.specs.forEach((s) => s.tools.forEach((t) => map.has(t.name) || map.set(t.name, t)));
    return [...map.values()];
  };
  const usersOfTool = (name) => G.specs.filter((s) => s.tools.some((t) => t.name === name)).map((s) => s.name);
  const usersOfSkill = (name) => G.specs.filter((s) => (s.skills || []).includes(name)).map((s) => s.name);
  const usersOfSlot = (slot) => G.specs.filter((s) => s.model_slot === slot).map((s) => s.name);
  const thinkingOf = (m) => {
    const e = m.extra_body || {};
    if (e.enable_thinking === true) return ["思考开", "purple"];
    if (e.enable_thinking === false || e.thinking?.type === "disabled") return ["思考关", ""];
    if (e.reasoning_effort) return [`推理 ${e.reasoning_effort}`, "purple"];
    return null;
  };
  const perms = (t) => {
    const p = [];
    if (t.name === "delete_file") p.push(["删除", "red"]);
    else if (t.tags.includes("write")) p.push(["写入", "orange"]);
    if (t.tags.includes("read")) p.push(["只读", "green"]);
    if (t.tags.includes("shell")) p.push(["沙箱命令", "purple"]);
    if (t.tags.includes("db")) p.push(["数据库", "blue"]);
    return p;
  };
  const permSummary = (s) => {
    const sc = scopeOf(s.name);
    const out = [];
    if (!s.tools.length) return [["无工具", ""]];
    if (sc.del) out.push(["可删除", "red"]);
    else if (sc.write?.length) out.push(["可写", "orange"]);
    else out.push(["只读", "green"]);
    if (sc.sandbox) out.push(["沙箱", "purple"]);
    if (sc.db) out.push(["数据库", "blue"]);
    return out;
  };

  /* ---------- editable state (preview only) ---------- */
  const S = { drafts: {}, saved: {}, slotsSaved: { ...G.models.slots }, slotsDraft: { ...G.models.slots }, modal: null, promptMode: "final", ctx: {}, play: { op: "ask", query: "雕牌屏多少钱", text: "", result: null, lastCapture: 0, mode: "auto" } };

  /* ---------- prompt versions (preview only) ---------- */
  S.versions = {};
  const nowStr = () => {
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function vers(n) {
    if (S.versions[n]) return S.versions[n];
    const raw = specOf(n).system_prompt_raw, lines = raw.split("\n");
    let idx = -1;
    lines.forEach((l, i) => /^\s*\d+\.\s/.test(l) && (idx = i));
    if (n === "search_answer") idx = lines.findIndex((l) => l.startsWith("2. 输入里已经附上"));
    const removed = idx >= 0 ? lines[idx].match(/^\s*(\d+)\./)[1] : "";
    const v1 = idx >= 0 ? lines.filter((_, i) => i !== idx).join("\n") : raw;
    const note2 = n === "search_answer" ? "证据充足时直接作答，不再调用工具" : removed ? `补充第 ${removed} 条规则` : "措辞调整";
    return (S.versions[n] = {
      list: [
        { id: "v1", prompt: v1, note: "初版", author: "tex", at: "2026-11-10 14:20" },
        { id: "v2", prompt: raw, note: note2, author: "tex", at: "2026-11-12 22:41" },
      ],
      active: "v2", view: "v2", compare: null, editing: null,
    });
  }
  const verOf = (n, id) => vers(n).list.find((v) => v.id === id);
  const activePrompt = (n) => verOf(n, vers(n).active).prompt;
  const activeVer = (n) => vers(n).active;
  const promptSuffix = (n) => { const s = specOf(n); return s.system_prompt_final.slice(s.system_prompt_raw.length); };

  function lineDiff(a, b) {
    const A = a.split("\n"), B = b.split("\n"), m = A.length, n = B.length;
    const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (A[i] === B[j]) { out.push([" ", A[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]);
      else out.push(["+", B[j++]]);
    }
    while (i < m) out.push(["-", A[i++]]);
    while (j < n) out.push(["+", B[j++]]);
    return out;
  }

  const baseline = (n) => {
    const s = specOf(n);
    const base = S.saved[n] || {
      max_turns: s.max_turns,
      max_repairs: s.max_repairs,
      temperature: s.params.temperature ?? null,
      max_tokens: s.params.max_tokens ?? null,
      tools: s.tools.map((t) => t.name),
      skills: [...(s.skills || [])],
    };
    return { ...base, prompt: activePrompt(n) };
  };
  const draft = (n) => (S.drafts[n] ||= JSON.parse(JSON.stringify(baseline(n))));
  const FIELD_LABEL = { max_turns: "最大轮次", max_repairs: "修复次数", temperature: "温度", max_tokens: "最大输出 tokens", tools: "工具", skills: "Skill", prompt: "System Prompt" };
  const fmt = (k, v) => (Array.isArray(v) ? v.join(", ") || "（空）" : k === "prompt" ? `${v.length} 字` : String(v ?? "—"));
  const changes = (n) => {
    if (!S.drafts[n]) return [];
    const b = baseline(n), d = S.drafts[n];
    return Object.keys(FIELD_LABEL)
      .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(d[k]))
      .map((k) => ({ key: k, label: FIELD_LABEL[k], old: fmt(k, b[k]), now: fmt(k, d[k]) }));
  };
  const isDirty = (n) => changes(n).length > 0;
  const isModified = (n) => !!S.saved[n];
  const slotChanges = () =>
    Object.keys(S.slotsSaved)
      .filter((k) => S.slotsSaved[k] !== S.slotsDraft[k])
      .map((k) => ({ key: k, label: k, old: S.slotsSaved[k], now: S.slotsDraft[k], affects: usersOfSlot(k) }));
  const effModel = (s) => modelOf(S.slotsSaved[s.model_slot]);

  /* ---------- toast ---------- */
  function toast(msg) {
    let el = document.getElementById("ui-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ui-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.innerHTML = `<span class="dot"></span>${esc(msg)}`;
    el.classList.add("on");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("on"), 1600);
  }

  /* ---------- architecture ---------- */
  const ARCH = [
    { row: "入口", sub: "谁来调用", cells: [
      { id: "cli", t: "命令行", s: "percolation_cli.py", d: "开发和运维入口：capture / ask / clarify / dream / reindex。", items: ["script/percolation_cli.py"] },
      { id: "api", t: "HTTP API", s: "/v1/*", d: "对外服务入口，按 X-User 解析租户后调用业务层。", items: ["code/percolation/api.py"] },
      { id: "timer", t: "夜间定时", s: "03:30 dream --all", d: "systemd timer 每晚触发，遍历有脏数据的用户。", items: ["config/systemd/"] },
    ]},
    { row: "业务 Agent", sub: "编排流程", cells: [
      { id: "search", t: "Search Agent", s: "在线检索 · 3 个节点", agent: true, d: "把模糊提问变成可核验的答案。路由 → 召回核验 → 候选区穿透 → 追问。", specs: ["search_router", "search_answer", "search_cache_probe"] },
      { id: "dream", t: "Dreaming Agent", s: "夜间整理 · 3 个节点", agent: true, d: "把当天原话归档进主题页，按命中热度升降级记忆。", specs: ["dream_archive", "dream_tiering", "dream_tiering_defrag"] },
    ]},
    { row: "确定性程序", sub: "不调大模型", cells: [
      { id: "capture", t: "录入", s: "capture_message", d: "原话只追加入库，180 秒内连发归同一批次，标记用户待整理。", items: ["code/percolation/capture.py"] },
      { id: "retriever", t: "混合召回", s: "RRF + Rerank", d: "全文二字切分 + 型号模糊 + 向量三路召回，RRF 融合后重排，再带一跳链接页。", items: ["code/percolation/retriever.py"] },
      { id: "indexer", t: "索引同步", s: "sync_wiki", d: "按文件 SHA-256 增量切片和向量化，刷新链接边表。", items: ["code/percolation/indexer.py"] },
    ]},
    { row: "agentkit", sub: "可复用内核", cells: [
      { id: "spec", t: "AgentSpec", s: "声明节点", d: "一个节点 = 模型槽 + prompt + 工具 + 输出 Schema + 轮次 + Skill 目录。", items: ["code/agentkit/agent.py"] },
      { id: "loop", t: "run_agent", s: "工具循环", d: "拼前缀 → 流式调用 → 执行工具 → 轮数用尽强制总结 → 校验输出（失败修 1 次）。", items: ["code/agentkit/loop.py"] },
      { id: "tools", t: "工具与沙箱", s: "Tool · bwrap", d: "工具异常回灌模型不崩溃；shell 在断网只读沙箱里执行；路径越界拒绝。", items: ["code/agentkit/tools.py", "code/agentkit/sandbox.py"] },
      { id: "tenancy", t: "租户隔离", s: "RLS 事务", d: "每次访问数据库都在设置了 user_id 的短事务里，强制行级安全。", items: ["code/agentkit/tenancy.py"] },
    ]},
    { row: "存储与模型", sub: "底座", cells: [
      { id: "nas", t: "工作区", s: "NAS · Git", d: "每个用户一个目录：MEMORY.md、MEMORY_CACHE/、wiki/，每次整理一个 Git 提交。", items: ["MEMORY.md ≤200 行", "MEMORY_CACHE/*.md", "wiki/*.md"] },
      { id: "pg", t: "PostgreSQL 18", s: "原话 + 索引", d: "raw_messages 只追加；wiki_chunks 存切片和 halfvec(1024) 向量；全表强制 RLS。", items: ["raw_messages", "wiki_chunks", "search_logs"] },
      { id: "llm", t: "百炼模型", s: "Qwen · Embedding · Rerank", d: "按模型槽解析，节点只声明槽位不写死模型。", items: Object.entries(G.models.slots).map(([k, v]) => `${k} → ${v}`) },
    ]},
  ];
  const archCell = (id) => ARCH.flatMap((r) => r.cells).find((c) => c.id === id);

  function archDiagram(active) {
    return `<div class="arch">${ARCH.map(
      (r, i) => `${i ? `<div class="arch-arrow">▼</div>` : ""}<div class="arch-row">
        <div class="arch-label">${esc(r.row)}<small>${esc(r.sub)}</small></div>
        <div class="arch-cells">${r.cells
          .map((c) => `<div class="arch-cell ${c.agent ? "agent" : ""} ${active === c.id ? "on" : ""}" data-arch="${c.id}"><b>${esc(c.t)}</b><span>${esc(c.s)}</span></div>`)
          .join("")}</div></div>`
    ).join("")}</div>`;
  }

  function archDetail(id) {
    const c = archCell(id);
    if (!c) return `<div class="empty">点击左侧模块查看说明</div>`;
    return `<h3 style="font-size:15px">${esc(c.t)}</h3>
      <p class="muted" style="margin:2px 0 10px">${esc(c.s)}</p>
      <p>${esc(c.d)}</p>
      ${c.items ? `<div class="section-title" style="margin-top:14px">相关位置</div><div class="tags">${c.items.map((x) => tag(x, "plain")).join("")}</div>` : ""}
      ${c.specs ? `<div class="section-title" style="margin-top:14px">包含节点</div><div class="grid" style="gap:6px">${c.specs
        .map((n) => `<a class="row" data-spec="${n}" style="justify-content:space-between;padding:6px 10px;border:1px solid var(--line);border-radius:6px"><span><b>${esc(metaOf(n).title)}</b> <span class="muted mono">${n}</span></span>${icon("chev")}</a>`)
        .join("")}</div>` : ""}`;
  }

  /* ---------- workflows ---------- */
  const FLOWS = {
    search: { name: "在线检索", when: "用户每次提问", steps: C.searchFlow },
    dream: { name: "夜间整理", when: "每晚 03:30 或手动触发", steps: C.dreamFlow },
    loop: { name: "内核循环", when: "每个节点内部", steps: C.loopFlow },
  };
  const FLOW_MORE = {
    cap: { in: "一句原话", out: "msg_seq · batch_id", next: "等待夜间整理" },
    s1: { in: "MEMORY.md + 提问", out: "检索词 · 未知暗语", next: "进入召回" },
    s2: { in: "检索词", out: "Top-6 切片 + 同批次原话", next: "交给核验" },
    s2b: { in: "召回结果", out: "answered / ambiguous / insufficient", next: "answered 结束；其他进入穿透" },
    s3: { in: "未知暗语", out: "改写检索词", next: "回到召回再答一次" },
    s4: { in: "仍无法回答", out: "一句追问", next: "用户回答后作为澄清入库" },
    d0: { in: "dirty 用户队列", out: "本次模式", next: "拿到锁才继续" },
    d1: { in: "≤40 条待整理原话", out: "改动的主题页", next: "同步索引" },
    d2: { in: "改动文件", out: "新切片与向量", next: "进入升降级" },
    d3: { in: "命中统计", out: "晋升 / 下沉列表", next: "对账" },
    d4: { in: "文件锚点 + 模型汇报", out: "原话状态推进", next: "提交快照" },
    d5: { in: "工作区", out: "Git 提交", next: "失败则回滚" },
  };

  function flowSteps(flow, active) {
    const f = FLOWS[flow];
    return `<div class="steps">${f.steps
      .map((s, i) => `<div class="step ${i < active ? "done" : ""} ${i === active ? "on" : ""}" data-flow-step="${i}">
        <div class="bar"></div><div class="n">STEP ${String(i + 1).padStart(2, "0")}</div>
        <div class="t">${esc(s.title)}<span class="kind ${s.spec ? "llm" : "code"}">${s.spec ? "LLM" : "程序"}</span></div>
        <div class="s">${esc(s.spec || s.code || "")}</div></div>`)
      .join("")}</div>`;
  }

  function flowDetail(flow, i) {
    const s = FLOWS[flow].steps[i];
    if (!s) return "";
    const more = FLOW_MORE[s.id];
    const sp = s.spec && specOf(s.spec);
    return `<div class="row" style="justify-content:space-between;margin-bottom:10px">
        <h3 style="font-size:15px">${esc(s.title)} <span class="kind ${s.spec ? "llm" : "code"}">${s.spec ? "LLM 节点" : "确定性程序"}</span></h3>
        ${sp ? `<button class="btn btn-sm" data-spec="${s.spec}">查看节点配置 ${icon("arrow")}</button>` : ""}
      </div>
      <p style="margin-bottom:12px">${esc(s.note)}</p>
      ${more ? `<div class="desc">
        <div><span class="k">输入</span><span class="v">${esc(more.in)}</span></div>
        <div><span class="k">输出</span><span class="v">${esc(more.out)}</span></div>
        <div><span class="k">下一步</span><span class="v">${esc(more.next)}</span></div>
        <div><span class="k">实现</span><span class="v mono">${esc(s.spec || s.code || "—")}</span></div>
      </div>` : ""}
      ${sp ? `<div class="row" style="margin-top:12px">${tag(effModel(sp).model, "blue")}${tag(`最多 ${draft(sp.name).max_turns} 轮`)}${permSummary(sp).map(([t, c]) => tag(t, c)).join("")}</div>` : ""}`;
  }

  /* ---------- overview ---------- */
  function stats() {
    const items = [
      ["业务 Agent", C.agents.length, "个"],
      ["AgentSpec 节点", G.specs.length, "个"],
      ["工具", allTools().length, "种"],
      ["Skill", Object.keys(G.skills).length, "个"],
      ["模型槽", Object.keys(G.models.slots).length, "个"],
    ];
    return `<div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">${items
      .map(([l, n, u]) => `<div class="card stat"><div class="label">${l}</div><div class="num">${n}<small>${u}</small></div></div>`)
      .join("")}</div>`;
  }

  function memoryLayers() {
    const tone = { L4: "red", L3: "orange", L2: "blue", L1: "" };
    return `<table class="table"><thead><tr><th style="width:60px">层级</th><th>位置</th><th>规则</th></tr></thead><tbody>${C.product.layers
      .map((l) => `<tr><td>${tag(l.id, tone[l.id])}</td><td><b>${esc(l.name)}</b> <span class="mono muted">${esc(l.path)}</span></td><td class="muted">${esc(l.rule)}</td></tr>`)
      .join("")}</tbody></table>`;
  }

  const GUIDE = [
    { t: "看整体架构", d: "五层结构和两个业务 Agent", go: "arch" },
    { t: "走一遍工作流", d: "检索四步、整理五步", go: "flow" },
    { t: "查节点配置", d: "模型、轮次、工具权限", go: "specs" },
    { t: "看上下文和 Prompt", d: "模型每次看到什么", go: "context" },
    { t: "在调试台试跑", d: "录入、提问、整理", go: "play" },
  ];
  function guide() {
    return `<div class="grid" style="gap:0">${GUIDE.map(
      (g, i) => `<a class="row" data-go="${g.go}" style="padding:10px 0;border-bottom:${i < GUIDE.length - 1 ? "1px solid var(--line-2)" : "0"};color:inherit">
        <span class="tag purple" style="width:22px;justify-content:center;padding:0">${i + 1}</span>
        <span class="grow"><b>${g.t}</b> <span class="muted">· ${g.d}</span></span>${icon("chev")}</a>`
    ).join("")}</div>`;
  }

  /* ---------- agents ---------- */
  function agentCard(a) {
    const sp = a.specs.map(specOf);
    return `<div class="card">
      <div class="card-head"><h3>${icon(a.id === "search" ? "search" : "moon")}${esc(a.name)}</h3>${tag("已接入", "green")}</div>
      <div class="card-body">
        <p style="margin-bottom:10px">${esc(a.job)}</p>
        <div class="kv-line"><span class="k">代码</span><span class="mono">${esc(a.file)}</span></div>
        <div class="kv-line"><span class="k">入口</span><span class="mono">${esc(a.entry)}</span></div>
        <div class="kv-line"><span class="k">模型槽</span><span class="tags">${a.slots.map((s) => tag(s, "blue")).join("")}</span></div>
        <div class="kv-line"><span class="k">节点</span><span class="tags">${sp.map((s) => `<a data-spec="${s.name}">${tag(s.name, "purple")}</a>`).join("")}</span></div>
      </div>
      <div class="card-foot"><button class="btn btn-sm" data-agent="${a.id}">查看节点 ${icon("arrow")}</button></div>
    </div>`;
  }

  /* ---------- spec list ---------- */
  function specTable(opts = {}) {
    const q = (opts.q || "").trim().toLowerCase();
    const rows = G.specs.filter((s) => (!opts.agent || s.agent === opts.agent) && (!q || (s.name + metaOf(s.name).title + metaOf(s.name).duty).toLowerCase().includes(q)) && (!opts.write || scopeOf(s.name).write?.length));
    if (!rows.length) return `<div class="empty">没有匹配的节点</div>`;
    return `<table class="table"><thead><tr>
      <th>节点</th><th>所属</th><th>模型</th><th style="width:70px">轮次</th><th>工具权限</th><th>Skill</th>${opts.ver ? `<th style="width:110px">Prompt</th>` : ""}<th style="width:80px">状态</th><th style="width:70px"></th></tr></thead><tbody>${rows
      .map((s) => {
        const m = metaOf(s.name), md = effModel(s), th = thinkingOf(md);
        return `<tr class="click ${opts.active === s.name ? "on" : ""}" data-spec="${s.name}">
          <td><div class="name">${esc(m.step)} ${esc(m.title)}</div><div class="sub">${s.name}${s.mode ? ` · ${s.mode}` : ""}</div></td>
          <td>${tag(agentOf(s.agent).name, "plain")}</td>
          <td><div class="hl-model">${esc(md.model)}</div><div class="sub">${s.model_slot}${th ? ` · ${th[0]}` : ""}</div></td>
          <td><b>${draft(s.name).max_turns}</b></td>
          <td><div class="tags">${permSummary(s).map(([t, c]) => tag(t, c)).join("")}<span class="muted">${s.tools.length} 个</span></div></td>
          <td>${(s.skills || []).length ? tag(s.skills[0], "purple") : `<span class="muted">—</span>`}</td>
          ${opts.ver ? `<td><div class="tags">${tag(activeVer(s.name), "green")}${vers(s.name).list.some((v) => v.draft) ? tag("有草稿", "orange") : ""}</div></td>` : ""}
          <td>${isDirty(s.name) ? `<span class="dirty"><span class="dot"></span>未保存</span>` : isModified(s.name) ? tag("已修改", "orange") : `<span class="muted">默认</span>`}</td>
          <td><a class="row" style="gap:2px;flex-wrap:nowrap;white-space:nowrap">配置${icon("chev")}</a></td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  /* ---------- spec detail sections ---------- */
  function specHeader(n) {
    const s = specOf(n), m = metaOf(n), md = effModel(s), th = thinkingOf(md);
    return `<div>
      <div class="row"><h2 style="font-size:18px">${esc(m.title)}</h2>${tag(m.step, "purple")}${tag(agentOf(s.agent).name, "plain")}
        ${isDirty(n) ? `<span class="dirty" data-dirty="${n}"><span class="dot"></span>${changes(n).length} 项未保存</span>` : `<span class="dirty" data-dirty="${n}"></span>`}</div>
      <div class="row muted" style="margin-top:4px"><span class="mono">${n}</span><span>·</span><span class="hl-model">${esc(md.model)}</span>${th ? tag(th[0], th[1]) : ""}<span>·</span><span>最多 <b class="hl">${draft(n).max_turns}</b> 轮</span></div>
    </div>`;
  }

  function specOverview(n) {
    const s = specOf(n), m = metaOf(n), md = effModel(s);
    const fields = w.Perc.schemaFields(s.output_schema);
    return `<div class="info-box" style="font-size:13px;margin-bottom:14px"><b>职责</b>　${esc(m.duty)}</div>
      <div class="desc" style="margin-bottom:16px">
        <div><span class="k">模型槽</span><span class="v mono">${s.model_slot}</span></div>
        <div><span class="k">实际模型</span><span class="v hl-model">${esc(md.model)}</span></div>
        <div><span class="k">最大轮次</span><span class="v"><b>${draft(n).max_turns}</b>${s.max_turns === 1 ? ` <span class="muted">单轮</span>` : ""}</span></div>
        <div><span class="k">输出模型</span><span class="v mono">${esc(s.output_model)}</span></div>
        <div><span class="k">运行模式</span><span class="v">${s.mode ? tag(s.mode === "defrag" ? "全局重整" : "增量", s.mode === "defrag" ? "orange" : "blue") : `<span class="muted">—</span>`}</span></div>
        <div><span class="k">Prompt 文件</span><span class="v mono">${esc(m.promptFile)}</span></div>
      </div>
      <div class="grid g2">
        <div><div class="section-title" style="margin-top:0">${icon("arrow")}输入</div><div class="tags">${(m.input || []).map((x) => tag(x, "blue")).join("")}</div></div>
        <div><div class="section-title" style="margin-top:0">${icon("check")}输出 <span class="hint">${esc(s.output_model)}</span></div><div class="tags">${fields.map((f) => tag(f.key, "green")).join("")}</div></div>
      </div>
      <div class="section-title">输出字段</div>
      <table class="table"><thead><tr><th>字段</th><th style="width:90px">类型</th><th>说明</th></tr></thead><tbody>${fields
        .map((f) => `<tr><td class="mono"><b>${esc(f.key)}</b></td><td>${tag(f.type)}</td><td class="muted">${esc(f.desc || (f.def !== undefined ? `默认 ${JSON.stringify(f.def)}` : "—"))}</td></tr>`)
        .join("")}</tbody></table>`;
  }

  function specBoundary(n) {
    const s = specOf(n), sc = scopeOf(n);
    const box = (title, body, tone) => `<div class="card" style="box-shadow:none"><div class="card-body" style="padding:10px 12px"><div class="muted" style="font-size:12px">${title}</div><div style="margin-top:4px">${body || `<span class="muted">—</span>`}</div></div></div>`;
    const list = (arr, tone) => (arr || []).map((x) => tag(x, tone)).join(" ");
    return `<div class="grid g4" style="margin-bottom:12px">
        ${box("可读", list(sc.read, "green"))}
        ${box("可写", list(sc.write, "orange"))}
        ${box("删除文件", sc.del ? tag("允许", "red") : tag("禁止"))}
        ${box("隔离", [sc.sandbox && tag("bwrap 沙箱", "purple"), sc.db && tag("RLS 数据库", "blue")].filter(Boolean).join(" "))}
      </div>
      ${sc.note ? `<div class="warn-box" style="margin-bottom:14px">${icon("shield")} ${esc(sc.note)}</div>` : ""}
      <div class="section-title">暴露给模型的工具 <span class="hint">${s.tools.length} 个</span></div>
      ${s.tools.length ? `<table class="table"><thead><tr><th>工具</th><th>说明</th><th>参数</th><th>权限</th></tr></thead><tbody>${s.tools
        .map((t) => `<tr><td class="mono"><b>${t.name}</b></td><td>${esc(t.description)}</td><td class="mono muted">${Object.keys(t.parameters.properties || {}).join(", ")}</td><td><div class="tags">${perms(t).map(([x, c]) => tag(x, c)).join("")}</div></td></tr>`)
        .join("")}</tbody></table>` : `<div class="empty">无工具，单轮直接输出</div>`}
      <div class="section-title">通用保护</div>
      <div class="tags">${["工具异常回灌模型，不中断", "单次工具输出截断 8000 字", "路径不得越出工作区", "轮数用尽撤掉工具强制总结", "输出 Schema 校验失败修复 1 次"].map((x) => tag(x, "plain")).join("")}</div>`;
  }

  function specForm(n, opts = {}) {
    const s = specOf(n), d = draft(n), b = baseline(n), md = effModel(s);
    const ch = (k) => (JSON.stringify(b[k]) !== JSON.stringify(d[k]) ? "changed" : "");
    return `<div class="form">
      <div class="field"><label>模型槽<small>由槽位统一指定模型</small></label>
        <div><div class="row"><span class="tag blue mono">${s.model_slot}</span>${icon("arrow")}<span class="hl-model">${esc(md.model)}</span>${thinkingOf(md) ? tag(...thinkingOf(md)) : ""}<a data-go="models" style="margin-left:6px">更换模型</a></div>
        <div class="help">共用此槽的节点：${usersOfSlot(s.model_slot).join("、")}</div></div></div>
      <div class="field ${ch("max_turns")}" data-field="${n}|max_turns"><label>最大轮次<small>一轮 = 一次模型调用</small></label>
        <div><div class="stepper"><button data-stp="${n}|max_turns|-1">−</button><input data-cfg="${n}|max_turns" value="${d.max_turns}"/><button data-stp="${n}|max_turns|1">+</button></div>
        ${s.tools.length === 0 ? `<div class="help">无工具节点，建议保持 1</div>` : ""}</div></div>
      <div class="field ${ch("max_repairs")}" data-field="${n}|max_repairs"><label>修复次数<small>输出不合 Schema 时重试</small></label>
        <div><div class="stepper"><button data-stp="${n}|max_repairs|-1">−</button><input data-cfg="${n}|max_repairs" value="${d.max_repairs}"/><button data-stp="${n}|max_repairs|1">+</button></div></div></div>
      <div class="field ${ch("temperature")}" data-field="${n}|temperature"><label>温度<small>越低越稳定</small></label>
        <div class="slider"><input type="range" min="0" max="1" step="0.05" data-cfg="${n}|temperature" value="${d.temperature ?? 0.3}"/><b data-out="${n}|temperature">${d.temperature ?? "—"}</b></div></div>
      <div class="field ${ch("max_tokens")}" data-field="${n}|max_tokens"><label>最大输出 tokens</label>
        <select class="select sm" data-cfg="${n}|max_tokens">${[800, 2048, 4096, 8192, 16384].map((v) => `<option ${v === d.max_tokens ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field ${ch("tools")}" data-field="${n}|tools"><label>工具<small>关掉后模型看不到它</small></label>
        <div class="check-list">${s.tools.length ? s.tools
          .map((t) => {
            const on = d.tools.includes(t.name);
            return `<div class="check ${on ? "" : "off"}"><button class="switch ${on ? "on" : ""}" data-tgl="${n}|tools|${t.name}"></button>
              <div><div class="check-name">${t.name}</div><div class="check-desc">${esc(t.description)}</div></div><div class="tags">${perms(t).map(([x, c]) => tag(x, c)).join("")}</div></div>`;
          })
          .join("") : `<span class="muted">此节点不挂工具</span>`}
        ${s.tools.length && d.tools.length < s.tools.length ? `<div class="warn-box">Prompt 中若提到被关闭的工具，模型调用会收到“未知工具”错误。</div>` : ""}</div></div>
      <div class="field ${ch("skills")}" data-field="${n}|skills"><label>Skill<small>只注入一行索引，正文按需读取</small></label>
        <div class="check-list">${(s.skills || []).length ? s.skills
          .map((k) => {
            const on = d.skills.includes(k);
            return `<div class="check ${on ? "" : "off"}"><button class="switch ${on ? "on" : ""}" data-tgl="${n}|skills|${k}"></button>
              <div><div class="check-name">${k}</div><div class="check-desc">${esc(G.skills[k]?.description || "")}</div></div>${tag("渐进加载", "purple")}</div>`;
          })
          .join("") : `<span class="muted">此节点不挂 Skill</span>`}</div></div>
      ${opts.noPrompt
        ? `<div class="field"><label>System Prompt<small>通过版本管理修改</small></label><div class="row">${tag(`${activeVer(n)} 使用中`, "green")}<span class="muted">${activePrompt(n).length} 字</span><a data-go-prompt="${n}">管理版本 →</a></div></div>`
        : `<div class="field ${ch("prompt")}" data-field="${n}|prompt"><label>System Prompt<small>只改正文；技能索引和输出格式运行时自动追加</small></label>
        <div><textarea class="textarea" data-cfg="${n}|prompt">${esc(d.prompt)}</textarea>
        <div class="row help"><span data-count="${n}">${d.prompt.length} 字</span><span class="grow"></span><a data-cfg-reset-prompt="${n}">恢复原文</a></div></div></div>`}
    </div>`;
  }

  function saveBar(n) {
    const c = changes(n).length;
    return `<span class="dirty" data-dirty-bar="${n}">${c ? `<span class="dot"></span>${c} 项未保存` : ""}</span>
      <button class="btn" data-reset="${n}" ${c ? "" : "disabled"}>撤销修改</button>
      <button class="btn btn-primary" data-save="${n}" ${c ? "" : "disabled"}>保存</button>`;
  }

  function promptBlock(n) {
    const s = specOf(n), d = draft(n);
    const suffix = s.system_prompt_final.slice(s.system_prompt_raw.length);
    const mode = S.promptMode;
    const body = mode === "raw" ? esc(d.prompt) : `${esc(d.prompt)}<span class="inj">${esc(suffix)}</span>`;
    return `<div class="row" style="justify-content:space-between;margin-bottom:8px">
        <div class="seg"><button class="${mode === "final" ? "on" : ""}" data-pmode="final">运行时完整版</button><button class="${mode === "raw" ? "on" : ""}" data-pmode="raw">Prompt 原文</button></div>
        <div class="row"><span class="muted">${(mode === "raw" ? d.prompt.length : d.prompt.length + suffix.length)} 字</span><button class="btn btn-sm" data-copy-prompt="${n}">${icon("copy")}复制</button></div>
      </div>
      ${mode === "final" ? `<div class="legend" style="margin-bottom:8px"><span><i style="background:#fff;border:1px solid var(--line)"></i>Prompt 文件</span><span><i style="background:var(--primary-weak);border:1px solid var(--primary)"></i>运行时自动追加（技能索引 · 输出格式）</span></div>` : ""}
      <pre class="code">${body}</pre>`;
  }

  function skillBlock(name, compact) {
    const sk = G.skills[name];
    if (!sk) return "";
    return `<div class="card">
      <div class="card-head"><h3>${icon("book")}${esc(name)}</h3><div class="tags">${usersOfSkill(name).map((u) => tag(u, "purple")).join("")}</div></div>
      <div class="card-body">
        <p style="margin-bottom:10px">${esc(sk.description)}</p>
        <div class="kv-line"><span class="k">文件</span><span class="mono">${esc(sk.path)}</span></div>
        <div class="kv-line"><span class="k">加载方式</span><span>${tag("① 常驻一行索引", "plain")} ${icon("arrow")} ${tag("② 模型调用 read_skill 读正文", "purple")}</span></div>
        ${compact ? "" : `<div class="section-title">正文 <span class="hint">${sk.body.length} 字</span></div><pre class="code">${esc(sk.body)}</pre>`}
      </div></div>`;
  }

  /* ---------- context ---------- */
  const SAMPLE = {
    memory: "## 个人背景\n- 家：杭州滨江，书房在改造 [#msg_3]\n- 小黑：家里的猫，黑色英短 [#msg_21]\n\n## 常用称呼\n- 老张：供应商张伟，负责显示器报价 [#msg_8]",
    query: "提问：雕牌屏多少钱",
    route: '检索词：["雕牌屏", "便携屏 价格"]\n未知暗语：["雕牌屏"]',
    evidence: "[1] wiki/digital-gear.md § 待购清单  相关度 0.82\n- [confirmed] CFORCE 15.6 寸 OLED 便携屏，目标价 999 元 [#msg_12]\n\n原话 #msg_12 · 2026-10-03 21:14\n那个cforce的15.6 oled屏 999能拿就下单",
    probeIn: "提问：雕牌屏多少钱\n未知暗语：雕牌屏\n主路径未中原因：insufficient",
    tool: "→ hybrid_search({queries:[...]})\n← 6 条结果（截断至 8000 字）",
    pages: "wiki/digital-gear.md  数码外设与待购清单\nwiki/pets.md  小黑\nMEMORY_CACHE/slang.md · people.md",
    pending: "#msg_31 [批次 b-0412] 11-12 22:03 小黑周六打疫苗 滨江店\n#msg_32 [批次 b-0412] 11-12 22:04 记得带上次的本子",
    hits: "雕牌屏  14 天命中 3 次  confirmed  → 候选晋升\n老张    30 天使用 0 次        → 候选下沉",
    dangling: "[[home-office]] ← wiki/digital-gear.md（目标不存在）",
    skill: "read_skill(\"wiki-format\") → 返回 SKILL.md 正文",
    repair: "上次输出未通过 Schema 校验：字段 xxx 缺失。请只输出 JSON。",
  };
  const ctxBlocks = (n) => {
    const s = specOf(n);
    const sys = { t: "System Prompt", src: `使用中 ${activeVer(n)} + 运行时追加`, kind: "fixed", size: activePrompt(n).length + promptSuffix(n).length, body: () => activePrompt(n) + promptSuffix(n) };
    const mem = (ro) => ({ t: ro ? "热区记忆（只读）" : "热区记忆", src: "MEMORY.md · ≤200 行", kind: "dyn", size: 2400, body: () => SAMPLE.memory });
    const tool = { t: "工具返回", src: "每次调用后追加", kind: "cond", size: 1600, body: () => SAMPLE.tool };
    const repair = { t: "格式修复提示", src: "Schema 校验失败时 · ≤1 次", kind: "cond", size: 120, body: () => SAMPLE.repair };
    const skill = { t: "Skill 正文", src: "模型主动 read_skill 后", kind: "cond", size: G.skills["wiki-format"].body.length, body: () => SAMPLE.skill };
    const M = {
      search_router: [sys, mem(), { t: "本次提问", src: "用户输入 + 澄清补充", kind: "dyn", size: 60, body: () => SAMPLE.query }, repair],
      search_answer: [sys, mem(), { t: "本次提问", src: "用户输入", kind: "dyn", size: 60, body: () => SAMPLE.query }, { t: "路由结果", src: "search_router 输出", kind: "dyn", size: 120, body: () => SAMPLE.route }, { t: "召回证据", src: "Top-6 切片 + 锚点原话 + 同批次", kind: "dyn", size: 3600, body: () => SAMPLE.evidence }, tool, repair],
      search_cache_probe: [sys, { t: "穿透任务", src: "提问 · 未知暗语 · 未中原因", kind: "dyn", size: 120, body: () => SAMPLE.probeIn }, { ...tool, body: () => "→ bash(\"rg -n 雕牌 MEMORY_CACHE\")\n← MEMORY_CACHE/slang.md:3: - 雕牌屏：CFORCE 15.6 寸 OLED 便携屏" }, repair],
      dream_archive: [sys, mem(true), { t: "现有地图", src: "主题页清单 + CACHE 文件名", kind: "dyn", size: 600, body: () => SAMPLE.pages }, { t: "待整理原话", src: "一批 ≤40 条 · 按连发批次", kind: "dyn", size: 2000, body: () => SAMPLE.pending }, skill, tool, repair],
      dream_tiering: [sys, mem(), { t: "命中统计", src: "14 天命中 · 30 天热区使用", kind: "dyn", size: 800, body: () => SAMPLE.hits }, skill, tool, repair],
      dream_tiering_defrag: [sys, mem(), { t: "命中统计", src: "14 天命中 · 30 天热区使用", kind: "dyn", size: 800, body: () => SAMPLE.hits }, { t: "主题页与死链", src: "全部主题页 · 悬空链接", kind: "dyn", size: 900, body: () => SAMPLE.pages + "\n\n" + SAMPLE.dangling }, skill, tool, repair],
    };
    return M[n] || [sys];
  };
  const KIND = { fixed: ["固定", "var(--primary)"], dyn: ["每次注入", "var(--blue)"], cond: ["按需出现", "var(--orange)"] };

  function contextList(n) {
    const blocks = ctxBlocks(n);
    const sel = S.ctx[n] ?? 0;
    const total = blocks.reduce((a, b) => a + b.size, 0);
    return `<div class="legend">${Object.values(KIND).map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}<span class="grow"></span><span>约 ${total.toLocaleString()} 字</span></div>
      <div class="ctx-bar">${blocks.map((b) => `<i style="width:${(b.size / total) * 100}%;background:${KIND[b.kind][1]};opacity:${b.kind === "cond" ? 0.45 : 0.85}" title="${esc(b.t)}"></i>`).join("")}</div>
      <div class="ctx-list">${blocks
        .map((b, i) => `<div class="ctx-item ${b.kind === "cond" ? "cond" : ""} ${sel === i ? "on" : ""}" data-ctx="${n}|${i}">
          <span class="idx">${String(i + 1).padStart(2, "0")}</span>
          <div><div class="ttl">${esc(b.t)}</div><div class="src">${esc(b.src)}</div></div>
          <span class="tag" style="color:${KIND[b.kind][1]};background:#fff">${KIND[b.kind][0]}</span></div>`)
        .join("")}</div>`;
  }
  function contextPreview(n) {
    const b = ctxBlocks(n)[S.ctx[n] ?? 0];
    return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><b>${esc(b.t)}</b><span class="muted">${b.kind === "fixed" ? "真实内容" : "示例内容"} · ${b.size.toLocaleString()} 字</span></div><pre class="code">${esc(b.body())}</pre>`;
  }

  /* ---------- prompts / skills / models ---------- */
  function promptTable(active) {
    return `<table class="table"><thead><tr><th>节点</th><th>Prompt 文件</th><th style="width:90px">正文</th><th style="width:90px">运行时</th><th>自动追加</th><th style="width:80px">状态</th></tr></thead><tbody>${G.specs
      .map((s) => {
        const d = draft(s.name);
        const add = [(s.skills || []).length && "技能索引", s.output_schema && "输出 Schema"].filter(Boolean);
        return `<tr class="click ${active === s.name ? "on" : ""}" data-prompt="${s.name}"><td><div class="name">${esc(metaOf(s.name).title)}</div><div class="sub">${s.name}</div></td>
          <td class="mono">${esc(metaOf(s.name).promptFile)}</td><td>${d.prompt.length} 字</td><td><b>${s.system_prompt_chars}</b> 字</td>
          <td><div class="tags">${add.map((x) => tag(x, "purple")).join("")}</div></td>
          <td>${isDirty(s.name) ? `<span class="dirty"><span class="dot"></span>未保存</span>` : isModified(s.name) ? tag("已修改", "orange") : `<span class="muted">默认</span>`}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  function slotTable() {
    const llms = G.models.models.filter((m) => m.protocol === "openai");
    const opts = (slot) => {
      const cur = S.slotsDraft[slot];
      const pool = slot.startsWith("embedding") ? G.models.models.filter((m) => m.protocol === "openai-embedding") : slot.startsWith("rerank") ? G.models.models.filter((m) => m.protocol === "dashscope-rerank") : llms;
      return pool.map((m) => `<option value="${m.key}" ${m.key === cur ? "selected" : ""}>${esc(m.label)} · ${esc(m.model)}</option>`).join("");
    };
    return `<table class="table"><thead><tr><th>模型槽</th><th>当前模型</th><th>使用节点</th><th style="width:90px">思考</th></tr></thead><tbody>${Object.keys(S.slotsDraft)
      .map((slot) => {
        const m = modelOf(S.slotsDraft[slot]), changed = S.slotsDraft[slot] !== S.slotsSaved[slot], th = thinkingOf(m);
        const users = usersOfSlot(slot);
        return `<tr><td><b class="mono">${slot}</b>${changed ? ` <span class="dirty"><span class="dot"></span>已改</span>` : ""}</td>
          <td><select class="select" style="max-width:320px" data-slot="${slot}">${opts(slot)}</select></td>
          <td><div class="tags">${users.length ? users.map((u) => tag(u, "purple")).join("") : `<span class="muted">${slot.startsWith("embedding") ? "索引同步 · 召回" : "召回重排"}</span>`}</div></td>
          <td>${th ? tag(...th) : `<span class="muted">—</span>`}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }
  function slotSaveBar() {
    const c = slotChanges().length;
    return `<span class="dirty">${c ? `<span class="dot"></span>${c} 个槽位未保存` : ""}</span><button class="btn" data-slot-reset ${c ? "" : "disabled"}>撤销</button><button class="btn btn-primary" data-slot-save ${c ? "" : "disabled"}>保存</button>`;
  }
  function modelTable() {
    return `<table class="table"><thead><tr><th>模型</th><th>提供方</th><th>协议</th><th>默认参数</th><th>思考</th></tr></thead><tbody>${G.models.models
      .map((m) => {
        const th = thinkingOf(m);
        const p = m.params ? Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(" · ") : m.dimensions ? `dimensions=${m.dimensions}` : "—";
        return `<tr><td><div class="name">${esc(m.label)}</div><div class="sub">${esc(m.model)}</div></td><td>${tag(m.provider, m.provider === "qwen" ? "blue" : "orange")}</td><td class="mono muted">${m.protocol}</td><td class="mono muted">${p}</td><td>${th ? tag(...th) : `<span class="muted">—</span>`}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  /* ---------- playground (mock) ---------- */
  const OPS = [
    { id: "capture", t: "录入", d: "记一句备忘" },
    { id: "ask", t: "提问", d: "凭模糊印象找回" },
    { id: "clarify", t: "澄清", d: "回答系统追问" },
    { id: "dream", t: "整理", d: "触发夜间整理" },
    { id: "reindex", t: "重建索引", d: "文件 → 数据库" },
  ];
  const SAMPLES = ["雕牌屏多少钱", "小黑什么时候打疫苗", "上次那个东西呢"];

  function playForm() {
    const p = S.play;
    const user = `<div class="field"><label>用户</label><select class="select sm" data-play="user"><option>demo</option><option>tex</option></select></div>`;
    const F = {
      capture: `${user}<div class="field"><label>原话</label><div><textarea class="textarea" style="min-height:90px;font-family:inherit;font-size:13px" data-play="text" placeholder="例如：小黑周六打疫苗 滨江店">${esc(p.text)}</textarea><div class="help">只入库，不调模型、不算向量。180 秒内连发归同一批次。</div></div></div>`,
      ask: `${user}<div class="field"><label>提问</label><div><input class="input" data-play="query" value="${esc(p.query)}"/><div class="row" style="margin-top:8px"><span class="muted">示例</span>${SAMPLES.map((q) => `<a data-sample="${esc(q)}">${tag(q, q === p.query ? "purple" : "plain")}</a>`).join("")}</div></div></div>`,
      clarify: `${user}<div class="field"><label>回答哪次追问</label><select class="select sm"><option>search #57 · 上次那个东西呢</option></select></div><div class="field"><label>补充</label><input class="input" data-play="text" value="${esc(p.text || "那个是指书房的升降桌")}"/></div>`,
      dream: `${user}<div class="field"><label>模式</label><div><div class="seg">${[["auto", "自动判断"], ["incremental", "增量"], ["defrag", "全局重整"]].map(([k, l]) => `<button class="${p.mode === k ? "on" : ""}" data-play-mode="${k}">${l}</button>`).join("")}</div><div class="help">自动：行数>180、死链≥5 或距上次 ≥7 天时走全局重整。</div></div></div>`,
      reindex: `${user}<div class="info-box">按文件哈希比对，只对变更的切片重新向量化。</div>`,
    };
    return `<div class="form">${F[p.op]}</div>`;
  }

  const tl = (title, meta, body, skip) => `<div class="tl ${skip ? "skip" : ""}"><div class="rail"><i></i><span></span></div><div class="body"><div class="row"><b>${title}</b><span class="meta">${meta}</span></div>${body ? `<div style="margin-top:4px">${body}</div>` : ""}</div></div>`;
  const kvs = (o) => `<div class="desc one" style="margin-top:6px">${Object.entries(o).map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}</div>`;

  function runPlay() {
    const p = S.play, R = {};
    if (p.op === "capture") {
      const now = Date.now(), same = now - p.lastCapture < 180000 && p.lastCapture;
      p.lastCapture = now;
      p.seq = (p.seq || 32) + 1;
      p.batch = same ? p.batch : `b-${(412 + (p.seq % 7)).toString().padStart(4, "0")}`;
      R.html = `<div class="row" style="margin-bottom:10px">${tag("已入库", "green")}<span class="muted">耗时 12 ms</span></div>${kvs({ msg_seq: `<b>#msg_${p.seq}</b>`, batch_id: `<span class="mono">${p.batch}</span> ${same ? tag("同批次", "blue") : tag("新批次")}`, 状态: tag("pending", "orange"), 待整理标记: "dirty_since 已置位" })}`;
    }
    if (p.op === "ask") {
      const q = p.query;
      if (q.includes("雕牌")) {
        R.html = `<div class="timeline">
          ${tl("search_router", "0.6s", `<span class="mono muted">queries</span> ${tag("雕牌屏")} ${tag("便携屏 价格")}　<span class="mono muted">unknown</span> ${tag("雕牌屏", "orange")}`)}
          ${tl("混合召回", "0.3s", `6 条结果，最高相关度 <b>0.41</b>`)}
          ${tl("search_answer", "1.2s", `${tag("insufficient", "orange")} 看不懂“雕牌屏”`)}
          ${tl("search_cache_probe", "2.1s", `命中 <span class="mono">MEMORY_CACHE/slang.md</span> · 雕牌屏 → ${tag("CFORCE 15.6 便携屏 价格", "blue")}`)}
          ${tl("改写后重新召回 + 作答", "1.4s", tag("answered", "green"))}
        </div>`;
        R.answer = { text: "CFORCE 15.6 寸 OLED 便携屏，目标价 999 元（10 月 3 日记录）。", seqs: [12], docs: ["wiki/digital-gear.md"] };
      } else if (q.includes("小黑")) {
        R.html = `<div class="timeline">
          ${tl("search_router", "0.5s", `热区命中 ${tag("小黑 = 家里的猫", "purple")}　queries ${tag("猫 疫苗")} ${tag("小黑 疫苗")}`)}
          ${tl("混合召回", "0.3s", `6 条结果，最高相关度 <b>0.88</b>`)}
          ${tl("search_answer", "0.9s", tag("answered", "green"))}
          ${tl("search_cache_probe", "跳过", "已回答，不需要穿透", true)}
        </div>`;
        R.answer = { text: "这周六去滨江店打疫苗，记得带上次的本子。", seqs: [31, 32], docs: ["wiki/pets.md"] };
      } else {
        R.html = `<div class="timeline">
          ${tl("search_router", "0.4s", `queries ${tag(q.slice(0, 8) || "（空）")}　${tag("内容过少", "orange")}`)}
          ${tl("混合召回", "0.3s", "3 个候选：升降桌 / 便携屏 / 机械键盘")}
          ${tl("search_answer", "1.0s", tag("ambiguous", "orange"))}
          ${tl("search_cache_probe", "跳过", "没有未知暗语", true)}
        </div>`;
        R.clarify = "你说的是书房的升降桌、便携屏，还是机械键盘？";
      }
    }
    if (p.op === "clarify") {
      R.html = `<div class="timeline">
        ${tl("澄清入库", "8ms", kvs({ msg_seq: "<b>#msg_34</b>", source_kind: tag("clarification", "purple"), reply_to: "search #57" }))}
        ${tl("带补充重新提问", "2.2s", tag("answered", "green"))}
      </div>`;
      R.answer = { text: "书房升降桌看中乐歌 E5，预算 1500 内，等双十一。", seqs: [18, 34], docs: ["wiki/home-study-desk.md"] };
    }
    if (p.op === "dream") {
      const defrag = p.mode === "defrag";
      R.html = `<div class="timeline">
        ${tl("脏队列 + 加锁", "20ms", `模式 ${defrag ? tag("全局重整", "orange") : tag("增量", "blue")}`)}
        ${tl("dream_archive", "38s", `归档 ${tag("#31", "green")} ${tag("#32", "green")}　改动 <span class="mono">wiki/pets.md</span>`)}
        ${tl("sync_wiki", "1.6s", "3 个切片重新向量化")}
        ${tl(defrag ? "dream_tiering_defrag" : "dream_tiering", defrag ? "52s" : "21s", `晋升 ${tag("雕牌屏 → MEMORY.md", "green")}${defrag ? ` 下沉 ${tag("老张 → CACHE", "orange")} 修复死链 1` : ""}`)}
        ${tl("锚点对账", "40ms", "2 条原话 → archived")}
        ${tl("Git 提交", "60ms", `<span class="mono">a1b2c3d</span> dream: 2 archived, 1 promoted`)}
      </div>`;
    }
    if (p.op === "reindex") {
      R.html = `${kvs({ 扫描文件: "<b>12</b>", 有变更: "<b>2</b>", 切片: `${tag("+5", "green")} ${tag("−1", "red")}`, 向量化: "5 次 · text-embedding-v4", 耗时: "2.4s" })}`;
    }
    S.play.result = R;
  }

  function playResult() {
    const R = S.play.result;
    if (!R) return `<div class="empty">${icon("play")}<div style="margin-top:6px">填好左侧参数后点击运行</div></div>`;
    return `${R.answer ? `<div class="card" style="border-color:var(--green-line);background:var(--green-bg);box-shadow:none;margin-bottom:14px"><div class="card-body">
        <div class="muted" style="font-size:12px">答案</div><div style="font-size:15px;font-weight:600;margin:4px 0 8px">${esc(R.answer.text)}</div>
        <div class="row">${R.answer.seqs.map((s) => tag(`#msg_${s}`, "green")).join("")}${R.answer.docs.map((d) => tag(d, "plain")).join("")}</div></div></div>` : ""}
      ${R.clarify ? `<div class="card" style="border-color:var(--orange-line);background:var(--orange-bg);box-shadow:none;margin-bottom:14px"><div class="card-body"><div class="muted" style="font-size:12px">系统追问</div><div style="font-size:15px;font-weight:600;margin-top:4px">${esc(R.clarify)}</div><a data-play-op="clarify" style="display:inline-block;margin-top:8px">去澄清 →</a></div></div>` : ""}
      ${R.html}`;
  }

  /* ---------- prompt version UI ---------- */
  const verStatus = (n, v) => (v.id === activeVer(n) ? tag("使用中", "green") : v.draft ? tag("草稿", "orange") : tag("历史"));

  function versionTable(n, compact) {
    const V = vers(n);
    const rows = [...V.list].reverse();
    return `<table class="table"><thead><tr><th style="width:70px">版本</th><th>说明</th>${compact ? "" : `<th style="width:70px">字数</th><th style="width:150px">时间</th>`}<th style="width:80px">状态</th><th style="width:${compact ? 130 : 190}px">操作</th></tr></thead><tbody>${rows
      .map((v) => {
        const on = v.id === V.active;
        return `<tr class="${V.view === v.id && !V.editing ? "on" : ""}"><td><b class="mono">${v.id}</b></td><td>${esc(v.note)}${compact ? "" : `<div class="sub" style="font-family:inherit">${esc(v.author)}</div>`}</td>
          ${compact ? "" : `<td>${v.prompt.length}</td><td class="muted">${v.at}</td>`}<td>${verStatus(n, v)}</td>
          <td><div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-text btn-sm" data-ver-view="${n}|${v.id}">查看</button>
          ${on ? "" : `${compact ? "" : `<button class="btn btn-text btn-sm" data-ver-compare="${n}|${v.id}">对比</button>`}<button class="btn btn-text btn-sm" data-ver-activate="${n}|${v.id}">启用</button>`}</div></td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  function versionPanel(n) {
    const V = vers(n);
    if (V.editing) {
      const e = V.editing;
      return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><b>新建版本 <span class="mono">v${V.list.length + 1}</span></b><span class="muted">基于 ${e.base}</span></div>
        <div class="form" style="gap:10px">
          <input class="input" data-ver-note="${n}" placeholder="版本说明，例如：收紧追问条件" value="${esc(e.note)}"/>
          <textarea class="textarea" style="min-height:340px" data-ver-text="${n}">${esc(e.text)}</textarea>
          <div class="row"><span class="muted" data-ver-count="${n}">${e.text.length} 字</span><span class="grow"></span>
            <button class="btn" data-ver-cancel="${n}">取消</button><button class="btn" data-ver-save="${n}|draft">保存草稿</button><button class="btn btn-primary" data-ver-save="${n}|activate">保存并启用</button></div>
        </div>`;
    }
    if (V.compare) {
      const from = verOf(n, V.compare), to = verOf(n, V.active);
      const d = lineDiff(from.prompt, to.prompt);
      const add = d.filter((x) => x[0] === "+").length, del = d.filter((x) => x[0] === "-").length;
      return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="row"><b class="mono">${from.id}</b>${icon("arrow")}<b class="mono">${to.id}</b>${tag("使用中", "green")}<span class="muted">${tag(`+${add}`, "green")} ${tag(`−${del}`, "red")}</span></div><button class="btn btn-sm" data-ver-view="${n}|${V.active}">关闭对比</button></div>
        <pre class="code diff-code">${d.map(([k, l]) => `<span class="dl ${k === "+" ? "add" : k === "-" ? "del" : ""}"><i>${k}</i>${esc(l) || " "}</span>`).join("")}</pre>`;
    }
    const v = verOf(n, V.view) || verOf(n, V.active);
    return `<div class="row" style="justify-content:space-between;margin-bottom:10px">
        <div class="row"><b class="mono">${v.id}</b>${verStatus(n, v)}<span class="muted">${esc(v.note)} · ${v.at}</span></div>
        <div class="row">${v.id !== V.active ? `<button class="btn btn-sm" data-ver-activate="${n}|${v.id}">启用此版本</button>` : ""}<button class="btn btn-sm btn-primary" data-ver-new="${n}|${v.id}">${icon("edit")}基于此版本新建</button></div></div>
      ${v.id === V.active ? `<div class="legend" style="margin-bottom:8px"><span><i style="background:#fff;border:1px solid var(--line)"></i>版本正文</span><span><i style="background:var(--primary-weak);border:1px solid var(--primary)"></i>运行时自动追加（技能索引 · 输出格式）</span></div>` : ""}
      <pre class="code">${esc(v.prompt)}${v.id === V.active ? `<span class="inj">${esc(promptSuffix(n))}</span>` : ""}</pre>`;
  }

  function keyStrip(n) {
    const s = specOf(n), md = effModel(s), th = thinkingOf(md);
    const cell = (l, v) => `<div><div class="label">${l}</div><div class="val">${v}</div></div>`;
    return `<div class="key-strip">
      ${cell("模型", `<span class="mono">${esc(md.model)}</span> ${th ? tag(...th) : ""}`)}
      ${cell("最大轮次", `${draft(n).max_turns}`)}
      ${cell("工具", `${s.tools.length} <span class="tags" style="display:inline-flex;vertical-align:middle">${permSummary(s).map(([t, c]) => tag(t, c)).join("")}</span>`)}
      ${cell("Prompt", `${tag(activeVer(n), "green")} <span class="muted" style="font-size:12px;font-weight:400">${activePrompt(n).length} 字</span>`)}
      ${cell("Skill", (s.skills || []).length ? s.skills.map((k) => tag(k, "purple")).join("") : `<span class="muted" style="font-weight:400">—</span>`)}
    </div>`;
  }

  function recentRuns(n, limit = 5) {
    const s = specOf(n);
    let h = [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
    const rows = Array.from({ length: limit }, (_, i) => {
      const r = rnd(), turns = s.max_turns === 1 ? 1 : 1 + Math.floor(rnd() * Math.min(s.max_turns, 8));
      const status = r > 0.93 ? ["轮数用尽", "red"] : r > 0.82 ? ["修复 1 次", "orange"] : ["成功", "green"];
      const sec = s.agent === "dream" ? 12 + rnd() * 40 : 0.4 + rnd() * 2;
      return `<tr><td class="muted mono">11-13 ${String(3 - Math.floor(i / 2)).padStart(2, "0")}:${String(59 - i * 7).padStart(2, "0")}</td><td>${tag(status[0], status[1])}</td><td>${turns}</td><td>${sec.toFixed(1)}s</td><td class="mono muted">${Math.round(800 + rnd() * 6000)}</td><td>${tag(activeVer(n), "plain")}</td></tr>`;
    });
    return `<table class="table"><thead><tr><th>时间</th><th>结果</th><th>轮次</th><th>耗时</th><th>tokens</th><th>Prompt</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  /* ---------- overlay ---------- */
  function overlay() {
    if (!S.modal) return "";
    const m = S.modal;
    const rows = m.rows
      .map((r) => r.plain !== undefined
        ? `<tr><td style="width:120px"><b>${esc(r.label)}</b></td><td colspan="3">${r.plain}</td></tr>`
        : `<tr><td style="width:120px"><b>${esc(r.label)}</b>${r.affects ? `<div class="muted">影响 ${r.affects.length} 个节点</div>` : ""}</td><td><span class="old">${esc(r.old)}</span></td><td style="width:20px">→</td><td><span class="new">${esc(r.now)}</span></td></tr>`)
      .join("");
    return `<div class="mask modal-mask" data-modal-close></div><div class="modal">
      <div class="modal-head">${esc(m.title)}</div>
      <div class="modal-body"><table class="diff">${rows}</table><div class="info-box" style="margin-top:12px">预览环境：保存只在当前页面生效，不会写入代码或配置。</div></div>
      <div class="modal-foot"><button class="btn" data-modal-close>取消</button><button class="btn btn-primary" data-modal-ok>确认保存</button></div></div>`;
  }

  function verModal(n, id) {
    const cur = verOf(n, activeVer(n)), next = verOf(n, id);
    const d = lineDiff(cur.prompt, next.prompt);
    return {
      kind: "ver", n, id, title: `启用 ${n} 的 Prompt ${id}`,
      rows: [
        { label: "使用中版本", old: cur.id, now: next.id },
        { label: "字数", old: String(cur.prompt.length), now: String(next.prompt.length) },
        { label: "差异", plain: `${tag(`+${d.filter((x) => x[0] === "+").length} 行`, "green")} ${tag(`−${d.filter((x) => x[0] === "-").length} 行`, "red")}　下次调用起生效` },
      ],
    };
  }

  /* ---------- events ---------- */
  function syncDirty(root, n) {
    const b = baseline(n), d = draft(n), c = changes(n).length;
    root.querySelectorAll(`[data-field^="${n}|"]`).forEach((el) => {
      const k = el.dataset.field.split("|")[1];
      el.classList.toggle("changed", JSON.stringify(b[k]) !== JSON.stringify(d[k]));
    });
    root.querySelectorAll(`[data-dirty="${n}"],[data-dirty-bar="${n}"]`).forEach((el) => (el.innerHTML = c ? `<span class="dot"></span>${c} 项未保存` : ""));
    root.querySelectorAll(`[data-save="${n}"],[data-reset="${n}"]`).forEach((el) => (el.disabled = !c));
    root.querySelectorAll(`[data-count="${n}"]`).forEach((el) => (el.textContent = `${d.prompt.length} 字`));
    root.querySelectorAll(`[data-out="${n}|temperature"]`).forEach((el) => (el.textContent = d.temperature));
  }

  function onInput(e, root) {
    const t = e.target;
    if (t.dataset.cfg) {
      const [n, k] = t.dataset.cfg.split("|");
      const d = draft(n);
      if (k === "prompt") d.prompt = t.value;
      else if (k === "temperature") d.temperature = Number(t.value);
      else d[k] = Math.max(k === "max_repairs" ? 0 : 1, parseInt(t.value || "0", 10) || 0);
      syncDirty(root, n);
      return false;
    }
    if (t.dataset.play) {
      S.play[t.dataset.play] = t.value;
      return false;
    }
    if (t.dataset.verText) {
      const e = vers(t.dataset.verText).editing;
      e.text = t.value;
      root.querySelectorAll(`[data-ver-count="${t.dataset.verText}"]`).forEach((el) => (el.textContent = `${e.text.length} 字`));
      return false;
    }
    if (t.dataset.verNote) {
      vers(t.dataset.verNote).editing.note = t.value;
      return false;
    }
    if (t.dataset.slot) {
      S.slotsDraft[t.dataset.slot] = t.value;
      return true;
    }
    return false;
  }

  async function onClick(e) {
    const t = e.target.closest("[data-stp],[data-tgl],[data-reset],[data-save],[data-modal-close],[data-modal-ok],[data-pmode],[data-copy-prompt],[data-ctx],[data-cfg-reset-prompt],[data-slot-save],[data-slot-reset],[data-play-op],[data-play-run],[data-play-mode],[data-sample],[data-ver-view],[data-ver-compare],[data-ver-activate],[data-ver-new],[data-ver-save],[data-ver-cancel]");
    if (!t) return false;
    const ds = t.dataset;
    if (ds.verView) {
      const [n, id] = ds.verView.split("|"), V = vers(n);
      Object.assign(V, { view: id, compare: null, editing: null });
      return true;
    }
    if (ds.verCompare) {
      const [n, id] = ds.verCompare.split("|"), V = vers(n);
      Object.assign(V, { compare: id, editing: null });
      return true;
    }
    if (ds.verNew) {
      const [n, id] = ds.verNew.split("|"), V = vers(n);
      V.editing = { base: id, text: verOf(n, id).prompt, note: "" };
      V.compare = null;
      return true;
    }
    if (ds.verCancel) {
      vers(ds.verCancel).editing = null;
      return true;
    }
    if (ds.verSave) {
      const [n, how] = ds.verSave.split("|"), V = vers(n), e = V.editing;
      if (!e.note.trim()) { toast("请填写版本说明"); return false; }
      if (e.text === verOf(n, e.base).prompt) { toast("内容与基准版本相同"); return false; }
      const id = `v${V.list.length + 1}`;
      V.list.push({ id, prompt: e.text, note: e.note.trim(), author: "我", at: nowStr(), draft: true });
      V.editing = null;
      V.view = id;
      if (how === "activate") S.modal = verModal(n, id);
      else toast(`已保存草稿 ${id}`);
      return true;
    }
    if (ds.verActivate) {
      const [n, id] = ds.verActivate.split("|");
      S.modal = verModal(n, id);
      return true;
    }
    if (ds.stp) {
      const [n, k, dv] = ds.stp.split("|");
      const d = draft(n);
      d[k] = Math.min(60, Math.max(k === "max_repairs" ? 0 : 1, d[k] + Number(dv)));
      return true;
    }
    if (ds.tgl) {
      const [n, k, v] = ds.tgl.split("|");
      const d = draft(n), base = k === "tools" ? specOf(n).tools.map((x) => x.name) : specOf(n).skills;
      d[k] = d[k].includes(v) ? d[k].filter((x) => x !== v) : base.filter((x) => d[k].includes(x) || x === v);
      return true;
    }
    if (ds.cfgResetPrompt) {
      draft(ds.cfgResetPrompt).prompt = baseline(ds.cfgResetPrompt).prompt;
      return true;
    }
    if (ds.reset) {
      delete S.drafts[ds.reset];
      toast("已撤销修改");
      return true;
    }
    if (ds.save) {
      S.modal = { kind: "spec", n: ds.save, title: `保存 ${ds.save} 的修改`, rows: changes(ds.save) };
      return true;
    }
    if ("slotSave" in ds) {
      S.modal = { kind: "slot", title: "保存模型槽修改", rows: slotChanges() };
      return true;
    }
    if ("slotReset" in ds) {
      S.slotsDraft = { ...S.slotsSaved };
      return true;
    }
    if ("modalClose" in ds) {
      S.modal = null;
      return true;
    }
    if ("modalOk" in ds) {
      const m = S.modal;
      if (m.kind === "ver") {
        const V = vers(m.n), v = verOf(m.n, m.id);
        V.active = m.id;
        V.view = m.id;
        V.compare = null;
        v.draft = false;
        if (S.drafts[m.n]) S.drafts[m.n].prompt = v.prompt;
        S.modal = null;
        toast(`已启用 ${m.id}（预览）`);
        return true;
      }
      if (m.kind === "spec") {
        const d = JSON.parse(JSON.stringify(draft(m.n)));
        if (d.prompt !== activePrompt(m.n)) {
          const V = vers(m.n), id = `v${V.list.length + 1}`;
          V.list.push({ id, prompt: d.prompt, note: "配置页直接修改", author: "我", at: nowStr() });
          V.active = V.view = id;
        }
        delete d.prompt;
        S.saved[m.n] = d;
        delete S.drafts[m.n];
      } else {
        S.slotsSaved = { ...S.slotsDraft };
      }
      S.modal = null;
      toast("已保存（预览）");
      return true;
    }
    if (ds.pmode) {
      S.promptMode = ds.pmode;
      return true;
    }
    if (ds.copyPrompt) {
      const s = specOf(ds.copyPrompt), d = draft(ds.copyPrompt);
      const text = S.promptMode === "raw" ? d.prompt : d.prompt + s.system_prompt_final.slice(s.system_prompt_raw.length);
      try { await navigator.clipboard.writeText(text); toast("已复制"); } catch { toast("复制失败，请手动选择"); }
      return false;
    }
    if (ds.ctx) {
      const [n, i] = ds.ctx.split("|");
      S.ctx[n] = Number(i);
      return true;
    }
    if (ds.playOp) {
      S.play.op = ds.playOp;
      S.play.result = null;
      if (ds.playOp === "clarify") S.play.text = "";
      return true;
    }
    if (ds.playMode) {
      S.play.mode = ds.playMode;
      return true;
    }
    if (ds.sample) {
      S.play.query = ds.sample;
      return true;
    }
    if ("playRun" in ds) {
      runPlay();
      return true;
    }
    return false;
  }

  w.UI = {
    S, icon, tag, esc, specOf, metaOf, agentOf, scopeOf, effModel, thinkingOf, permSummary, isDirty, isModified, changes, allTools, usersOfTool,
    ARCH, FLOWS, OPS, archDiagram, archDetail, flowSteps, flowDetail, stats, memoryLayers, guide, agentCard, specTable,
    specHeader, specOverview, specBoundary, specForm, saveBar, promptBlock, skillBlock, contextList, contextPreview,
    promptTable, slotTable, slotSaveBar, modelTable, playForm, playResult, overlay, onInput, onClick, toast,
    vers, activeVer, activePrompt, versionTable, versionPanel, keyStrip, recentRuns,
  };
})(window);
