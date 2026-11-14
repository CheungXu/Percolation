const { UI } = window;
const { icon, tag, esc } = UI;
const CAT = window.PERC_CATALOG, GEN = window.PERC_GEN;

const MENU = [
  ["", [["home", "概览", "home"]]],
  ["整体架构", [["arch", "架构图", "layers"], ["flow", "核心工作流", "flow"]]],
  ["Agent 配置", [["agents", "Agent Hub", "bot"], ["specs", "AgentSpec", "list"], ["models", "模型槽", "cpu"]]],
  ["上下文管理", [["context", "上下文构成", "stack"], ["prompts", "System Prompt", "file"], ["skills", "Skill", "book"]]],
  ["操作", [["play", "调试台", "play"]]],
];
const GROUP = Object.fromEntries(MENU.flatMap(([g, items]) => items.map(([id, t]) => [id, [g, t]])));
GROUP.spec = ["Agent 配置", "AgentSpec"];

const st = {
  page: "home", arch: "search", flow: "search", step: 1,
  q: "", agent: "", write: false,
  drawer: null, tab: "overview",
  spec: null,
  ctxSpec: "search_answer", promptSpec: "search_router",
};
const go = (page) => { st.page = page; st.drawer = null; window.scrollTo(0, 0); };

function side() {
  return `<aside class="side"><div class="brand"><span class="mark">P</span>Percolation</div>
    ${MENU.map(([g, items]) => `${g ? `<div class="lbl">${g}</div>` : ""}${items.map(([id, t, ic]) => {
      const on = st.page === id || (id === "specs" && st.page === "spec");
      const dirty = id === "specs" && GEN.specs.some((s) => UI.isDirty(s.name));
      return `<a class="${on ? "on" : ""}" data-go="${id}">${icon(ic)}${t}${dirty ? `<span class="end dirty"><span class="dot"></span></span>` : ""}</a>`;
    }).join("")}`).join("")}
    <div class="foot">只读控制台 · 仅白名单可见<br/>修改仅在当前页面生效<br/><a href="../" style="display:inline-flex;margin-top:8px;padding:0;height:auto;color:var(--primary)">← 返回拾记凝境</a></div></aside>`;
}

const crumb = () => {
  const [g, t] = GROUP[st.page] || ["", ""];
  if (st.page === "spec") return `<div class="crumb">${g}${icon("chev")}<a data-go="specs">AgentSpec</a>${icon("chev")}<span>${st.spec}</span></div>`;
  return `<div class="crumb">${g ? `${g}${icon("chev")}<span>${t}</span>` : ""}</div>`;
};
const head = (title, sub, right = "") => `${crumb()}<div class="hero"><div><h1 style="font-size:22px">${title}</h1><div class="muted" style="margin-top:2px">${sub}</div></div><div class="row">${right}</div></div>`;
const sec = (id, title, hint, body, foot = "", headRight = "") => `<section class="card sec" id="${id}"><div class="card-head"><h3>${title} ${hint ? `<span class="hint">${hint}</span>` : ""}</h3><div class="row">${headRight}</div></div><div class="card-body">${body}</div>${foot}</section>`;
const flush = (html) => `<div style="margin:-14px -16px">${html}</div>`;

const pages = {
  home: () => `<div class="inner">${head("概览", "零负担录入 · 后台整理 · 模糊提问也能找回")}
    ${UI.stats()}
    <div class="grid g2" style="margin-top:16px">
      ${sec("guide", "新人上手", "按顺序看完约 10 分钟", UI.guide())}
      ${sec("layers", "记忆四层", "", flush(UI.memoryLayers()))}
    </div>
    <div class="section-title">业务 Agent <a data-go="agents" class="hint" style="margin-left:auto">Agent Hub →</a></div>
    <div class="grid g2">${CAT.agents.map(UI.agentCard).join("")}</div></div>`,

  arch: () => `<div class="inner">${head("架构图", "五层结构：入口 → 业务 Agent → 确定性程序 → agentkit 内核 → 存储与模型")}
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start">
      <div class="card"><div class="card-body">${UI.archDiagram(st.arch)}</div></div>
      <div class="card sticky"><div class="card-head"><h3>模块说明</h3></div><div class="card-body">${UI.archDetail(st.arch)}</div></div>
    </div></div>`,

  flow: () => {
    const f = UI.FLOWS[st.flow];
    return `<div class="inner">${head("核心工作流", `触发：${f.when}`, `<div class="seg">${Object.entries(UI.FLOWS).map(([k, v]) => `<button class="${st.flow === k ? "on" : ""}" data-flow="${k}">${v.name}</button>`).join("")}</div>`)}
    <div class="card"><div class="card-body" style="padding:20px 16px">${UI.flowSteps(st.flow, st.step)}</div>
    <div class="card-body" style="border-top:1px solid var(--line-2)">${UI.flowDetail(st.flow, st.step)}</div>
    <div class="card-foot"><button class="btn" data-prev ${st.step ? "" : "disabled"}>上一步</button><button class="btn btn-primary" data-next ${st.step < f.steps.length - 1 ? "" : "disabled"}>下一步</button></div></div></div>`;
  },

  agents: () => `<div class="inner">${head("Agent Hub", "业务 Agent 由若干 AgentSpec 节点组成，节点之间由 Python 代码编排", `<button class="btn" data-go="specs">${icon("list")}全部节点</button>`)}
    <div class="grid g2">${CAT.agents.map(UI.agentCard).join("")}</div></div>`,

  specs: () => `<div class="inner">${head("AgentSpec", "每个节点 = 模型槽 + Prompt + 工具 + 输出格式 + 轮次。点击一行快速查看和修改")}
    <div class="card"><div class="toolbar">
      <label>Agent</label><select class="select sm" data-filter="agent"><option value="">全部</option>${CAT.agents.map((a) => `<option value="${a.id}" ${st.agent === a.id ? "selected" : ""}>${a.name}</option>`).join("")}</select>
      <label style="margin-left:8px">搜索</label><input class="input sm" data-filter="q" placeholder="节点名 / 职责" value="${esc(st.q)}"/>
      <span class="row" style="margin-left:8px"><button class="switch ${st.write ? "on" : ""}" data-filter-write></button>只看可写节点</span>
    </div>${UI.specTable({ agent: st.agent, q: st.q, write: st.write, ver: true, active: st.drawer })}</div></div>`,

  spec: () => {
    const n = st.spec, s = UI.specOf(n);
    const toc = [["s-basic", "概览"], ["s-config", "运行配置"], ["s-tools", "工具与权限"], ["s-prompt", "System Prompt"], ["s-ctx", "上下文"], ["s-runs", "最近调用"]];
    return `<div class="with-toc"><div>
      ${crumb()}
      <div class="hero"><div class="grow">${UI.specHeader(n)}</div><div class="row"><button class="btn" data-debug="${n}">${icon("play")}调试</button><button class="btn" data-go="specs">返回列表</button></div></div>
      <div style="margin-bottom:18px">${UI.keyStrip(n)}</div>
      ${sec("s-basic", "概览", "", UI.specOverview(n))}
      ${sec("s-config", "运行配置", "修改后底部出现保存栏", UI.specForm(n, { noPrompt: true }))}
      ${sec("s-tools", "工具与权限", `${s.tools.length} 个工具`, UI.specBoundary(n))}
      ${sec("s-prompt", "System Prompt", `使用中 ${UI.activeVer(n)}`, `${flush(UI.versionTable(n))}<div style="margin-top:28px">${UI.versionPanel(n)}</div>`)}
      ${sec("s-ctx", "上下文", "模型每次调用看到的内容", `<div class="grid g2"><div>${UI.contextList(n)}</div><div>${UI.contextPreview(n)}</div></div>`)}
      ${sec("s-runs", "最近调用", "模拟数据", flush(UI.recentRuns(n, 8)))}
    </div>
    <nav class="toc"><div class="t">本页</div>${toc.map(([id, t]) => `<a data-anchor="${id}">${t}</a>`).join("")}</nav></div>
    <div class="float-bar">${UI.saveBar(n)}</div>`;
  },

  models: () => `<div class="inner">${head("模型槽", "节点只声明槽位；切换后共用该槽的节点同时生效")}
    ${sec("slots", "槽位绑定", "", flush(UI.slotTable()), `<div class="card-foot">${UI.slotSaveBar()}</div>`)}
    ${sec("models", "已注册模型", "config/models.json", flush(UI.modelTable()))}</div>`,

  context: () => `<div class="inner">${head("上下文构成", "模型每次调用时看到的内容，按注入顺序排列；点击左侧块在右侧查看")}
    <div class="split-ctx">
      ${specNav(st.ctxSpec, "data-ctx-spec")}
      <div class="card"><div class="card-head"><h3>${esc(UI.metaOf(st.ctxSpec).title)}</h3><span class="mono muted">${st.ctxSpec}</span></div><div class="card-body">${UI.contextList(st.ctxSpec)}</div></div>
      <div class="card sticky"><div class="card-body">${UI.contextPreview(st.ctxSpec)}</div></div>
    </div></div>`,

  prompts: () => {
    const n = st.promptSpec;
    return `<div class="inner">${head("System Prompt", "每个节点的 Prompt 按版本管理；同一时刻只有一个版本在使用")}
    <div class="split-prompt">
      ${specNav(n, "data-prompt-spec", true)}
      <div>
        <div class="card sec"><div class="card-head"><h3>${esc(UI.metaOf(n).title)} <span class="mono muted" style="font-weight:400">${n}</span></h3>
          <div class="row">${tag(`使用中 ${UI.activeVer(n)}`, "green")}<button class="btn btn-sm" data-open="${n}">节点配置</button></div></div>${UI.versionTable(n)}</div>
        <div class="card"><div class="card-body">${UI.versionPanel(n)}</div></div>
      </div>
    </div></div>`;
  },

  skills: () => `<div class="inner">${head("Skill", "目录常驻 Prompt（一行），正文由模型按需调用 read_skill 读取")}
    ${Object.keys(GEN.skills).map((k) => UI.skillBlock(k)).join("")}</div>`,

  play: () => {
    const op = UI.OPS.find((o) => o.id === UI.S.play.op);
    return `<div class="inner">${head("调试台", "模拟运行，展示每一步做了什么；不调用后端")}
    <div class="card" style="margin-bottom:14px"><div class="card-body"><div class="seg">${UI.OPS.map((o) => `<button class="${UI.S.play.op === o.id ? "on" : ""}" data-play-op="${o.id}">${o.t}</button>`).join("")}</div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);align-items:start">
      <div class="card"><div class="card-head"><h3>参数</h3><span class="muted">${op.d}</span></div><div class="card-body">${UI.playForm()}</div><div class="card-foot"><button class="btn btn-primary" data-play-run>${icon("play")}运行</button></div></div>
      <div class="card"><div class="card-head"><h3>运行结果</h3></div><div class="card-body">${UI.playResult()}</div></div>
    </div></div>`;
  },
};

function specNav(active, attr, showVer) {
  return `<div class="card navlist">${CAT.agents.map((a) => `<div class="grp">${a.name}</div>${a.specs.map((n) => `<a class="${active === n ? "on" : ""}" ${attr}="${n}"><span>${esc(UI.metaOf(n).title)}</span>${showVer ? `<span class="mono muted" style="font-size:11px">${UI.activeVer(n)}</span>` : ""}</a>`).join("")}`).join("")}</div>`;
}

function drawer() {
  const n = st.drawer;
  if (!n) return "";
  const s = UI.specOf(n), m = UI.metaOf(n), sc = UI.scopeOf(n);
  const tabs = [["overview", "概览"], ["config", "配置"], ["boundary", "工具与边界", s.tools.length], ["prompt", "Prompt", UI.activeVer(n)], ["context", "上下文"]];
  const body = {
    overview: () => `<div class="info-box" style="font-size:13px;margin-bottom:14px"><b>职责</b>　${esc(m.duty)}</div>
      <div class="grid g2" style="margin-bottom:14px">
        <div><div class="section-title" style="margin-top:0">输入</div><div class="tags">${(m.input || []).map((x) => tag(x, "blue")).join("")}</div></div>
        <div><div class="section-title" style="margin-top:0">输出 <span class="hint">${esc(s.output_model)}</span></div><div class="tags">${window.Perc.schemaFields(s.output_schema).map((f) => tag(f.key, "green")).join("")}</div></div>
      </div>
      <div class="desc" style="margin-bottom:14px">
        <div><span class="k">可写</span><span class="v">${sc.write?.length ? sc.write.map((x) => tag(x, "orange")).join(" ") : tag("无")}</span></div>
        <div><span class="k">删除</span><span class="v">${sc.del ? tag("允许", "red") : tag("禁止")}</span></div>
        <div><span class="k">隔离</span><span class="v">${[sc.sandbox && tag("bwrap 沙箱", "purple"), sc.db && tag("RLS 数据库", "blue")].filter(Boolean).join(" ") || "—"}</span></div>
        <div><span class="k">备注</span><span class="v">${esc(sc.note || "—")}</span></div>
      </div>
      <div class="section-title">最近调用 <span class="hint">模拟数据</span></div>${UI.recentRuns(n)}`,
    config: () => UI.specForm(n, { noPrompt: true }),
    boundary: () => UI.specBoundary(n),
    prompt: () => `${UI.versionTable(n, true)}<div style="margin-top:16px">${UI.versionPanel(n)}</div>`,
    context: () => `${UI.contextList(n)}<div style="margin-top:14px">${UI.contextPreview(n)}</div>`,
  }[st.tab]();
  return `<div class="mask" data-drawer-close></div><aside class="drawer">
    <div class="drawer-head"><div class="grow">${UI.specHeader(n)}</div>
      <div class="row"><button class="btn btn-sm" data-debug="${n}">${icon("play")}调试</button><button class="btn btn-sm btn-primary" data-full="${n}">完整页面 ${icon("arrow")}</button><button class="btn btn-text" data-drawer-close>${icon("x")}</button></div></div>
    <div class="drawer-strip" style="padding-top:12px">${UI.keyStrip(n)}</div>
    <div class="tabs">${tabs.map(([k, l, c]) => `<button class="${st.tab === k ? "on" : ""}" data-tab="${k}">${l}${c !== undefined ? `<span class="count">${c}</span>` : ""}</button>`).join("")}</div>
    <div class="drawer-body">${body}</div>
    <div class="drawer-foot">${UI.saveBar(n)}</div></aside>`;
}

function render() {
  document.getElementById("app").innerHTML = `<div class="layout">${side()}<main class="main">${pages[st.page]()}</main></div>${drawer()}${UI.overlay()}`;
}

const app = document.getElementById("app");
app.addEventListener("input", (e) => {
  if (e.target.dataset.filter === "q") {
    st.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = app.querySelector('[data-filter="q"]');
    el.focus();
    el.setSelectionRange(pos, pos);
    return;
  }
  if (UI.onInput(e, app)) render();
});
app.addEventListener("change", (e) => {
  if (e.target.dataset.filter === "agent") { st.agent = e.target.value; render(); }
});
app.addEventListener("click", async (e) => {
  if (await UI.onClick(e)) return render();
  const t = e.target.closest("[data-go],[data-arch],[data-flow],[data-flow-step],[data-prev],[data-next],[data-spec],[data-open],[data-agent],[data-tab],[data-drawer-close],[data-full],[data-debug],[data-ctx-spec],[data-prompt-spec],[data-prompt],[data-go-prompt],[data-filter-write],[data-anchor]");
  if (!t) return;
  const d = t.dataset;
  if (d.anchor) return document.getElementById(d.anchor)?.scrollIntoView({ behavior: "smooth" });
  if (d.go) go({ context: "context" }[d.go] || d.go);
  if (d.arch) st.arch = d.arch;
  if (d.flow) { st.flow = d.flow; st.step = 0; }
  if (d.flowStep) st.step = Number(d.flowStep);
  if ("prev" in d) st.step = Math.max(0, st.step - 1);
  if ("next" in d) st.step += 1;
  if (d.spec || d.open) {
    const n = d.spec || d.open;
    if (st.page === "spec") { st.spec = n; window.scrollTo(0, 0); }
    else { st.drawer = n; st.tab = "overview"; }
  }
  if (d.agent) { go("specs"); st.agent = d.agent; }
  if (d.tab) st.tab = d.tab;
  if ("drawerClose" in d) st.drawer = null;
  if (d.full) { go("spec"); st.spec = d.full; }
  if (d.debug) { const ag = UI.specOf(d.debug).agent; go("play"); UI.S.play.op = ag === "search" ? "ask" : "dream"; UI.S.play.result = null; }
  if (d.ctxSpec) st.ctxSpec = d.ctxSpec;
  if (d.promptSpec || d.prompt) st.promptSpec = d.promptSpec || d.prompt;
  if (d.goPrompt) { go("prompts"); st.promptSpec = d.goPrompt; }
  if ("filterWrite" in d) st.write = !st.write;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (UI.S.modal) UI.S.modal = null;
  else if (st.drawer) st.drawer = null;
  else return;
  render();
});
render();
