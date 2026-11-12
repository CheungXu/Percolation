const { UI } = window;
const { icon, tag, esc } = UI;

const MENU = [
  { group: "", items: [["home", "首页", "home"]] },
  { group: "整体架构", items: [["arch", "架构图", "layers"], ["flow", "核心工作流", "flow"]] },
  { group: "Agent 配置", items: [["agents", "Agent Hub", "bot"], ["specs", "AgentSpec", "list"], ["models", "模型槽", "cpu"]] },
  { group: "上下文管理", items: [["context", "上下文构成", "stack"], ["prompts", "System Prompt", "file"], ["skills", "Skill", "book"]] },
  { group: "操作", items: [["play", "调试台", "play"]] },
];
const TITLE = Object.fromEntries(MENU.flatMap((g) => g.items.map(([id, t]) => [id, [g.group, t]])));

const st = {
  page: location.hash.slice(1) || "home",
  arch: "search",
  flow: "search",
  step: 1,
  q: "",
  agent: "",
  write: false,
  drawer: null,
  tab: "overview",
  ctxSpec: "search_answer",
  promptSpec: "search_router",
};

function pageHead(title, sub, right = "") {
  return `<div class="page-head"><div><h1>${title}</h1><div class="sub">${sub}</div></div><div class="row">${right}</div></div>`;
}

const pages = {
  home: () => `${pageHead("Percolation 控制台", "个人碎片记忆系统：零负担录入，后台整理，模糊提问也能找回。")}
    ${UI.stats()}
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);margin-top:14px">
      <div class="card"><div class="card-head"><h3>${icon("layers")}记忆四层</h3><a data-go="arch">查看架构 →</a></div><div class="card-body" style="padding:0">${UI.memoryLayers()}</div></div>
      <div class="card"><div class="card-head"><h3>${icon("compass")}新人上手</h3><span class="muted">约 10 分钟</span></div><div class="card-body" style="padding:4px 16px">${UI.guide()}</div></div>
    </div>
    <div class="section-title">业务 Agent</div>
    <div class="grid g2">${window.PERC_CATALOG.agents.map(UI.agentCard).join("")}</div>`,

  arch: () => `${pageHead("架构图", "从上到下：谁调用 → 业务编排 → 确定性程序 → 可复用内核 → 存储与模型")}
    <div class="split"><div class="card"><div class="card-body">${UI.archDiagram(st.arch)}</div></div>
    <div class="card sticky"><div class="card-head"><h3>模块说明</h3></div><div class="card-body">${UI.archDetail(st.arch)}</div></div></div>`,

  flow: () => {
    const f = UI.FLOWS[st.flow];
    return `${pageHead("核心工作流", "点击步骤查看输入、输出和对应节点")}
    <div class="card"><div class="card-head"><div class="seg">${Object.entries(UI.FLOWS).map(([k, v]) => `<button class="${st.flow === k ? "on" : ""}" data-flow="${k}">${v.name}</button>`).join("")}</div><span class="muted">触发：${f.when}</span></div>
    <div class="card-body" style="padding:18px 16px">${UI.flowSteps(st.flow, st.step)}</div>
    <div class="card-body" style="border-top:1px solid var(--line-2)">${UI.flowDetail(st.flow, st.step)}</div>
    <div class="card-foot"><button class="btn" data-prev ${st.step ? "" : "disabled"}>上一步</button><button class="btn btn-primary" data-next ${st.step < f.steps.length - 1 ? "" : "disabled"}>下一步</button></div></div>`;
  },

  agents: () => `${pageHead("Agent Hub", "业务 Agent 由若干 AgentSpec 节点组成，节点之间由 Python 代码编排", `<button class="btn" data-go="specs">${icon("list")}全部节点</button>`)}
    <div class="grid g2">${window.PERC_CATALOG.agents.map(UI.agentCard).join("")}</div>`,

  specs: () => `${pageHead("AgentSpec", "每个节点 = 模型槽 + Prompt + 工具 + 输出格式 + 轮次")}
    <div class="card"><div class="toolbar">
      <label>Agent</label><select class="select sm" data-filter="agent"><option value="">全部</option>${window.PERC_CATALOG.agents.map((a) => `<option value="${a.id}" ${st.agent === a.id ? "selected" : ""}>${a.name}</option>`).join("")}</select>
      <label style="margin-left:8px">搜索</label><input class="input sm" data-filter="q" placeholder="节点名 / 职责" value="${esc(st.q)}"/>
      <span class="row" style="margin-left:8px"><button class="switch ${st.write ? "on" : ""}" data-filter-write></button>只看可写节点</span>
    </div><div style="border-top:1px solid var(--line-2)">${UI.specTable({ agent: st.agent, q: st.q, write: st.write })}</div></div>`,

  models: () => `${pageHead("模型槽", "节点只声明槽位；在这里切换模型，所有共用该槽的节点同时生效")}
    <div class="card"><div class="card-head"><h3>槽位绑定</h3><div class="row">${UI.slotSaveBar()}</div></div>${UI.slotTable()}</div>
    <div class="section-title">已注册模型 <span class="hint">config/models.json</span></div>
    <div class="card">${UI.modelTable()}</div>`,

  context: () => {
    const groups = window.PERC_CATALOG.agents.map((a) => `<div class="grp">${a.name}</div>${a.specs.map((n) => `<a class="${st.ctxSpec === n ? "on" : ""}" data-ctx-spec="${n}">${esc(UI.metaOf(n).title)}</a>`).join("")}`).join("");
    return `${pageHead("上下文构成", "模型每次调用时看到的内容，按注入顺序排列")}
    <div class="split-ctx">
      <div class="card navlist" style="padding:6px">${groups}</div>
      <div class="card"><div class="card-head"><h3>${esc(UI.metaOf(st.ctxSpec).title)}</h3><span class="mono muted">${st.ctxSpec}</span></div><div class="card-body">${UI.contextList(st.ctxSpec)}</div></div>
      <div class="card"><div class="card-body">${UI.contextPreview(st.ctxSpec)}</div></div>
    </div>`;
  },

  prompts: () => `${pageHead("System Prompt", "Prompt 文件正文 + 运行时自动追加的技能索引与输出格式")}
    <div class="card" style="margin-bottom:14px">${UI.promptTable(st.promptSpec)}</div>
    <div class="card"><div class="card-head"><h3>${icon("file")}${esc(UI.metaOf(st.promptSpec).title)} <span class="mono muted" style="font-weight:400">${st.promptSpec}</span></h3><button class="btn btn-sm" data-spec="${st.promptSpec}" data-tab-open="config">${icon("edit")}编辑</button></div><div class="card-body">${UI.promptBlock(st.promptSpec)}</div></div>`,

  skills: () => `${pageHead("Skill", "技能目录常驻 Prompt（一行），正文由模型按需调用 read_skill 读取")}
    ${Object.keys(window.PERC_GEN.skills).map((k) => UI.skillBlock(k)).join("")}`,

  play: () => `${pageHead("调试台", "预览环境：模拟运行，展示每一步做了什么")}
    <div class="card" style="margin-bottom:14px"><div class="card-body"><div class="seg">${UI.OPS.map((o) => `<button class="${UI.S.play.op === o.id ? "on" : ""}" data-play-op="${o.id}">${o.t}</button>`).join("")}</div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
      <div class="card"><div class="card-head"><h3>参数</h3><span class="muted">${UI.OPS.find((o) => o.id === UI.S.play.op).d}</span></div><div class="card-body">${UI.playForm()}</div><div class="card-foot"><button class="btn btn-primary" data-play-run>${icon("play")}运行</button></div></div>
      <div class="card"><div class="card-head"><h3>运行结果</h3></div><div class="card-body">${UI.playResult()}</div></div>
    </div>`,
};

function drawer() {
  const n = st.drawer;
  if (!n) return "";
  const s = UI.specOf(n);
  const tabs = [["overview", "概览"], ["boundary", "工具与边界"], ["config", "配置"], ["prompt", "Prompt"], ["context", "上下文"]];
  const body = {
    overview: () => UI.specOverview(n),
    boundary: () => UI.specBoundary(n),
    config: () => UI.specForm(n),
    prompt: () => UI.promptBlock(n),
    context: () => `<div class="grid g2"><div>${UI.contextList(n)}</div><div>${UI.contextPreview(n)}</div></div>${(s.skills || []).map((k) => `<div style="margin-top:14px">${UI.skillBlock(k, true)}</div>`).join("")}`,
  }[st.tab]();
  return `<div class="mask" data-drawer-close></div><aside class="drawer">
    <div class="drawer-head"><div class="grow">${UI.specHeader(n)}</div><button class="btn btn-text" data-drawer-close>${icon("x")}</button></div>
    <div style="padding:0 20px"><div class="tabs" style="margin:0">${tabs.map(([k, l]) => `<button class="${st.tab === k ? "on" : ""}" data-tab="${k}">${l}${k === "boundary" ? `<span class="count">${s.tools.length}</span>` : ""}</button>`).join("")}</div></div>
    <div class="drawer-body">${body}</div>
    <div class="drawer-foot">${UI.saveBar(n)}</div></aside>`;
}

function render() {
  const [group, title] = TITLE[st.page] || ["", ""];
  document.getElementById("app").innerHTML = `<div class="layout">
    <aside class="side"><div class="logo"><span class="mark">P</span>Percolation</div>
      <nav class="menu">${MENU.map((g) => `${g.group ? `<div class="group">${g.group}</div>` : ""}${g.items.map(([id, t, ic]) => `<a class="${st.page === id ? "on" : ""}" data-go="${id}">${icon(ic)}${t}</a>`).join("")}`).join("")}</nav></aside>
    <main><header class="top"><div class="crumb">${group ? `${group} / ` : ""}<b>${title}</b></div><div class="row"><span class="tag">预览 · 无后端</span><button class="btn" data-go="home">${icon("compass")}新人上手</button></div></header>
      <div class="content">${pages[st.page]()}</div></main></div>
    ${drawer()}${UI.overlay()}`;
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
  const t = e.target.closest("[data-go],[data-arch],[data-flow],[data-flow-step],[data-prev],[data-next],[data-spec],[data-agent],[data-tab],[data-drawer-close],[data-ctx-spec],[data-prompt],[data-filter-write]");
  if (!t) return;
  const d = t.dataset;
  if (d.go) { st.page = d.go; st.drawer = null; location.hash = d.go; window.scrollTo(0, 0); }
  if (d.arch) st.arch = d.arch;
  if (d.flow) { st.flow = d.flow; st.step = 0; }
  if (d.flowStep) st.step = Number(d.flowStep);
  if ("prev" in d) st.step = Math.max(0, st.step - 1);
  if ("next" in d) st.step += 1;
  if (d.spec) { st.drawer = d.spec; st.tab = d.tabOpen || "overview"; }
  if (d.agent) { st.page = "specs"; st.agent = d.agent; location.hash = "specs"; }
  if (d.tab) st.tab = d.tab;
  if ("drawerClose" in d) st.drawer = null;
  if (d.ctxSpec) st.ctxSpec = d.ctxSpec;
  if (d.prompt) st.promptSpec = d.prompt;
  if ("filterWrite" in d) st.write = !st.write;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (st.drawer || UI.S.modal)) {
    if (UI.S.modal) UI.S.modal = null; else st.drawer = null;
    render();
  }
});
render();
