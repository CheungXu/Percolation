const { UI } = window;
const { icon, tag, esc } = UI;
const CAT = window.PERC_CATALOG, GEN = window.PERC_GEN;

const NAV = [["home", "总览", "home"], ["arch", "架构与流程", "layers"], ["agents", "Agent 配置", "bot"], ["context", "上下文", "stack"], ["models", "模型", "cpu"], ["play", "调试台", "play"]];
const st = { page: location.hash.slice(1) || "home", arch: "search", flow: "search", step: 1, spec: "search_router", tab: "overview", ctxView: "ctx", q: "" };

function tree(active, attr) {
  const q = st.q.trim().toLowerCase();
  return `<div class="tree"><div class="search"><input class="input" data-tree-q placeholder="搜索节点" value="${esc(st.q)}"/></div>
    ${CAT.agents.map((a) => {
      const list = a.specs.filter((n) => !q || (n + UI.metaOf(n).title).toLowerCase().includes(q));
      if (!list.length) return "";
      return `<div class="agent">${icon(a.id === "search" ? "search" : "moon")}${a.name}<small>${list.length}</small></div>${list.map((n) => {
        const m = UI.metaOf(n);
        const mark = UI.isDirty(n) ? `<span class="dirty"><span class="dot"></span></span>` : UI.isModified(n) ? tag("已改", "orange") : "";
        return `<a class="node ${active === n ? "on" : ""}" ${attr}="${n}"><b>${esc(m.step)} ${esc(m.title)}</b>${mark}<span class="mono">${n}</span></a>`;
      }).join("")}`;
    }).join(`<div class="gap"></div>`)}<div class="gap"></div></div>`;
}

function strip(n) {
  const s = UI.specOf(n), md = UI.effModel(s), th = UI.thinkingOf(md);
  return `<div class="hero-strip">
    <div><div class="label">模型</div><div class="val mono">${esc(md.model)}</div></div>
    <div><div class="label">最大轮次</div><div class="val">${UI.S.drafts[n]?.max_turns ?? (UI.S.saved[n]?.max_turns ?? s.max_turns)}</div></div>
    <div><div class="label">工具</div><div class="val">${s.tools.length} <span class="tags" style="display:inline-flex;vertical-align:middle">${UI.permSummary(s).map(([t, c]) => tag(t, c)).join("")}</span></div></div>
    <div><div class="label">思考 / Skill</div><div class="val">${th ? tag(...th) : "—"} ${(s.skills || []).map((k) => tag(k, "purple")).join("")}</div></div>
  </div>`;
}

const pages = {
  home: () => `<div class="page-head"><div><h1>总览</h1><div class="sub">Percolation：零负担录入，后台整理，模糊提问也能找回。</div></div></div>
    ${UI.stats()}
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 360px;margin-top:14px">
      <div class="card"><div class="card-head"><h3>${icon("flow")}一次提问经过的步骤</h3><a data-go="arch">详细流程 →</a></div><div class="card-body" style="padding:18px 16px">${UI.flowSteps("search", -1)}</div>
        <div class="card-head" style="border-top:1px solid var(--line-2)"><h3>${icon("moon")}每晚整理的步骤</h3></div><div class="card-body" style="padding:18px 16px">${UI.flowSteps("dream", -1)}</div></div>
      <div class="card"><div class="card-head"><h3>${icon("compass")}新人上手</h3></div><div class="card-body" style="padding:4px 16px">${UI.guide()}</div></div>
    </div>
    <div class="section-title">记忆四层</div><div class="card">${UI.memoryLayers()}</div>`,

  arch: () => `<div class="page-head"><div><h1>架构与流程</h1><div class="sub">上半部分是静态结构，下半部分是运行时流程</div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px">
      <div class="card"><div class="card-head"><h3>${icon("layers")}分层架构</h3><span class="muted">点击模块查看说明</span></div><div class="card-body">${UI.archDiagram(st.arch)}</div></div>
      <div class="card"><div class="card-body">${UI.archDetail(st.arch)}</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h3>${icon("flow")}工作流</h3><div class="seg">${Object.entries(UI.FLOWS).map(([k, v]) => `<button class="${st.flow === k ? "on" : ""}" data-flow="${k}">${v.name}</button>`).join("")}</div></div>
      <div class="card-body" style="padding:18px 16px">${UI.flowSteps(st.flow, st.step)}</div>
      <div class="card-body" style="border-top:1px solid var(--line-2)">${UI.flowDetail(st.flow, st.step)}</div>
    </div>`,

  agents: () => {
    const n = st.spec, s = UI.specOf(n);
    const tabs = [["overview", "概览"], ["boundary", "工具与边界"], ["config", "配置"], ["prompt", "Prompt"]];
    const body = { overview: UI.specOverview, boundary: UI.specBoundary, config: UI.specForm, prompt: UI.promptBlock }[st.tab](n);
    const agent = UI.agentOf(s.agent);
    return `<div class="md">${tree(n, "data-pick")}
      <div>
        <div class="card" style="margin-bottom:12px"><div class="card-body row" style="justify-content:space-between">
          <div class="row">${icon(agent.id === "search" ? "search" : "moon")}<b>${agent.name}</b><span class="muted">${esc(agent.job)}</span></div>
          <div class="row muted"><span class="mono">${agent.file}</span></div></div></div>
        <div class="card">
          <div class="detail-head"><div class="grow">${UI.specHeader(n)}${strip(n)}</div><div class="row">${UI.saveBar(n)}</div></div>
          <div class="detail-tabs"><div class="tabs">${tabs.map(([k, l]) => `<button class="${st.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div></div>
          <div class="detail-body">${body}</div>
        </div>
      </div></div>`;
  },

  context: () => {
    const n = st.spec;
    const sub = `<div class="subnav"><div class="seg">${[["ctx", "上下文构成"], ["prompt", "System Prompt"], ["skill", "Skill"]].map(([k, l]) => `<button class="${st.ctxView === k ? "on" : ""}" data-ctxview="${k}">${l}</button>`).join("")}</div></div>`;
    if (st.ctxView === "skill") return `${sub}${Object.keys(GEN.skills).map((k) => UI.skillBlock(k)).join("")}`;
    if (st.ctxView === "prompt")
      return `${sub}<div class="md">${tree(n, "data-pick")}<div class="card"><div class="card-head"><h3>${esc(UI.metaOf(n).title)} <span class="mono muted" style="font-weight:400">${n}</span></h3><button class="btn btn-sm" data-edit="${n}">${icon("edit")}去编辑</button></div><div class="card-body">${UI.promptBlock(n)}</div></div></div>`;
    return `${sub}<div class="md3">${tree(n, "data-pick")}
      <div class="card"><div class="card-head"><h3>注入顺序</h3><span class="mono muted">${n}</span></div><div class="card-body">${UI.contextList(n)}</div></div>
      <div class="card"><div class="card-body">${UI.contextPreview(n)}</div></div></div>`;
  },

  models: () => `<div class="page-head"><div><h1>模型</h1><div class="sub">切换槽位绑定，所有共用该槽的节点同时生效</div></div><div class="row">${UI.slotSaveBar()}</div></div>
    <div class="card">${UI.slotTable()}</div>
    <div class="section-title">已注册模型</div><div class="card">${UI.modelTable()}</div>`,

  play: () => `<div class="page-head"><div><h1>调试台</h1><div class="sub">模拟运行，不调用后端</div></div></div>
    <div class="grid" style="grid-template-columns:220px minmax(0,1fr) minmax(0,1.2fr)">
      <div class="card" style="padding:6px">${UI.OPS.map((o) => `<a class="row" data-play-op="${o.id}" style="padding:10px 12px;border-radius:6px;color:inherit;${UI.S.play.op === o.id ? "background:var(--primary-weak);color:var(--primary)" : ""}"><b>${o.t}</b><span class="muted">${o.d}</span></a>`).join("")}</div>
      <div class="card"><div class="card-head"><h3>参数</h3></div><div class="card-body">${UI.playForm()}</div><div class="card-foot"><button class="btn btn-primary" data-play-run>${icon("play")}运行</button></div></div>
      <div class="card"><div class="card-head"><h3>结果</h3></div><div class="card-body">${UI.playResult()}</div></div>
    </div>`,
};

function render() {
  document.getElementById("app").innerHTML = `
    <header class="nav"><div class="brand"><span class="mark"></span>Percolation</div>
      <nav class="nav-tabs">${NAV.map(([id, t, ic]) => `<a class="${st.page === id ? "on" : ""}" data-go="${id}">${icon(ic)}${t}</a>`).join("")}</nav>
      <div class="right"><span class="tag">预览 · 无后端</span></div></header>
    <div class="wrap">${pages[st.page]()}</div>${UI.overlay()}`;
}

const app = document.getElementById("app");
app.addEventListener("input", (e) => {
  if ("treeQ" in e.target.dataset) {
    st.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = app.querySelector("[data-tree-q]");
    el.focus();
    el.setSelectionRange(pos, pos);
    return;
  }
  if (UI.onInput(e, app)) render();
});
app.addEventListener("click", async (e) => {
  if (await UI.onClick(e)) return render();
  const t = e.target.closest("[data-go],[data-arch],[data-flow],[data-flow-step],[data-spec],[data-pick],[data-agent],[data-tab],[data-ctxview],[data-edit],[data-prompt]");
  if (!t) return;
  const d = t.dataset;
  if (d.go) {
    st.page = { flow: "arch", specs: "agents" }[d.go] || d.go;
    if (d.go === "context") st.ctxView = "ctx";
    location.hash = st.page;
    window.scrollTo(0, 0);
  }
  if (d.arch) st.arch = d.arch;
  if (d.flow) { st.flow = d.flow; st.step = 0; }
  if (d.flowStep) st.step = Number(d.flowStep);
  if (d.spec || d.edit) { st.spec = d.spec || d.edit; st.page = "agents"; st.tab = d.edit ? "config" : "overview"; location.hash = "agents"; }
  if (d.pick) st.spec = d.pick;
  if (d.agent) { st.spec = UI.agentOf(d.agent).specs[0]; st.page = "agents"; location.hash = "agents"; }
  if (d.prompt) st.spec = d.prompt;
  if (d.tab) st.tab = d.tab;
  if (d.ctxview) st.ctxView = d.ctxview;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && UI.S.modal) { UI.S.modal = null; render(); }
});
render();
