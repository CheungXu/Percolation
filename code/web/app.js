/**
 * 拾记凝境 · 网页端「双境工作区」
 *
 * 记录与询问是两个工作区：桌面端光标所在一侧舒展为主工作区，另一侧退为可读的侧影；
 * 移动端两张卡片左右滑切换，非当前的一张退到屏幕边缘露出边签。
 *
 * 数据来自 percolation.api（相对路径 v1/*，线上挂在 /Percolation/ 下）；
 * 登录复用星页同域账号（/api/auth/*）。
 *
 * 外壳只挂载一次，之后按区域局部重绘（记录流、问答流、浮层），
 * 异步结果回来时不会重建输入框、打断正在进行的输入法组字。
 */
(() => {
  "use strict";

  const ICON = {
    up: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mark: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 9.5C4.5 11 9.5 11 11 9.5M4 5h.01M10 5h.01" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    link: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ctx: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/></svg>',
    user: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5.6" r="2.6" stroke="currentColor" stroke-width="1.4"/><path d="M3 13.4c.9-2.3 2.8-3.5 5-3.5s4.1 1.2 5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    find: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.6" stroke="currentColor" stroke-width="1.6"/><path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    close: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  const MODES = {
    cap: { input: "cap-in", panel: "panel-left", stream: "left-stream", max: 20000 },
    ask: { input: "ask-in", panel: "panel-right", stream: "right-stream", max: 2000 },
  };

  const GREEN = [15, 157, 118];
  const INDIGO = [79, 70, 229];
  const THINK_STAGES = [
    [0, "翻看你的记录"],
    [2200, "核对原话"],
    [5600, "组织回答"],
    [15000, "还在想，稍等"],
  ];
  const CAP_EXAMPLES = ["周四下午三点，和陈总在福田站碰面", "「老地方」是软件园南门的竹里茶室", "想买千元内的 15.6 寸便携屏"];
  const ASK_EXAMPLES = ["我最近有哪些待办？", "下周有什么安排？", "我想买的东西有哪些？"];
  const STALE_MS = 10 * 60 * 1000;

  const S = {
    ready: false,
    account: null,
    login: null,
    notes: [],
    notesTotal: 0,
    notesMore: false,
    notesLoading: false,
    threads: [],
    threadsMore: false,
    threadsLoading: false,
    ctx: null,
    ctxAt: 0,
  };

  const ui = {
    mode: "cap",
    recallSeqs: [],
    menu: null,
    pagerLock: false,
    clarifyDrafts: {},
    loginShown: false,
    find: null,
    lastFind: "",
  };

  let localSeq = 0;
  let el = {};
  const root = document.getElementById("app");
  const mobileMq = window.matchMedia("(max-width: 720px)");
  const calmMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isMobile = () => mobileMq.matches;
  const otherMode = (mode) => (mode === "cap" ? "ask" : "cap");
  const $ = (sel) => root.querySelector(sel);

  /* ───────── 工具 ───────── */

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const LIST_ITEM = /^\s*(?:[-*•]|\d+[.、)])\s+/;

  function formatRich(text) {
    const safe = esc(text || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return safe
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return "";
        if (lines.length > 1 && lines.every((l) => LIST_ITEM.test(l))) {
          const tag = /^\s*\d/.test(lines[0]) ? "ol" : "ul";
          return "<" + tag + ">" + lines.map((l) => "<li>" + l.replace(LIST_ITEM, "") + "</li>").join("") + "</" + tag + ">";
        }
        return "<p>" + lines.join("<br/>") + "</p>";
      })
      .join("");
  }

  const pad = (n) => String(n).padStart(2, "0");

  function clock(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  function dayLabel(ts) {
    const today = startOfToday();
    const d = new Date(ts);
    if (ts >= today) return "今天";
    if (ts >= today - 864e5) return "昨天";
    if (ts >= today - 6 * 864e5) return "周" + "日一二三四五六"[d.getDay()];
    const md = d.getMonth() + 1 + "月" + d.getDate() + "日";
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + "年" + md;
  }

  function relTime(ts) {
    const today = startOfToday();
    if (ts >= today) return "今天 " + clock(ts);
    if (ts >= today - 864e5) return "昨天 " + clock(ts);
    const d = new Date(ts);
    return d.getMonth() + 1 + "月" + d.getDate() + "日";
  }

  const draft = {
    get(mode) {
      try {
        return localStorage.getItem("pc_draft_" + mode) || "";
      } catch (e) {
        return "";
      }
    },
    set(mode, value) {
      try {
        if (value) localStorage.setItem("pc_draft_" + mode, value);
        else localStorage.removeItem("pc_draft_" + mode);
      } catch (e) {}
    },
  };

  function nearBottom(box) {
    return box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  }

  /* ───────── 接口 ───────── */

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function detailOf(data, status) {
    const d = data && data.detail;
    if (typeof d === "string" && d) return d;
    if (Array.isArray(d)) return "输入有误，请检查后再试";
    if (status === 429) return "操作太频繁，稍后再试";
    if (status >= 500) return "服务暂时不可用，稍后再试";
    return "出了点问题，请稍后再试";
  }

  async function api(path, opts = {}) {
    const init = {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: opts.signal,
    };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ApiError("网络好像断了，稍后再试", 0);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !opts.quiet401) requireLogin();
      throw new ApiError(detailOf(data, res.status), res.status);
    }
    return data;
  }

  function normNote(n) {
    return { seq: n.seq, content: n.content, at: Date.parse(n.at), status: n.status, kind: n.kind, state: null };
  }

  function normThread(t) {
    return { key: t.id, id: t.id, query: t.query, at: Date.parse(t.at), steps: t.steps, pending: false, error: null };
  }

  /* ───────── 外壳（只挂载一次） ───────── */

  function topbarHtml() {
    return (
      '<header class="topbar">' +
      '<div class="brand"><div class="brand-mark">' +
      ICON.mark +
      '</div><span class="brand-name">拾记凝境</span><span class="brand-tagline">随手记日常，问更懂你的 AI</span></div>' +
      '<nav class="ws-nav" aria-label="切换工作区"><div class="ws-strip">' +
      '<button class="ws-title" data-go="cap" data-keep-focus>记录</button>' +
      '<button class="ws-title" data-go="ask" data-keep-focus>询问</button>' +
      '</div><span class="ws-dot"></span></nav>' +
      '<div class="top-actions">' +
      '<button class="top-btn ctx-btn" data-act="ctx" title="我的近况">' +
      ICON.ctx +
      '<span class="label">我的近况</span></button>' +
      '<button class="top-btn icon acc-btn" data-act="account" title="账号" aria-label="账号">' +
      ICON.user +
      "</button>" +
      "</div>" +
      '<div class="menu-layer"></div>' +
      "</header>"
    );
  }

  function composerHtml(mode, placeholder, sendTitle) {
    return (
      '<div class="composer"><textarea id="' +
      MODES[mode].input +
      '" rows="1" enterkeyhint="send" maxlength="' +
      MODES[mode].max +
      '" placeholder="' +
      placeholder +
      '"></textarea>' +
      '<kbd class="kbd">Tab</kbd>' +
      '<button class="send disabled" data-act="send-' +
      mode +
      '" data-keep-focus title="' +
      sendTitle +
      '" aria-label="' +
      sendTitle +
      '"><span class="send-glyph">' +
      ICON.up +
      "</span>" +
      (mode === "cap" ? '<span class="send-alt">' + ICON.find + "</span>" : "") +
      "</button></div>"
    );
  }

  function peekHtml(mode, label) {
    return (
      '<button class="peek" data-go="' +
      mode +
      '" data-keep-focus tabindex="-1" aria-label="切到' +
      label +
      '"><span class="peek-dot"><b class="peek-badge"></b></span><span class="peek-text">' +
      label +
      "</span></button>"
    );
  }

  function mount() {
    root.innerHTML =
      '<div class="app mode-cap" style="--p:0">' +
      topbarHtml() +
      '<main class="split"><i class="edge"></i>' +
      '<section class="panel panel-left is-active" data-ws="cap">' +
      '<div class="panel-head"><div class="panel-title"><span class="title-dot"></span>记录</div>' +
      '<button id="cap-meta" class="panel-meta find-btn" data-act="find" title="在记录里找（/）">' +
      ICON.find +
      '<span class="find-btn-text"></span></button>' +
      '<div class="find-bar" role="search">' +
      ICON.find +
      '<input id="find-in" type="search" placeholder="在记录里找原话" maxlength="200" autocomplete="off" enterkeyhint="search" aria-label="在记录里找原话" tabindex="-1" />' +
      '<span class="find-count" aria-live="polite"></span>' +
      '<button class="find-close" data-act="find-close" title="收起（Esc）" aria-label="收起搜索" tabindex="-1">' +
      ICON.close +
      "</button></div></div>" +
      '<div id="left-stream" class="stream"></div>' +
      '<div class="dock">' +
      composerHtml("cap", "想到什么，随手记下", "记下") +
      '<div class="dock-hint">Enter 记下 · Tab 去询问 · / 找记录</div></div>' +
      peekHtml("cap", "记录") +
      "</section>" +
      '<section class="panel panel-right is-idle" data-ws="ask">' +
      '<div class="panel-head"><div class="panel-title"><span class="title-dot"></span>询问<span class="absorb-tag">已融入你的境况</span></div><span class="panel-meta">基于你的记录作答</span></div>' +
      '<div id="right-stream" class="stream"></div>' +
      '<div class="dock">' +
      composerHtml("ask", "问点什么", "发问") +
      '<div class="dock-hint">Enter 发问 · Tab 回记录</div></div>' +
      peekHtml("ask", "询问") +
      "</section>" +
      '<i class="edge"></i></main>' +
      "</div>" +
      '<div class="login-layer"></div>' +
      '<div class="toast" role="status" aria-live="polite"></div>';

    el = {
      app: $(".app"),
      split: $(".split"),
      left: $(".panel-left"),
      right: $(".panel-right"),
      leftStream: document.getElementById("left-stream"),
      rightStream: document.getElementById("right-stream"),
      capIn: document.getElementById("cap-in"),
      askIn: document.getElementById("ask-in"),
      capMeta: document.getElementById("cap-meta"),
      capMetaText: $("#cap-meta .find-btn-text"),
      findIn: document.getElementById("find-in"),
      findCount: $(".find-count"),
      menuLayer: $(".menu-layer"),
      loginLayer: $(".login-layer"),
      toast: $(".toast"),
    };
    wireInputs();
    wireFind();
    wirePager();
    wireStreams();
  }

  /* ───────── 记录流 ───────── */

  function capEmptyHtml() {
    return (
      '<div class="empty"><div class="empty-mark"><i></i><i></i></div>' +
      "<h3>想到什么，随手记下</h3>" +
      "<p>一个约定、一句暗语、想买的东西。<br/>不用整理，也不用分类。</p>" +
      '<ul class="empty-examples">' +
      CAP_EXAMPLES.map((x) => "<li>" + esc(x) + "</li>").join("") +
      "</ul></div>"
    );
  }

  // 把命中的词包进 <mark>；重叠的区间合并，避免标签交错
  function markTerms(text, terms) {
    if (!terms || !terms.length) return esc(text);
    const lower = text.toLowerCase();
    const spans = [];
    for (const t of terms) {
      for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
    }
    if (!spans.length) return esc(text);
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push(sp.slice());
    }
    let html = "";
    let at = 0;
    for (const [s, e] of merged) {
      html += esc(text.slice(at, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>";
      at = e;
    }
    return html + esc(text.slice(at));
  }

  function noteHtml(n, terms) {
    const cls = ["note"];
    if (n.state === "sending") cls.push("sending");
    else if (n.state === "failed") cls.push("failed");
    else if (n.status === "pending") cls.push("fresh");
    if (n.seq && ui.recallSeqs.indexOf(n.seq) !== -1) cls.push("recall");
    if (n.enter) cls.push("enter");
    if (n.hit) cls.push("hit");
    if (n.near) cls.push("near");
    if (n.hit === false) cls.push("ctx");
    const attr = n.seq ? ' data-note-seq="' + n.seq + '"' : ' data-note-local="' + n.local + '"';
    let tag = n.kind === "clarification" ? '<span class="note-tag">补充</span>' : "";
    if (n.near) tag += '<span class="note-tag near-tag">相近</span>';
    const time = '<time class="note-time" title="' + (n.status === "pending" ? "今晚凝练" : "已凝练") + '">' + clock(n.at) + "</time>";
    const tail =
      n.state === "failed"
        ? '<button class="note-retry" data-retry-note="' + n.local + '">重试</button>'
        : n.hit
          ? '<span class="note-side">' + time + '<span class="note-go">定位</span></span>'
          : time;
    return (
      '<div class="' +
      cls.join(" ") +
      '"' +
      attr +
      (n.hit ? ' data-locate="' + n.seq + '" title="定位到原处"' : "") +
      '><span class="note-dot"></span><span class="note-body">' +
      tag +
      (n.near ? esc(n.content) : markTerms(n.content, terms)) +
      "</span>" +
      tail +
      "</div>"
    );
  }

  function notesHtml() {
    if (!S.ready) return "";
    if (!S.notes.length) return capEmptyHtml();
    let html = '<div class="stream-spacer"></div>';
    let lastDay = null;
    for (const n of S.notes) {
      const day = dayLabel(n.at);
      if (day !== lastDay) {
        if (lastDay !== null) html += "</div>";
        html += '<div class="day-label">' + day + '</div><div class="day-group">';
        lastDay = day;
      }
      html += noteHtml(n);
    }
    return html + "</div>";
  }

  // anchor：重绘前后让这条记录停在屏幕上同一位置（展开折叠时用）
  function paintNotes(opt = {}) {
    const box = el.leftStream;
    const stick = opt.bottom || nearBottom(box);
    const fromBottom = box.scrollHeight - box.scrollTop;
    const anchorSel = opt.anchor ? '[data-note-seq="' + opt.anchor + '"]' : null;
    const before = anchorSel && box.querySelector(anchorSel);
    const anchorTop = before ? before.getBoundingClientRect().top : 0;
    box.innerHTML = findActive() ? findHtml() : notesHtml();
    const after = anchorSel && box.querySelector(anchorSel);
    if (before && after) box.scrollTop += after.getBoundingClientRect().top - anchorTop;
    else if (opt.keepOffset) box.scrollTop = box.scrollHeight - fromBottom;
    else if (stick) box.scrollTop = box.scrollHeight;
    S.notes.forEach((n) => (n.enter = false));
    if (ui.find) ui.find.items.forEach((n) => (n.enter = false));
    paintCapMeta();
  }

  function paintCapMeta() {
    const n = ui.recallSeqs.length;
    el.capMetaText.textContent = n ? n + " 条相关" : S.ready && S.notesTotal ? S.notesTotal + " 条" : "";
    el.capMeta.classList.toggle("on", n > 0);
    el.capMeta.classList.toggle("no-notes", !(S.ready && S.notesTotal));
  }

  function noteEl(n) {
    return n.seq ? $('[data-note-seq="' + n.seq + '"]') : $('[data-note-local="' + n.local + '"]');
  }

  function oldestSeq() {
    const first = S.notes.find((n) => n.seq);
    return first ? first.seq : null;
  }

  function addServerNote(raw) {
    if (!raw || S.notes.some((n) => n.seq === raw.seq)) return;
    const note = Object.assign(normNote(raw), { enter: true });
    S.notes.push(note);
    S.notes.sort((a, b) => (a.seq || Infinity) - (b.seq || Infinity));
    S.notesTotal += 1;
  }

  async function loadOlderNotes() {
    const before = oldestSeq();
    if (findActive() || S.notesLoading || !S.notesMore || !before) return false;
    S.notesLoading = true;
    el.leftStream.insertAdjacentHTML("afterbegin", '<div class="more"><span></span></div>');
    try {
      const res = await api("v1/notes?limit=80&before_seq=" + before);
      S.notes = res.notes.map(normNote).concat(S.notes);
      S.notesMore = res.has_more;
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    } finally {
      S.notesLoading = false;
      paintNotes({ keepOffset: true });
    }
  }

  async function ensureNotesLoaded(seqs) {
    const min = Math.min.apply(null, seqs);
    for (let guard = 0; guard < 20 && S.notesMore && (oldestSeq() || 0) > min; guard++) {
      if (!(await loadOlderNotes())) break;
    }
  }

  /* ───────── 在记录里找 ───────── */
  // 结果是一条「折叠的时间线」：命中的原话按时间排开，中间没命中的收成一道可展开的折痕，
  // 找到一句话的同时还看得到它前后发生了什么。点命中的一条，收起搜索并定位到原处。

  const findActive = () => Boolean(ui.find && ui.find.q);

  function newFind() {
    return { q: "", terms: [], items: [], matched: 0, total: 0, capped: false, cur: -1, ctrl: null };
  }

  const findHits = () => (ui.find ? ui.find.items.filter((n) => n.hit) : []);

  function foldHtml(prev, next, count) {
    const label = !prev ? "更早 " + count + " 条" : !next ? "之后 " + count + " 条" : count + " 条";
    return (
      '<button class="fold" data-fold-after="' +
      (prev ? prev.seq : "") +
      '" data-fold-before="' +
      (next ? next.seq : "") +
      '" aria-label="展开' +
      label +
      '"><span class="fold-pill">' +
      label +
      "</span></button>"
    );
  }

  function findFootHtml(f, hits) {
    const lit = hits.filter((n) => !n.near).length;
    const near = hits.length - lit;
    let text = lit ? f.matched + " 条原话" : "没有原话包含这些字";
    if (near) text += " · " + near + " 条意思相近";
    if (f.capped) text += "（列出最近 " + lit + " 条）";
    return '<div class="find-foot"><span>' + text + '</span><button class="find-ask" data-find-ask>问问 AI ›</button></div>';
  }

  function findEmptyHtml(f) {
    return (
      '<div class="empty find-empty"><div class="empty-mark"><i></i><i></i></div>' +
      "<h3>没找到「" +
      esc(f.q) +
      "」</h3><p>原话里没有这些字。<br/>换个说法，或者让 AI 结合你的近况回想。</p>" +
      '<button class="find-ask solid" data-find-ask>问问 AI：「' +
      esc(f.q) +
      "」</button></div>"
    );
  }

  function findHtml() {
    const f = ui.find;
    const hits = findHits();
    if (!hits.length) return findEmptyHtml(f);
    let html = '<div class="stream-spacer"></div><div class="find-list">';
    let prev = null;
    let lastDay = null;
    for (const n of f.items) {
      const gap = n.pos - (prev ? prev.pos : 0) - 1;
      if (gap > 0) html += foldHtml(prev, n, gap);
      const day = dayLabel(n.at);
      if (day !== lastDay) {
        html += '<div class="day-label">' + day + "</div>";
        lastDay = day;
      }
      html += noteHtml(n, f.terms);
      prev = n;
    }
    if (f.total > prev.pos) html += foldHtml(prev, null, f.total - prev.pos);
    return html + "</div>" + findFootHtml(f, hits);
  }

  function paintFindCount() {
    const f = ui.find;
    if (!f) return;
    const n = findHits().length;
    el.findCount.textContent = !f.q ? "" : f.cur >= 0 && n ? f.cur + 1 + " / " + n : n + " 条";
  }

  function setFindTabbable(on) {
    el.findIn.tabIndex = on ? 0 : -1;
    $(".find-close").tabIndex = on ? 0 : -1;
  }

  function openFind() {
    if (!ensureReady()) return;
    if (isMobile() && ui.mode !== "cap") goMode("cap");
    if (!ui.find) {
      ui.find = newFind();
      el.left.classList.add("finding");
      setFindTabbable(true);
      el.findIn.value = ui.lastFind;
      if (ui.lastFind) scheduleFind(ui.lastFind, 0);
    }
    el.findIn.focus({ preventScroll: true });
    el.findIn.select();
    paintFindCount();
  }

  function closeFind(opt = {}) {
    const f = ui.find;
    if (!f) return;
    clearTimeout(scheduleFind.timer);
    if (f.ctrl) f.ctrl.abort();
    ui.lastFind = el.findIn.value.trim();
    const shown = findActive();
    ui.find = null;
    el.left.classList.remove("finding", "find-busy");
    setFindTabbable(false);
    if (document.activeElement === el.findIn) {
      if (opt.focusCap && !isMobile()) el.capIn.focus({ preventScroll: true });
      else el.findIn.blur();
    }
    if (shown) paintNotes({ bottom: true });
  }

  function scheduleFind(value, delay = 200) {
    const f = ui.find;
    if (!f) return;
    const q = value.trim();
    clearTimeout(scheduleFind.timer);
    if (f.ctrl) f.ctrl.abort();
    if (!q) {
      const shown = findActive();
      Object.assign(f, newFind());
      el.left.classList.remove("find-busy");
      if (shown) paintNotes({ bottom: true });
      paintFindCount();
      return;
    }
    el.left.classList.add("find-busy");
    scheduleFind.timer = setTimeout(() => runFind(q), delay);
  }

  // 新结果回来之前保留上一次的结果，避免每敲一个字就闪一下
  async function runFind(q) {
    const f = ui.find;
    if (!f) return;
    const ctrl = (f.ctrl = new AbortController());
    try {
      const res = await api("v1/notes/search?q=" + encodeURIComponent(q), { signal: ctrl.signal });
      if (ui.find !== f || ctrl.signal.aborted) return;
      Object.assign(f, {
        q,
        terms: res.terms,
        matched: res.matched,
        total: res.total,
        capped: res.capped,
        cur: -1,
        items: res.notes.map((r) => Object.assign(normNote(r), { pos: r.pos, near: r.near, hit: true, enter: true })),
      });
      el.left.classList.remove("find-busy");
      paintNotes({ bottom: true });
      paintFindCount();
    } catch (err) {
      if (err.name === "AbortError") return;
      el.left.classList.remove("find-busy");
      toast(err.message);
    }
  }

  function moveCur(dir) {
    const f = ui.find;
    const hits = findHits();
    if (!f || !hits.length) return;
    f.cur = f.cur < 0 ? hits.length - 1 : Math.max(0, Math.min(hits.length - 1, f.cur + dir));
    applyCur();
    const node = el.leftStream.querySelector('[data-note-seq="' + hits[f.cur].seq + '"]');
    if (node) ensureVisible(node);
  }

  function applyCur() {
    const f = ui.find;
    const hit = f && f.cur >= 0 ? findHits()[f.cur] : null;
    el.leftStream.querySelectorAll(".note.cur").forEach((n) => n.classList.remove("cur"));
    if (hit) {
      const node = el.leftStream.querySelector('[data-note-seq="' + hit.seq + '"]');
      if (node) node.classList.add("cur");
    }
    paintFindCount();
  }

  function locateNote(seq) {
    closeFind({ focusCap: true });
    flashNotes([seq]);
  }

  async function expandFold(btn) {
    const f = ui.find;
    if (!f || btn.classList.contains("loading")) return;
    btn.classList.add("loading");
    const after = btn.dataset.foldAfter;
    const before = btn.dataset.foldBefore;
    const qs = [after && "after_seq=" + after, before && "before_seq=" + before].filter(Boolean).join("&");
    try {
      const res = await api("v1/notes/between?" + qs);
      if (ui.find !== f) return;
      const have = new Set(f.items.map((n) => n.seq));
      for (const r of res.notes) {
        if (!have.has(r.seq)) f.items.push(Object.assign(normNote(r), { pos: r.pos, hit: false, enter: true }));
      }
      f.items.sort((a, b) => a.seq - b.seq);
      paintNotes({ anchor: Number(before || after) });
      applyCur();
    } catch (err) {
      btn.classList.remove("loading");
      toast(err.message);
    }
  }

  // 原话里找不到，就把这句话交给询问：记录侧亮起的相关条目会接着浮现
  function askFromFind() {
    const q = el.findIn.value.trim();
    closeFind();
    if (!q) return;
    el.askIn.value = q;
    draft.set("ask", q);
    autosize(el.askIn);
    updateSend("ask");
    scheduleRecall(q);
    if (isMobile()) {
      goMode("ask");
      el.askIn.focus({ preventScroll: true });
    } else {
      focusMode("ask");
    }
  }

  function wireFind() {
    el.findIn.addEventListener("input", (e) => {
      if (!e.isComposing) scheduleFind(el.findIn.value);
    });
    el.findIn.addEventListener("compositionend", () => scheduleFind(el.findIn.value));
    el.findIn.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeFind({ focusCap: true });
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        moveCur(e.key === "ArrowUp" ? -1 : 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (isMobile()) return el.findIn.blur();
        const f = ui.find;
        const hits = findHits();
        if (f && f.cur >= 0 && hits[f.cur]) locateNote(hits[f.cur].seq);
        else if (hits.length) moveCur(-1);
        else if (findActive()) askFromFind();
      }
    });
  }

  /* ───────── 问答流 ───────── */

  function askEmptyHtml() {
    const hint = S.notes.length ? "它会翻遍你的随手记，结合你的近况作答。" : "先在记录里写几句，再来问。";
    return (
      '<div class="empty"><div class="empty-mark ask"><i></i><i></i></div>' +
      "<h3>问问你记过的事</h3><p>" +
      hint +
      "</p>" +
      (S.notes.length
        ? '<div class="empty-chips">' +
          ASK_EXAMPLES.map((x) => '<button class="suggest" data-ask="' + esc(x) + '">' + esc(x) + "</button>").join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function thinkText(t) {
    const elapsed = Date.now() - (t.startedAt || Date.now());
    let text = THINK_STAGES[0][1];
    for (const [at, label] of THINK_STAGES) if (elapsed >= at) text = label;
    return text;
  }

  function cuesHtml(step) {
    if (!step.seqs || !step.seqs.length) return "";
    const seqs = step.seqs.join(",");
    const chips = ['<button class="cue cue-count" data-seqs="' + seqs + '">' + ICON.link + "依据 " + step.seqs.length + " 条记录</button>"];
    for (const c of step.cues || []) chips.push('<button class="cue" data-seqs="' + seqs + '">' + esc(c) + "</button>");
    return '<div class="cues">' + chips.join("") + "</div>";
  }

  function answerHtml(body) {
    return '<div class="a"><div class="a-avatar">凝</div><div class="a-content">' + body + "</div></div>";
  }

  function stepHtml(t, step, isLast) {
    let body;
    if (step.outcome === "clarify_asked") {
      body = (step.answer ? '<div class="a-text">' + formatRich(step.answer) + "</div>" : "") + '<div class="a-text">' + esc(step.clarify_question) + "</div>";
      if (isLast && !step.reply && !t.pending) {
        body +=
          '<form class="clarify" data-clarify="' +
          esc(t.key) +
          '"><input name="c" placeholder="补一句说明" maxlength="5000" autocomplete="off" enterkeyhint="send" value="' +
          esc(ui.clarifyDrafts[t.key] || "") +
          '" /><button type="submit">记住</button></form>';
      }
    } else {
      const muted = step.outcome !== "answered";
      const text = step.answer || (muted ? "没有找到相关记录。" : "");
      body = '<div class="a-text' + (muted ? " a-muted" : "") + '">' + formatRich(text) + "</div>";
    }
    return answerHtml(body + cuesHtml(step));
  }

  function threadHtml(t) {
    let html = '<div class="qa' + (t.enter ? " enter" : "") + '" data-thread="' + esc(t.key) + '"><div class="q">' + esc(t.query) + "</div>";
    t.steps.forEach((step, i) => {
      html += stepHtml(t, step, i === t.steps.length - 1);
      if (step.reply) html += '<div class="q q-reply">' + esc(step.reply.content) + "</div>";
    });
    if (t.pending) {
      html += answerHtml(
        '<div class="think"><span class="think-dots"><i></i><i></i><i></i></span><span class="think-text">' + thinkText(t) + "</span></div>"
      );
    } else if (t.error) {
      html += answerHtml(
        '<div class="a-text a-muted">' + esc(t.error) + '</div><button class="retry" data-retry-thread="' + esc(t.key) + '">再试一次</button>'
      );
    }
    return html + "</div>";
  }

  function threadsHtml() {
    if (!S.ready) return "";
    if (!S.threads.length) return askEmptyHtml();
    return '<div class="stream-spacer"></div>' + S.threads.map(threadHtml).join("");
  }

  function paintThreads(opt = {}) {
    const box = el.rightStream;
    const stick = opt.bottom || nearBottom(box);
    const fromBottom = box.scrollHeight - box.scrollTop;
    const active = document.activeElement;
    const focusKey = active && active.closest && active.closest("form[data-clarify]") ? active.closest("form[data-clarify]").dataset.clarify : null;
    const caret = focusKey ? [active.selectionStart, active.selectionEnd] : null;
    box.innerHTML = threadsHtml();
    if (opt.keepOffset) box.scrollTop = box.scrollHeight - fromBottom;
    else if (stick) box.scrollTop = box.scrollHeight;
    S.threads.forEach((t) => (t.enter = false));
    if (focusKey) {
      const input = box.querySelector('form[data-clarify="' + CSS.escape(focusKey) + '"] input');
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  function threadByKey(key) {
    return S.threads.find((t) => t.key === key) || null;
  }

  function startThinkTicker() {
    if (startThinkTicker.timer) return;
    startThinkTicker.timer = setInterval(() => {
      let any = false;
      for (const t of S.threads) {
        if (!t.pending) continue;
        any = true;
        const node = el.rightStream.querySelector('[data-thread="' + CSS.escape(t.key) + '"] .think-text');
        const text = thinkText(t);
        if (node && node.textContent !== text) node.textContent = text;
      }
      if (!any) {
        clearInterval(startThinkTicker.timer);
        startThinkTicker.timer = null;
      }
    }, 500);
  }

  async function loadOlderThreads() {
    const oldest = S.threads.find((t) => t.id);
    if (S.threadsLoading || !S.threadsMore || !oldest) return;
    S.threadsLoading = true;
    el.rightStream.insertAdjacentHTML("afterbegin", '<div class="more"><span></span></div>');
    try {
      const res = await api("v1/threads?limit=20&before_id=" + encodeURIComponent(oldest.id));
      S.threads = res.threads.map(normThread).concat(S.threads);
      S.threadsMore = res.has_more;
    } catch (err) {
      toast(err.message);
    } finally {
      S.threadsLoading = false;
      paintThreads({ keepOffset: true });
    }
  }

  /* ───────── 浮层：近况 / 账号 ───────── */

  function ctxHtml() {
    const c = S.ctx;
    let sub = "";
    let body = '<div class="ctx-loading"><i></i><i></i><i></i></div>';
    let foot = "";
    if (c) {
      const st = c.stats;
      sub = "已记 " + st.notes + " 条" + (st.pending ? " · " + st.pending + " 条今晚凝练" : "");
      const cards = c.sections
        .map((s) => ({ title: s.title, text: s.items.join("；") }))
        .concat(c.pages.map((p) => ({ title: p.title, text: p.highlights.join("；") })))
        .slice(0, 8);
      body = cards.length
        ? '<div class="ctx-grid">' +
          cards.map((card) => '<div class="ctx-item"><h4>' + esc(card.title) + "</h4><p>" + esc(card.text || "—") + "</p></div>").join("") +
          "</div>"
        : '<div class="ctx-empty"><p>每晚，它会把你的随手记凝练成近况。</p><p class="faint">' +
          (st.notes ? "今晚就会整理你记下的 " + st.notes + " 条。" : "先随手记几句吧。") +
          "</p></div>";
      if (st.last_dream_at) foot = '<div class="ctx-foot">上次整理 ' + relTime(Date.parse(st.last_dream_at)) + "</div>";
    }
    return (
      '<div class="ctx-backdrop" data-act="close-menu"></div>' +
      '<div class="context-popover" role="dialog" aria-label="我的近况"><div class="sheet-grabber"></div>' +
      '<div class="popover-head"><span class="popover-title">我的近况</span><span class="popover-sub">' +
      esc(sub) +
      "</span></div>" +
      body +
      foot +
      "</div>"
    );
  }

  function accountHtml() {
    const a = S.account || {};
    const canLogout = S.login && S.login.provider === "star_page";
    return (
      '<div class="ctx-backdrop" data-act="close-menu"></div>' +
      '<div class="account-pop" role="dialog" aria-label="账号"><div class="sheet-grabber"></div>' +
      '<div class="acc-name">' +
      esc(a.display_name || "已登录") +
      "</div>" +
      (a.phone ? '<div class="acc-phone">' + esc(a.phone) + "</div>" : "") +
      '<p class="acc-note">与星页账号通用，你的记录只有你自己能看到。</p>' +
      (S.console ? '<a class="acc-item acc-link" href="console/" target="_blank" rel="noopener">打开控制台</a>' : "") +
      (canLogout ? '<button class="acc-item" data-act="logout">退出登录</button>' : "") +
      "</div>"
    );
  }

  function paintMenu() {
    el.menuLayer.innerHTML = ui.menu === "ctx" ? ctxHtml() : ui.menu === "account" ? accountHtml() : "";
    $(".ctx-btn").classList.toggle("active", ui.menu === "ctx");
    $(".acc-btn").classList.toggle("active", ui.menu === "account");
  }

  async function openCtx() {
    ui.menu = "ctx";
    paintMenu();
    if (S.ctx && Date.now() - S.ctxAt < 30000) return;
    try {
      S.ctx = await api("v1/context");
      S.ctxAt = Date.now();
      if (ui.menu === "ctx") paintMenu();
    } catch (err) {
      if (err.status !== 401) toast(err.message);
    }
  }

  function closeMenu() {
    if (!ui.menu) return;
    ui.menu = null;
    paintMenu();
  }

  /* ───────── 登录 ───────── */

  function loginHtml() {
    const l = S.login || {};
    return (
      '<div class="login" role="dialog" aria-modal="true" aria-labelledby="lg-title">' +
      '<form class="login-card" novalidate>' +
      '<div class="brand-mark lg">' +
      ICON.mark +
      "</div>" +
      '<h1 id="lg-title">拾记凝境</h1><p class="login-sub">随手记日常，问更懂你的 AI</p>' +
      '<div class="field"><input id="lg-phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="手机号" /></div>' +
      '<div class="field"><input id="lg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="验证码" />' +
      '<button type="button" class="lg-send" data-act="send-code">获取验证码</button></div>' +
      '<label class="agree"><input type="checkbox" id="lg-agree" /><span>已阅读并同意<a href="' +
      esc(l.terms_url || "/terms") +
      '" target="_blank" rel="noopener">《用户服务协议》</a>和<a href="' +
      esc(l.privacy_url || "/privacy") +
      '" target="_blank" rel="noopener">《隐私政策》</a></span></label>' +
      '<div class="login-err" role="alert"></div>' +
      '<button type="submit" class="login-submit">登录</button>' +
      '<p class="login-foot">使用星页账号登录，未注册的手机号将自动创建</p>' +
      "</form></div>"
    );
  }

  function offlineHtml(message) {
    return (
      '<div class="login" role="alertdialog" aria-modal="true"><div class="login-card">' +
      '<div class="brand-mark lg">' +
      ICON.mark +
      '</div><h1>拾记凝境</h1><p class="login-sub">' +
      esc(message || "暂时连不上，稍后再试") +
      '</p><button type="button" class="login-submit" data-act="reboot">重试</button></div></div>'
    );
  }

  function showLogin() {
    ui.loginShown = true;
    closeMenu();
    el.loginLayer.innerHTML = loginHtml();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!isMobile()) document.getElementById("lg-phone").focus();
  }

  function hideLogin() {
    ui.loginShown = false;
    el.loginLayer.innerHTML = "";
  }

  function showOffline(message) {
    ui.loginShown = true;
    el.loginLayer.innerHTML = offlineHtml(message);
  }

  function loginError(message) {
    const node = $(".login-err");
    if (node) node.textContent = message || "";
  }

  function loginInputs() {
    return {
      phone: document.getElementById("lg-phone").value.replace(/\s/g, ""),
      code: document.getElementById("lg-code").value.trim(),
      agreed: document.getElementById("lg-agree").checked,
    };
  }

  function startCooldown(seconds) {
    const btn = $(".lg-send");
    let left = seconds;
    clearInterval(startCooldown.timer);
    const tick = () => {
      const b = $(".lg-send");
      if (!b) return clearInterval(startCooldown.timer);
      if (left <= 0) {
        b.disabled = false;
        b.textContent = "重新获取";
        return clearInterval(startCooldown.timer);
      }
      b.disabled = true;
      b.textContent = left-- + " 秒";
    };
    if (btn) tick();
    startCooldown.timer = setInterval(tick, 1000);
  }

  async function sendCode() {
    const { phone, agreed } = loginInputs();
    if (!/^1\d{10}$/.test(phone)) return loginError("请输入 11 位手机号");
    if (!agreed) return loginError("请先阅读并勾选同意协议");
    const btn = $(".lg-send");
    btn.disabled = true;
    try {
      const res = await api("/api/auth/sms/send", { method: "POST", body: { phone }, quiet401: true });
      loginError("");
      startCooldown((res && res.cooldown_seconds) || 60);
      document.getElementById("lg-code").focus();
    } catch (err) {
      btn.disabled = false;
      loginError(err.message);
    }
  }

  async function submitLogin() {
    const { phone, code, agreed } = loginInputs();
    if (!/^1\d{10}$/.test(phone)) return loginError("请输入 11 位手机号");
    if (!/^\d{4,8}$/.test(code)) return loginError("请输入短信验证码");
    if (!agreed) return loginError("请先阅读并勾选同意协议");
    const btn = $(".login-submit");
    btn.disabled = true;
    try {
      const body = { phone, code };
      if (S.login && S.login.agreement_version) body.agreement_version = S.login.agreement_version;
      await api("/api/auth/sms/login", { method: "POST", body, quiet401: true });
      const session = await api("v1/session", { quiet401: true });
      if (!session.logged_in) throw new ApiError("登录没有生效，请刷新页面再试", 0);
      S.account = session.account;
      S.console = Boolean(session.console);
      hideLogin();
      await loadAll();
      if (!isMobile()) el.capIn.focus({ preventScroll: true });
    } catch (err) {
      loginError(err.message);
      const b = $(".login-submit");
      if (b) b.disabled = false;
    }
  }

  function requireLogin() {
    if (ui.loginShown) return;
    showLogin();
  }

  async function logout() {
    closeMenu();
    closeFind();
    ui.lastFind = "";
    el.findIn.value = "";
    try {
      await api("v1/session/forget", { method: "POST", quiet401: true });
    } catch (e) {}
    try {
      await api("/api/auth/logout", { method: "POST", quiet401: true });
    } catch (e) {}
    draft.set("cap", "");
    draft.set("ask", "");
    el.capIn.value = "";
    el.askIn.value = "";
    Object.assign(S, { ready: false, account: null, console: false, notes: [], notesTotal: 0, threads: [], ctx: null, ctxAt: 0 });
    ui.recallSeqs = [];
    paintAll();
    showLogin();
  }

  /* ───────── 工作区切换 ───────── */

  // 原地切换：桌面端靠 CSS 过渡伸缩，移动端由滑动进度驱动
  function setMode(mode) {
    if (ui.mode === mode) return;
    ui.mode = mode;
    el.app.classList.toggle("mode-cap", mode === "cap");
    el.app.classList.toggle("mode-ask", mode === "ask");
    for (const m of ["cap", "ask"]) {
      const panel = $("." + MODES[m].panel);
      panel.classList.toggle("is-active", m === mode);
      panel.classList.toggle("is-idle", m !== mode);
    }
    if (isMobile()) {
      const active = document.activeElement;
      if (active && active.matches("textarea, input") && active.closest("[data-ws]") && !active.closest("." + MODES[mode].panel)) active.blur();
      if (navigator.vibrate) navigator.vibrate(6);
    } else {
      pinStreams(720);
    }
  }

  function focusMode(mode) {
    const input = document.getElementById(MODES[mode].input);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    setMode(mode);
  }

  function goMode(mode) {
    setMode(mode);
    if (!isMobile()) return;
    ui.pagerLock = true;
    el.split.scrollTo({ left: mode === "ask" ? el.split.scrollWidth - el.split.clientWidth : 0, behavior: calmMq.matches ? "auto" : "smooth" });
    clearTimeout(goMode.timer);
    goMode.timer = setTimeout(() => (ui.pagerLock = false), 520);
  }

  // 主动切换：键盘已弹起时把焦点直接交给另一侧，键盘不收起
  function switchTo(mode) {
    if (!isMobile()) return focusMode(mode);
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") document.getElementById(MODES[mode].input).focus({ preventScroll: true });
    goMode(mode);
  }

  function syncPager() {
    const p = ui.mode === "ask" ? 1 : 0;
    el.app.style.setProperty("--p", p);
    if (isMobile()) el.split.scrollLeft = p ? el.split.scrollWidth - el.split.clientWidth : 0;
  }

  function wirePager() {
    el.split.addEventListener(
      "scroll",
      () => {
        if (!isMobile()) return;
        const max = el.split.scrollWidth - el.split.clientWidth;
        if (max <= 0) return;
        const p = Math.max(0, Math.min(1, el.split.scrollLeft / max));
        el.app.style.setProperty("--p", p.toFixed(3));
        if (!ui.pagerLock) setMode(p > 0.5 ? "ask" : "cap");
      },
      { passive: true }
    );
  }

  // 面板宽度过渡期间，原本贴底的内容流保持贴底，避免换行重排时跳动
  function pinStreams(ms) {
    const list = [el.leftStream, el.rightStream].filter((box) => nearBottom(box));
    if (!list.length) return;
    const end = performance.now() + ms;
    (function tick() {
      list.forEach((box) => (box.scrollTop = box.scrollHeight));
      if (performance.now() < end) requestAnimationFrame(tick);
    })();
  }

  function wireStreams() {
    el.leftStream.addEventListener("scroll", () => {
      if (el.leftStream.scrollTop < 160) loadOlderNotes();
    }, { passive: true });
    el.rightStream.addEventListener("scroll", () => {
      if (el.rightStream.scrollTop < 160) loadOlderThreads();
    }, { passive: true });
  }

  /* ───────── 输入 ───────── */

  function autosize(input) {
    const line = isMobile() ? 24 : 22;
    input.style.height = line + "px";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  }

  // 手机上记录框空着时，发送键是「找记录」（像聊天应用空着是语音、有字才是发送），写了字才变回「记下」
  function updateSend(mode) {
    const input = document.getElementById(MODES[mode].input);
    const btn = input.parentNode.querySelector(".send");
    const empty = !input.value.trim();
    btn.classList.toggle("disabled", empty);
    if (mode !== "cap") return;
    const asFind = empty && isMobile();
    btn.classList.toggle("as-find", asFind);
    btn.setAttribute("aria-label", asFind ? "在记录里找" : "记下");
    btn.title = asFind ? "在记录里找" : "记下";
  }

  function wireInputs() {
    for (const mode of ["cap", "ask"]) {
      const input = document.getElementById(MODES[mode].input);
      input.value = draft.get(mode);
      autosize(input);
      updateSend(mode);
      input.addEventListener("input", () => {
        draft.set(mode, input.value);
        autosize(input);
        updateSend(mode);
        if (mode === "ask") scheduleRecall(input.value);
      });
      input.addEventListener("keydown", (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (mode === "cap") doCap();
          else doAsk();
        } else if (e.key === "Tab" && !e.shiftKey && !isMobile()) {
          e.preventDefault();
          focusMode(otherMode(mode));
        }
      });
    }
  }

  function clearComposer(mode) {
    const input = document.getElementById(MODES[mode].input);
    input.value = "";
    draft.set(mode, "");
    autosize(input);
    updateSend(mode);
  }

  /* ───────── 记录 → 询问 ───────── */

  async function doCap(existing) {
    let note = existing;
    if (!note) {
      const text = el.capIn.value.trim();
      if (!text || !ensureReady()) return;
      closeFind();
      clearComposer("cap");
      note = { local: ++localSeq, seq: null, content: text, at: Date.now(), status: "pending", kind: "capture", state: "sending", enter: true };
      S.notes.push(note);
      paintNotes({ bottom: true });
      const dot = noteEl(note);
      percolate(dot && dot.querySelector(".note-dot"), $(isMobile() ? ".panel-right .peek-dot" : ".panel-right .title-dot"));
    } else {
      note.state = "sending";
      paintNotes();
    }
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api("v1/capture", { method: "POST", body: { content: note.content, client_meta: { client: "web", tz } } });
      Object.assign(note, res.note ? normNote(res.note) : { seq: res.msg_seq, at: Date.parse(res.captured_at), state: null });
      S.notesTotal += 1;
      S.ctxAt = 0;
    } catch (err) {
      note.state = "failed";
      toast(err.message);
    }
    paintNotes();
  }

  async function doAsk(preset) {
    const text = (preset != null ? preset : el.askIn.value).trim();
    if (!text || !ensureReady()) return;
    if (preset == null) clearComposer("ask");
    clearTimeout(scheduleRecall.timer);
    const thread = { key: "l" + ++localSeq, id: null, query: text, at: Date.now(), steps: [], pending: true, error: null, enter: true };
    S.threads.push(thread);
    await runAsk(thread);
  }

  async function runAsk(thread) {
    thread.pending = true;
    thread.error = null;
    thread.startedAt = Date.now();
    paintThreads({ bottom: true });
    startThinkTicker();
    try {
      const res = await api("v1/search", { method: "POST", body: { query: thread.query } });
      thread.id = res.step.search_id;
      thread.steps = [res.step];
      thread.pending = false;
      paintThreads({ bottom: true });
      afterAnswer(res.step);
    } catch (err) {
      thread.pending = false;
      thread.error = err.message;
      paintThreads({ bottom: true });
    }
  }

  async function doClarify(thread, text) {
    const step = thread.steps[thread.steps.length - 1];
    step.reply = { seq: null, content: text };
    delete ui.clarifyDrafts[thread.key];
    thread.pending = true;
    thread.error = null;
    thread.startedAt = Date.now();
    paintThreads({ bottom: true });
    startThinkTicker();
    try {
      const res = await api("v1/clarify", { method: "POST", body: { search_id: step.search_id, content: text } });
      step.reply.seq = res.captured.msg_seq;
      addServerNote(res.note);
      thread.steps.push(res.step);
      thread.pending = false;
      S.ctxAt = 0;
      paintNotes({ bottom: true });
      paintThreads({ bottom: true });
      afterAnswer(res.step);
    } catch (err) {
      step.reply = null;
      ui.clarifyDrafts[thread.key] = text;
      thread.pending = false;
      paintThreads({ bottom: true });
      toast(err.message);
    }
  }

  function afterAnswer(step) {
    ui.recallSeqs = [];
    applyRecall();
    if (!step.seqs || !step.seqs.length) return;
    if (isMobile()) pulseCapPeek(step.seqs.length);
    else setTimeout(() => flashNotes(step.seqs), 160);
  }

  function ensureReady() {
    if (S.ready) return true;
    requireLogin();
    return false;
  }

  /* ───────── 边问边浮现 ───────── */

  function scheduleRecall(q) {
    clearTimeout(scheduleRecall.timer);
    const text = q.trim();
    if (text.length < 2 || !S.ready || !S.notes.length) {
      if (ui.recallSeqs.length) {
        ui.recallSeqs = [];
        applyRecall();
      }
      return;
    }
    scheduleRecall.timer = setTimeout(async () => {
      if (scheduleRecall.ctrl) scheduleRecall.ctrl.abort();
      const ctrl = (scheduleRecall.ctrl = new AbortController());
      try {
        const res = await api("v1/recall?q=" + encodeURIComponent(text), { signal: ctrl.signal, quiet401: true });
        if (ctrl.signal.aborted || el.askIn.value.trim() !== text) return;
        ui.recallSeqs = res.seqs || [];
        applyRecall();
      } catch (e) {}
    }, 260);
  }

  function applyRecall() {
    const seqs = ui.recallSeqs;
    let last = null;
    el.leftStream.querySelectorAll(".note[data-note-seq]").forEach((n) => {
      const on = seqs.indexOf(Number(n.dataset.noteSeq)) !== -1;
      n.classList.toggle("recall", on);
      if (on) last = n;
    });
    paintCapMeta();
    $(".panel-left .peek-badge").textContent = seqs.length || "";
    el.left.classList.toggle("has-recall", seqs.length > 0);
    if (last && !isMobile()) ensureVisible(last);
  }

  async function flashNotes(seqs) {
    closeFind();
    await ensureNotesLoaded(seqs);
    const hits = [];
    el.leftStream.querySelectorAll(".note[data-note-seq]").forEach((n) => {
      n.classList.remove("highlight");
      if (seqs.indexOf(Number(n.dataset.noteSeq)) !== -1) {
        void n.offsetWidth;
        n.classList.add("highlight");
        hits.push(n);
      }
    });
    if (hits.length) ensureVisible(hits[hits.length - 1]);
    else if (seqs.length) toast("这条记录比较早，没能定位到");
    clearTimeout(flashNotes.timer);
    flashNotes.timer = setTimeout(() => {
      el.leftStream.querySelectorAll(".note.highlight").forEach((n) => n.classList.remove("highlight"));
    }, 2400);
  }

  function ensureVisible(node) {
    const box = node.closest(".stream");
    if (!box) return;
    const r = node.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top >= b.top + 8 && r.bottom <= b.bottom - 8) return;
    box.scrollTo({
      top: box.scrollTop + (r.top - b.top) - box.clientHeight / 2 + r.height / 2,
      behavior: calmMq.matches ? "auto" : "smooth",
    });
  }

  // 记下的一句化作光点，沿弧线流入询问侧：记录在为 AI 积累对你的理解
  function percolate(from, to) {
    if (!from || !to || calmMq.matches || !from.animate) return absorb();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x0 = a.left + a.width / 2;
    const y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2;
    const y1 = b.top + b.height / 2;
    const cx = x0 + (x1 - x0) * 0.25;
    const cy = Math.min(y0, y1) - 36;
    const frames = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const rgb = GREEN.map((g, k) => Math.round(g + (INDIGO[k] - g) * t));
      frames.push({
        offset: t,
        transform: "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + (1 - 0.35 * t).toFixed(3) + ")",
        backgroundColor: "rgb(" + rgb.join(",") + ")",
      });
    }
    [0, 1, 2].forEach((k) => {
      const orb = document.createElement("span");
      orb.className = "orb orb-" + k;
      document.body.appendChild(orb);
      const anim = orb.animate(frames, { duration: 880, delay: k * 46, easing: "cubic-bezier(0.55, 0, 0.2, 1)", fill: "both" });
      anim.onfinish = () => {
        orb.remove();
        if (k === 0) absorb();
      };
    });
  }

  function absorb() {
    el.right.classList.remove("absorbing");
    void el.right.offsetWidth;
    el.right.classList.add("absorbing");
    clearTimeout(absorb.timer);
    absorb.timer = setTimeout(() => el.right.classList.remove("absorbing"), 1900);
  }

  // 移动端：回答用到了几条记录，左侧露出的记录边签上亮出数字
  function pulseCapPeek(n) {
    $(".panel-left .peek-badge").textContent = n;
    el.left.classList.add("has-recall", "absorbing");
    clearTimeout(pulseCapPeek.timer);
    pulseCapPeek.timer = setTimeout(() => {
      el.left.classList.remove("absorbing");
      if (!ui.recallSeqs.length) el.left.classList.remove("has-recall");
    }, 2600);
  }

  /* ───────── 提示 ───────── */

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove("on"), 2800);
  }

  /* ───────── 事件 ───────── */

  function handleAct(act) {
    if (act === "send-cap") isMobile() && !el.capIn.value.trim() ? openFind() : doCap();
    else if (act === "send-ask") doAsk();
    else if (act === "ctx") ui.menu === "ctx" ? closeMenu() : openCtx();
    else if (act === "account") {
      ui.menu = ui.menu === "account" ? null : "account";
      paintMenu();
    } else if (act === "close-menu") closeMenu();
    else if (act === "logout") logout();
    else if (act === "send-code") sendCode();
    else if (act === "reboot") boot();
    else if (act === "find") openFind();
    else if (act === "find-close") closeFind({ focusCap: true });
  }

  root.addEventListener("click", (e) => {
    const actEl = e.target.closest("[data-act]");
    if (actEl) {
      handleAct(actEl.dataset.act);
      return;
    }
    if (ui.menu && !e.target.closest(".context-popover, .account-pop")) {
      closeMenu();
      return;
    }
    // 手机上已在记录页时再点一次「记录」：打开找记录（记录框有字时发送键不是放大镜，这是另一个入口）
    const go = e.target.closest("[data-go]");
    if (go && isMobile() && go.matches(".ws-title") && go.dataset.go === "cap" && ui.mode === "cap") return openFind();
    if (go) return switchTo(go.dataset.go);

    const ask = e.target.closest("[data-ask]");
    if (ask) return doAsk(ask.dataset.ask);

    const fold = e.target.closest(".fold");
    if (fold) return expandFold(fold);

    if (e.target.closest("[data-find-ask]")) return askFromFind();

    const locate = e.target.closest("[data-locate]");
    if (locate && window.getSelection().isCollapsed) return locateNote(Number(locate.dataset.locate));

    const cue = e.target.closest("[data-seqs]");
    if (cue) {
      const seqs = cue.dataset.seqs.split(",").filter(Boolean).map(Number);
      if (!seqs.length) return;
      if (isMobile() && ui.mode !== "cap") {
        goMode("cap");
        setTimeout(() => flashNotes(seqs), 380);
      } else {
        flashNotes(seqs);
      }
      return;
    }

    const retryNote = e.target.closest("[data-retry-note]");
    if (retryNote) {
      const note = S.notes.find((n) => n.local === Number(retryNote.dataset.retryNote));
      if (note) doCap(note);
      return;
    }

    const retryThread = e.target.closest("[data-retry-thread]");
    if (retryThread) {
      const thread = threadByKey(retryThread.dataset.retryThread);
      if (thread) runAsk(thread);
      return;
    }

    // 点在另一侧工作区的空白处：切过去
    const ws = e.target.closest("[data-ws]");
    if (ws && ws.dataset.ws !== ui.mode && !e.target.closest("button, input, textarea, a, form") && window.getSelection().isCollapsed) {
      switchTo(ws.dataset.ws);
    }
  });

  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.matches("form[data-clarify]")) {
      const thread = threadByKey(form.dataset.clarify);
      const text = form.elements.c.value.trim();
      if (thread && text) doClarify(thread, text);
    } else if (form.matches(".login-card")) {
      submitLogin();
    }
  });

  root.addEventListener("input", (e) => {
    const form = e.target.closest("form[data-clarify]");
    if (form) ui.clarifyDrafts[form.dataset.clarify] = e.target.value;
  });

  // 桌面端：光标落在哪一侧的输入框，哪一侧就成为主工作区
  root.addEventListener("focusin", (e) => {
    if (isMobile() || !e.target.matches("textarea, input")) return;
    const ws = e.target.closest("[data-ws]");
    if (ws) setMode(ws.dataset.ws);
  });

  root.addEventListener("mousedown", (e) => {
    if (e.target.closest("[data-keep-focus]")) e.preventDefault();
  });

  // 「/」打开找记录：焦点不在输入框里，或者记录输入框还是空的（记录很少以「/」开头）
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || ui.loginShown || isMobile()) return;
    const t = e.target;
    const typing = t && t.matches && t.matches("textarea, input");
    if (typing && !(t === el.capIn && !t.value)) return;
    e.preventDefault();
    openFind();
  });

  mobileMq.addEventListener("change", () => {
    syncPager();
    [el.capIn, el.askIn].forEach(autosize);
    updateSend("cap");
  });

  // iOS 键盘弹起时可视区变矮：让应用高度跟随可视区，输入框始终贴在键盘上方
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const syncViewport = () => {
      document.documentElement.style.setProperty("--vvh", vv.height + "px");
      if (isMobile()) window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", syncViewport);
    syncViewport();
  }

  // 离开很久再回来：记录状态可能已被夜间整理推进，重新拉一次
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const busy = S.notes.some((n) => n.state === "sending") || S.threads.some((t) => t.pending);
    if (S.ready && hiddenAt && Date.now() - hiddenAt > STALE_MS && !busy) loadAll().catch(() => {});
  });

  /* ───────── 启动 ───────── */

  function paintAll() {
    paintNotes({ bottom: true });
    paintThreads({ bottom: true });
    paintMenu();
  }

  async function loadAll() {
    const [n, t] = await Promise.all([api("v1/notes?limit=80"), api("v1/threads?limit=20")]);
    S.notes = n.notes.map(normNote);
    S.notesTotal = n.total != null ? n.total : S.notes.length;
    S.notesMore = n.has_more;
    S.threads = t.threads.map(normThread);
    S.threadsMore = t.has_more;
    S.ready = true;
    S.ctxAt = 0;
    paintAll();
  }

  async function boot() {
    hideLogin();
    let session;
    try {
      session = await api("v1/session", { quiet401: true });
    } catch (err) {
      showOffline(err.message);
      return;
    }
    S.login = session.login;
    if (!session.logged_in) {
      showLogin();
      return;
    }
    S.account = session.account;
    S.console = Boolean(session.console);
    try {
      await loadAll();
    } catch (err) {
      if (err.status !== 401) showOffline(err.message);
      return;
    }
    if (!isMobile()) el.capIn.focus({ preventScroll: true });
  }

  mount();
  syncPager();
  boot();
})();
