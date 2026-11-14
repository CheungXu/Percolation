(function (w) {
  const G = w.PERC_GEN || { specs: [], skills: {}, prompts: {}, models: {} };
  const C = w.PERC_CATALOG || { agents: [], specMeta: {}, searchFlow: [], dreamFlow: [], loopFlow: [], ops: [], demos: {}, stack: [], product: {} };

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const spec = (name) => G.specs.find((s) => s.name === name);
  const agent = (id) => C.agents.find((a) => a.id === id);
  const skill = (name) => G.skills?.[name];
  const meta = (name) => C.specMeta[name] || {};

  const schemaFields = (schema) => {
    const props = schema?.properties || {};
    return Object.entries(props).map(([k, v]) => ({
      key: k,
      type: v.type || (v.items ? "array" : "object"),
      desc: v.description || "",
      def: v.default,
    }));
  };

  const thinking = (s) => {
    const extra = s.extra_body || {};
    if (extra.enable_thinking === true) return "思考开";
    if (extra.enable_thinking === false) return "思考关";
    if (extra.thinking?.type === "disabled") return "思考关";
    if (extra.reasoning_effort) return "思考 " + extra.reasoning_effort;
    return "—";
  };

  const toolNames = (s) => (s.tools || []).map((t) => t.name);
  const skillNames = (s) => s.skills || [];

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const chips = (items, cls = "chip") =>
    (items || []).map((x) => `<span class="${cls}">${esc(x)}</span>`).join("");

  const kv = (rows) =>
    rows
      .filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== "")
      .map(
        ([k, v]) =>
          `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`
      )
      .join("");

  const schemaTable = (s) => {
    const fields = schemaFields(s.output_schema);
    if (!fields.length) return `<p class="muted">无结构化输出</p>`;
    return `<table class="schema"><thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead><tbody>${fields
      .map(
        (f) =>
          `<tr><td><code>${esc(f.key)}</code></td><td>${esc(f.type)}</td><td>${esc(f.desc || "—")}</td></tr>`
      )
      .join("")}</tbody></table>`;
  };

  const toolsList = (s) => {
    const tools = s.tools || [];
    if (!tools.length) return `<p class="muted">无工具 · 单轮推理</p>`;
    return `<ul class="tool-list">${tools
      .map((t) => {
        const desc = t.description || "";
        const params = Object.keys(t.parameters?.properties || {});
        return `<li><div class="tool-head"><code>${esc(t.name)}</code>${
          params.length ? `<span class="muted">${esc(params.join(" · "))}</span>` : ""
        }</div><p>${esc(desc)}</p></li>`;
      })
      .join("")}</ul>`;
  };

  const skillPanel = (names) => {
    if (!names?.length) return `<p class="muted">本节点不挂 Skill</p>`;
    return names
      .map((n) => {
        const sk = skill(n);
        if (!sk) return `<p class="muted">未知技能 ${esc(n)}</p>`;
        return `<article class="skill-card"><header><strong>${esc(n)}</strong><span class="path">${esc(
          sk.path
        )}</span></header><p class="lead">${esc(sk.description)}</p><pre class="doc">${esc(
          sk.body
        )}</pre></article>`;
      })
      .join("");
  };

  const promptView = (s, mode = "final") => {
    const raw = s.system_prompt_raw || "";
    const fin = s.system_prompt_final || "";
    const text = mode === "raw" ? raw : fin;
    return `<div class="prompt-meta"><span>${esc(s.system_prompt_chars || text.length)} 字</span><button class="ghost copy-btn" data-copy="${esc(
      mode
    )}" data-spec="${esc(s.name)}">复制</button></div><pre class="doc">${esc(text)}</pre>`;
  };

  w.Perc = {
    G,
    C,
    esc,
    spec,
    agent,
    skill,
    meta,
    schemaFields,
    thinking,
    toolNames,
    skillNames,
    copy,
    chips,
    kv,
    schemaTable,
    toolsList,
    skillPanel,
    promptView,
    merged(name) {
      const s = spec(name);
      if (!s) return null;
      return { ...s, meta: meta(name) };
    },
  };
})(window);
