const { UI } = window;
const { icon, tag, esc } = UI;
const CAT = window.PERC_CATALOG, GEN = window.PERC_GEN;

const st = { page: "home", spec: null, agent: null, open: { search: true, dream: true }, arch: "search", flow: "search", step: 1 };

function side() {
  const link = (id, t, ic) => `<a class="${st.page === id ? "on" : ""}" data-go="${id}">${icon(ic)}${t}</a>`;
  return `<aside class="side"><div class="brand"><span class="mark">P</span>Percolation</div>
    ${link("home", "概览", "home")}
    <div class="lbl">整体架构</div>${link("arch", "架构图", "layers")}${link("flow", "核心工作流", "flow")}
    <div class="lbl">Agent 配置</div>
    ${CAT.agents.map((a) => `<a class="${st.page === "agent" && st.agent === a.id ? "on" : ""}" data-agent="${a.id}">${icon(a.id === "search" ? "search" : "moon")}${a.name}<span class="caret ${st.open[a.id] ? "open" : ""}" data-fold="${a.id}">${icon("chev")}</span></a>
      ${st.open[a.id] ? a.specs.map((n) => `<a class="sub ${st.page === "spec" && st.spec === n ? "on" : ""}" data-spec="${n}">${esc(UI.metaOf(n).title)}${UI.isDirty(n) ? `<span class="end dirty"><span class="dot"></span></span>` : UI.isModified(n) ? `<span class="end">${tag("已改", "orange")}</span>` : ""}</a>`).join("") : ""}`).join("")}
    ${link("models", "模型槽", "cpu")}
    <div class="lbl">上下文管理</div>${link("prompts", "System Prompt", "file")}${link("skills", "Skill", "book")}
    <div class="lbl">操作</div>${link("play", "调试台", "play")}
    </aside>`;
}

const head = (crumb, title, sub, right = "") => `<div class="crumb">${crumb}</div><div class="hero"><div><h1 style="font-size:22px">${title}</h1><div class="muted" style="margin-top:2px">${sub}</div></div><div class="row">${right}</div></div>`;
const sec = (id, title, hint, body, foot = "") => `<section class="card sec" id="${id}"><div class="card-head"><h3>${title} ${hint ? `<span class="hint">${hint}</span>` : ""}</h3></div><div class="card-body">${body}</div>${foot}</section>`;

const pages = {
  home: () => `<div class="inner">${head("", "概览", "零负担录入 · 后台整理 · 模糊提问也能找回")}
    ${UI.stats()}
    <div class="grid g2" style="margin-top:16px">
      ${sec("guide", "新人上手", "按顺序看完约 10 分钟", UI.guide())}
      ${sec("layers", "记忆四层", "", `<div style="margin:-14px -16px">${UI.memoryLayers()}</div>`)}
    </div>
    <div class="section-title">业务 Agent</div><div class="grid g2">${CAT.agents.map(UI.agentCard).join("")}</div></div>`,

  arch: () => `<div class="inner">${head("整体架构", "架构图", "五层结构：入口 → 业务 Agent → 确定性程序 → agentkit 内核 → 存储与模型")}
    <div class="card sec"><div class="card-body">${UI.archDiagram(st.arch)}</div><div class="card-body" style="border-top:1px solid var(--line-2);background:#fcfcfb">${UI.archDetail(st.arch)}</div></div></div>`,

  flow: () => {
    const f = UI.FLOWS[st.flow];
    return `<div class="inner">${head("整体架构", "核心工作流", `触发：${f.when}`, `<div class="seg">${Object.entries(UI.FLOWS).map(([k, v]) => `<button class="${st.flow === k ? "on" : ""}" data-flow="${k}">${v.name}</button>`).join("")}</div>`)}
    <div class="card sec"><div class="card-body" style="padding:20px 16px">${UI.flowSteps(st.flow, st.step)}</div><div class="card-body" style="border-top:1px solid var(--line-2)">${UI.flowDetail(st.flow, st.step)}</div>
    <div class="card-foot"><button class="btn" data-prev ${st.step ? "" : "disabled"}>上一步</button><button class="btn btn-primary" data-next ${st.step < f.steps.length - 1 ? "" : "disabled"}>下一步</button></div></div></div>`;
  },

  agent: () => {
    const a = UI.agentOf(st.agent);
    return `<div class="inner">${head(`Agent 配置`, a.name, a.job, `<span class="mono muted">${a.file}</span>`)}
      <div class="desc" style="margin-bottom:16px;background:#fff"><div><span class="k">入口</span><span class="v mono">${a.entry}</span></div><div><span class="k">模型槽</span><span class="v">${a.slots.map((s) => tag(s, "blue")).join(" ")}</span></div></div>
      <div class="section-title">节点 <span class="hint">点击进入配置</span></div>
      <div class="card list-card">${a.specs.map((n) => {
        const s = UI.specOf(n), m = UI.metaOf(n), md = UI.effModel(s);
        return `<a data-spec="${n}"><div class="row"><b>${esc(m.step)} ${esc(m.title)}</b><span class="mono muted">${n}</span></div>
          <div class="row">${tag(md.model, "blue")}${tag(`${s.max_turns} 轮`)}${UI.permSummary(s).map(([t, c]) => tag(t, c)).join("")}${icon("chev")}</div>
          <div class="sub">${esc(m.duty)}</div></a>`;
      }).join("")}</div>
      <div class="section-title">上下文构成 <span class="hint">${esc(a.specs[0])}</span></div>
      <div class="card"><div class="card-body">${UI.contextList(a.specs[0])}</div></div></div>`;
  },

  spec: () => {
    const n = st.spec, s = UI.specOf(n), a = UI.agentOf(s.agent);
    const toc = [["s-basic", "概览"], ["s-config", "运行配置"], ["s-tools", "工具与权限"], ["s-prompt", "System Prompt"], ["s-ctx", "上下文"]];
    return `<div class="with-toc"><div>
      <div class="crumb"><a data-agent="${a.id}">${a.name}</a>${icon("chev")}<span>${n}</span></div>
      <div class="hero">${UI.specHeader(n)}</div>
      ${sec("s-basic", "概览", "", UI.specOverview(n))}
      ${sec("s-config", "运行配置", "修改后底部出现保存栏", UI.specForm(n))}
      ${sec("s-tools", "工具与权限", `${s.tools.length} 个工具`, UI.specBoundary(n))}
      ${sec("s-prompt", "System Prompt", "", UI.promptBlock(n))}
      ${sec("s-ctx", "上下文", "模型每次调用看到的内容", `<div class="grid g2"><div>${UI.contextList(n)}</div><div>${UI.contextPreview(n)}</div></div>`)}
    </div>
    <nav class="toc"><div class="t">本页</div>${toc.map(([id, t]) => `<a data-anchor="${id}">${t}</a>`).join("")}</nav></div>
    <div class="float-bar">${UI.saveBar(n)}</div>`;
  },

  models: () => `<div class="inner">${head("Agent 配置", "模型槽", "节点只声明槽位，切换后共用该槽的节点同时生效")}
    ${sec("slots", "槽位绑定", "", `<div style="margin:-14px -16px">${UI.slotTable()}</div>`, `<div class="card-foot">${UI.slotSaveBar()}</div>`)}
    ${sec("models", "已注册模型", "config/models.json", `<div style="margin:-14px -16px">${UI.modelTable()}</div>`)}</div>`,

  prompts: () => `<div class="inner">${head("上下文管理", "System Prompt", "点击行进入节点设置页编辑")}
    <div class="card">${UI.promptTable()}</div></div>`,

  skills: () => `<div class="inner">${head("上下文管理", "Skill", "目录常驻一行，正文按需 read_skill")}
    ${Object.keys(GEN.skills).map((k) => UI.skillBlock(k)).join("")}</div>`,

  play: () => `<div class="inner">${head("操作", "调试台", "模拟运行，不调用后端", `<div class="seg">${UI.OPS.map((o) => `<button class="${UI.S.play.op === o.id ? "on" : ""}" data-play-op="${o.id}">${o.t}</button>`).join("")}</div>`)}
    ${sec("p-form", UI.OPS.find((o) => o.id === UI.S.play.op).t, UI.OPS.find((o) => o.id === UI.S.play.op).d, UI.playForm(), `<div class="card-foot"><button class="btn btn-primary" data-play-run>${icon("play")}运行</button></div>`)}
    ${sec("p-out", "运行结果", "", UI.playResult())}</div>`,
};

function render() {
  document.getElementById("app").innerHTML = `<div class="layout">${side()}<main class="main">${pages[st.page]()}</main></div>${UI.overlay()}`;
}

const app = document.getElementById("app");
app.addEventListener("input", (e) => { if (UI.onInput(e, app)) render(); });
app.addEventListener("click", async (e) => {
  if (e.target.closest("[data-fold]")) {
    const id = e.target.closest("[data-fold]").dataset.fold;
    st.open[id] = !st.open[id];
    e.stopPropagation();
    return render();
  }
  if (await UI.onClick(e)) return render();
  const t = e.target.closest("[data-go],[data-arch],[data-flow],[data-flow-step],[data-prev],[data-next],[data-spec],[data-agent],[data-prompt],[data-anchor]");
  if (!t) return;
  const d = t.dataset;
  if (d.anchor) return document.getElementById(d.anchor)?.scrollIntoView({ behavior: "smooth" });
  if (d.go) {
    if (d.go === "specs") { st.page = "agent"; st.agent = "search"; }
    else if (d.go === "context") { st.page = "spec"; st.spec = "search_answer"; requestAnimationFrame(() => document.getElementById("s-ctx")?.scrollIntoView()); }
    else st.page = d.go;
    if (d.go !== "context") window.scrollTo(0, 0);
  }
  if (d.arch) st.arch = d.arch;
  if (d.flow) { st.flow = d.flow; st.step = 0; }
  if (d.flowStep) st.step = Number(d.flowStep);
  if ("prev" in d) st.step = Math.max(0, st.step - 1);
  if ("next" in d) st.step += 1;
  if (d.spec || d.prompt) { st.page = "spec"; st.spec = d.spec || d.prompt; window.scrollTo(0, 0); }
  if (d.agent) { st.page = "agent"; st.agent = d.agent; window.scrollTo(0, 0); }
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && UI.S.modal) { UI.S.modal = null; render(); }
});
render();
