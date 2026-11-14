(function () {
  "use strict";

  var store = window.ShijiStore.create("3012-nordic");
  var esc = window.ShijiStore.utils.esc;
  var formatRichAnswer = window.ShijiStore.utils.formatRichAnswer;

  var ICON_UP =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_MARK =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 9.5C4.5 11 9.5 11 11 9.5M4 5h.01M10 5h.01" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_RESET =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.8h2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_LINK =
    '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CTX =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.4" stroke="currentColor" stroke-width="1.4"/></svg>';

  var MODES = {
    cap: { input: "cap-in", draft: "capDraft", panel: "panel-left" },
    ask: { input: "ask-in", draft: "askDraft", panel: "panel-right" }
  };

  var GREEN = [15, 157, 118];
  var INDIGO = [79, 70, 229];

  var ui = {
    capDraft: "",
    askDraft: "",
    mode: "cap",
    showContext: false,
    recallSeqs: [],
    enterNote: null,
    enterThread: null,
    pagerLock: false
  };

  var root = document.getElementById("app");
  var mobileMq = window.matchMedia("(max-width: 720px)");
  var calmMq = window.matchMedia("(prefers-reduced-motion: reduce)");

  function isMobile() {
    return mobileMq.matches;
  }

  function otherMode(mode) {
    return mode === "cap" ? "ask" : "cap";
  }

  function $(sel) {
    return root.querySelector(sel);
  }

  function dayLabel(ts) {
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startToday) return "今天";
    if (ts >= startToday - 86400000) return "昨天";
    return "更早";
  }

  /* ───────── 渲染 ───────── */

  function renderNotes(state) {
    var notesAsc = state.notes.slice().reverse();
    var html = "";
    var lastDay = null;
    for (var i = 0; i < notesAsc.length; i++) {
      var n = notesAsc[i];
      var day = dayLabel(n.createdAt || 0);
      if (day !== lastDay) {
        if (lastDay !== null) html += "</div>";
        html += '<div class="day-label">' + day + '</div><div class="day-group">';
        lastDay = day;
      }
      var cls = ["note"];
      if (n.status === "pending") cls.push("fresh");
      if (ui.recallSeqs.indexOf(n.seq) !== -1) cls.push("recall");
      if (ui.enterNote === n.seq) cls.push("enter");
      html +=
        '<div class="' +
        cls.join(" ") +
        '" data-note-seq="' +
        n.seq +
        '">' +
        '<span class="note-dot"></span>' +
        '<span class="note-body">' +
        esc(n.content) +
        "</span>" +
        '<time class="note-time">' +
        esc(n.timeLabel) +
        "</time>" +
        "</div>";
    }
    if (lastDay !== null) html += "</div>";
    return html;
  }

  function renderThreads(state) {
    return state.threads
      .slice()
      .reverse()
      .map(function (th) {
        var isClarify = th.outcome === "clarify_asked";
        var seqs = (th.sourceSeqs || []).join(",");
        return (
          '<div class="qa' +
          (ui.enterThread === th.id ? " enter" : "") +
          '">' +
          '<div class="q">' +
          esc(th.query) +
          "</div>" +
          '<div class="a">' +
          '<div class="a-avatar">凝</div>' +
          '<div class="a-content">' +
          (isClarify
            ? '<div class="a-text">' +
              esc(th.clarifyQuestion) +
              "</div>" +
              '<div class="clarify">' +
              '<input data-c-in="' +
              esc(th.id) +
              '" placeholder="补一句说明" />' +
              '<button data-c-btn="' +
              esc(th.id) +
              '">记住</button>' +
              "</div>"
            : '<div class="a-text">' + formatRichAnswer(th.answer) + "</div>") +
          (th.cues && th.cues.length
            ? '<div class="cues">' +
              th.cues
                .map(function (c) {
                  return (
                    '<button class="cue" data-seqs="' +
                    esc(seqs) +
                    '">' +
                    ICON_LINK +
                    esc(c) +
                    "</button>"
                  );
                })
                .join("") +
              "</div>"
            : "") +
          "</div>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderContext(state) {
    return (
      '<div class="ctx-backdrop"></div>' +
      '<div class="context-popover">' +
      '<div class="sheet-grabber"></div>' +
      '<div class="popover-title">从你的随手记里自动整理</div>' +
      '<div class="ctx-grid">' +
      state.realmCards
        .map(function (c) {
          return '<div class="ctx-item"><h4>' + esc(c.title) + "</h4><p>" + esc(c.summary) + "</p></div>";
        })
        .join("") +
      "</div></div>"
    );
  }

  function renderTopbar(state) {
    return (
      '<header class="topbar">' +
      '<div class="brand">' +
      '<div class="brand-mark">' +
      ICON_MARK +
      "</div>" +
      '<span class="brand-name">拾记凝境</span>' +
      '<span class="brand-tagline">随手记日常，问更懂你的 AI</span>' +
      "</div>" +
      '<nav class="ws-nav" aria-label="切换">' +
      '<div class="ws-strip">' +
      '<button class="ws-title" data-go="cap" data-keep-focus>记录</button>' +
      '<button class="ws-title" data-go="ask" data-keep-focus>询问</button>' +
      "</div>" +
      '<span class="ws-dot"></span>' +
      "</nav>" +
      '<div class="top-actions">' +
      '<button class="top-btn ctx-btn' +
      (ui.showContext ? " active" : "") +
      '" data-act="toggle-ctx" title="我的近况">' +
      ICON_CTX +
      '<span class="label">我的近况</span></button>' +
      '<button class="top-btn icon" data-act="reset" title="重置演示">' +
      ICON_RESET +
      "</button>" +
      "</div>" +
      (ui.showContext ? renderContext(state) : "") +
      "</header>"
    );
  }

  function panelClass(mode) {
    return "panel " + MODES[mode].panel + (ui.mode === mode ? " is-active" : " is-idle");
  }

  function capMeta(state) {
    return ui.recallSeqs.length ? ui.recallSeqs.length + " 条相关" : state.notes.length + " 条";
  }

  function renderComposer(mode, placeholder, sendTitle) {
    var draft = ui[MODES[mode].draft];
    return (
      '<div class="composer">' +
      '<textarea id="' +
      MODES[mode].input +
      '" rows="1" enterkeyhint="send" placeholder="' +
      placeholder +
      '">' +
      esc(draft) +
      "</textarea>" +
      '<kbd class="kbd">Tab</kbd>' +
      '<button class="send' +
      (draft.trim() ? "" : " disabled") +
      '" data-act="send-' +
      mode +
      '" data-keep-focus title="' +
      sendTitle +
      '">' +
      ICON_UP +
      "</button>" +
      "</div>"
    );
  }

  function renderPeek(mode, label) {
    return (
      '<button class="peek" data-go="' +
      mode +
      '" data-keep-focus tabindex="-1" aria-label="切到' +
      label +
      '">' +
      '<span class="peek-dot"><b class="peek-badge">' +
      (mode === "cap" && ui.recallSeqs.length ? ui.recallSeqs.length : "") +
      "</b></span>" +
      '<span class="peek-text">' +
      label +
      "</span>" +
      "</button>"
    );
  }

  function renderCapPanel(state) {
    return (
      '<section class="' +
      panelClass("cap") +
      (ui.recallSeqs.length ? " has-recall" : "") +
      '" data-ws="cap">' +
      '<div class="panel-head">' +
      '<div class="panel-title"><span class="title-dot"></span>记录</div>' +
      '<span id="cap-meta" class="panel-meta' +
      (ui.recallSeqs.length ? " on" : "") +
      '">' +
      capMeta(state) +
      "</span>" +
      "</div>" +
      '<div id="left-stream" class="stream"><div class="stream-spacer"></div>' +
      renderNotes(state) +
      "</div>" +
      '<div class="dock">' +
      renderComposer("cap", "想到什么，随手记下", "记下") +
      '<div class="dock-hint">Enter 记下 · Tab 去询问</div>' +
      "</div>" +
      renderPeek("cap", "记录") +
      "</section>"
    );
  }

  function renderAskPanel(state) {
    return (
      '<section class="' +
      panelClass("ask") +
      '" data-ws="ask">' +
      '<div class="panel-head">' +
      '<div class="panel-title"><span class="title-dot"></span>询问<span class="absorb-tag">已融入你的境况</span></div>' +
      '<span class="panel-meta">基于你的记录作答</span>' +
      "</div>" +
      '<div id="right-stream" class="stream"><div class="stream-spacer"></div>' +
      renderThreads(state) +
      "</div>" +
      '<div class="dock">' +
      '<div class="chips"><div class="chips-clip"><div class="chips-row">' +
      window.ShijiStore.suggestedAsks
        .map(function (s) {
          return '<button class="suggest" data-preset="' + esc(s.query) + '">' + esc(s.short) + "</button>";
        })
        .join("") +
      "</div></div></div>" +
      renderComposer("ask", "问点什么", "发问") +
      '<div class="dock-hint">Enter 发问 · Tab 回记录</div>' +
      "</div>" +
      renderPeek("ask", "询问") +
      "</section>"
    );
  }

  function render(opts) {
    opts = opts || {};
    var state = store.getState();
    var prevLeft = document.getElementById("left-stream");
    var prevRight = document.getElementById("right-stream");
    var prevPager = $(".split");
    var keepLeft = prevLeft ? prevLeft.scrollTop : null;
    var keepRight = prevRight ? prevRight.scrollTop : null;
    var keepPager = prevPager && !opts.resetPager ? prevPager.scrollLeft : null;
    var focusedId = document.activeElement && document.activeElement.id;

    root.innerHTML =
      '<div class="app mode-' +
      ui.mode +
      (ui.askDraft.trim() ? "" : " ask-empty") +
      '" style="--p:' +
      (ui.mode === "ask" ? 1 : 0) +
      '">' +
      renderTopbar(state) +
      '<main class="split">' +
      '<i class="edge"></i>' +
      renderCapPanel(state) +
      renderAskPanel(state) +
      '<i class="edge"></i>' +
      "</main>" +
      "</div>";

    wireInputs();
    wirePager(keepPager);

    var ls = document.getElementById("left-stream");
    var rs = document.getElementById("right-stream");
    ls.scrollTop = opts.capBottom || keepLeft === null ? ls.scrollHeight : keepLeft;
    rs.scrollTop = opts.askBottom || keepRight === null ? rs.scrollHeight : keepRight;

    var target = opts.focus || focusedId;
    var el = target && document.getElementById(target);
    if (el && el.tagName === "TEXTAREA") {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    ui.enterNote = null;
    ui.enterThread = null;
  }

  /* ───────── 工作区切换 ───────── */

  // 原地切换：不重建 DOM，桌面端靠 CSS 过渡伸缩，移动端由滑动进度驱动
  function setMode(mode) {
    if (ui.mode === mode) return;
    ui.mode = mode;
    var app = $(".app");
    if (!app) return;
    app.classList.remove("mode-cap", "mode-ask");
    app.classList.add("mode-" + mode);
    ["cap", "ask"].forEach(function (m) {
      var panel = $("." + MODES[m].panel);
      panel.classList.toggle("is-active", m === mode);
      panel.classList.toggle("is-idle", m !== mode);
    });
    if (isMobile()) {
      var active = document.activeElement;
      if (active && active.tagName === "TEXTAREA" && !active.closest("." + MODES[mode].panel)) active.blur();
      if (navigator.vibrate) navigator.vibrate(6);
    } else {
      pinStreams(720);
    }
  }

  function focusMode(mode) {
    var el = document.getElementById(MODES[mode].input);
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setMode(mode);
  }

  function goMode(mode) {
    setMode(mode);
    var pager = $(".split");
    if (!isMobile() || !pager) return;
    ui.pagerLock = true;
    pager.scrollTo({
      left: mode === "ask" ? pager.scrollWidth - pager.clientWidth : 0,
      behavior: calmMq.matches ? "auto" : "smooth"
    });
    clearTimeout(goMode.timer);
    goMode.timer = setTimeout(function () {
      ui.pagerLock = false;
    }, 520);
  }

  // 主动切换：键盘已弹起时把焦点直接交给另一侧，键盘不收起
  function switchTo(mode) {
    if (!isMobile()) {
      focusMode(mode);
      return;
    }
    var active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") {
      document.getElementById(MODES[mode].input).focus({ preventScroll: true });
    }
    goMode(mode);
  }

  function wirePager(keepLeft) {
    var pager = $(".split");
    var app = $(".app");
    if (!pager || !app || !isMobile()) return;
    var target = ui.mode === "ask" ? pager.scrollWidth - pager.clientWidth : 0;
    pager.scrollLeft = keepLeft != null ? keepLeft : target;
    if (ui.pagerLock) pager.scrollTo({ left: target, behavior: "smooth" });
    pager.addEventListener(
      "scroll",
      function () {
        var max = pager.scrollWidth - pager.clientWidth;
        if (max <= 0) return;
        var p = Math.max(0, Math.min(1, pager.scrollLeft / max));
        app.style.setProperty("--p", p.toFixed(3));
        if (!ui.pagerLock) setMode(p > 0.5 ? "ask" : "cap");
      },
      { passive: true }
    );
  }

  // 面板宽度过渡期间，原本贴底的内容流保持贴底，避免换行重排时跳动
  function pinStreams(ms) {
    var list = ["left-stream", "right-stream"]
      .map(function (id) {
        var el = document.getElementById(id);
        return el && el.scrollHeight - el.scrollTop - el.clientHeight < 24 ? el : null;
      })
      .filter(Boolean);
    if (!list.length) return;
    var end = performance.now() + ms;
    (function tick() {
      list.forEach(function (el) {
        el.scrollTop = el.scrollHeight;
      });
      if (performance.now() < end) requestAnimationFrame(tick);
    })();
  }

  /* ───────── 输入 ───────── */

  function autosize(el) {
    var line = isMobile() ? 24 : 22;
    el.style.height = line + "px";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  }

  function wireInputs() {
    ["cap", "ask"].forEach(function (mode) {
      var cfg = MODES[mode];
      var el = document.getElementById(cfg.input);
      autosize(el);
      el.addEventListener("input", function () {
        ui[cfg.draft] = el.value;
        autosize(el);
        el.parentNode.querySelector(".send").classList.toggle("disabled", !el.value.trim());
        if (mode === "ask") {
          $(".app").classList.toggle("ask-empty", !el.value.trim());
          scheduleRecall(el.value);
        }
      });
      el.addEventListener("keydown", function (e) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (mode === "cap") doCap();
          else doAsk();
        } else if (e.key === "Tab" && !isMobile()) {
          e.preventDefault();
          focusMode(otherMode(mode));
        }
      });
    });
  }

  function doCap() {
    var val = ui.capDraft.trim();
    if (!val) return;
    ui.capDraft = "";
    var res = store.captureNote(val);
    ui.enterNote = res.note.seq;
    render({ capBottom: true, focus: isMobile() ? null : "cap-in" });
    percolate(
      $('[data-note-seq="' + res.note.seq + '"] .note-dot'),
      $(isMobile() ? ".panel-right .peek-dot" : ".panel-right .title-dot")
    );
  }

  function doAsk(text) {
    var val = String(text != null ? text : ui.askDraft).trim();
    if (!val) return;
    if (text == null) ui.askDraft = "";
    clearTimeout(scheduleRecall.timer);
    ui.recallSeqs = [];
    var th = store.askQuestion(val);
    ui.enterThread = th.id;
    render({ askBottom: true, focus: isMobile() ? null : "ask-in" });
    if (!th.sourceSeqs.length) return;
    if (isMobile()) {
      pulseCapPeek(th.sourceSeqs.length);
    } else {
      setTimeout(function () {
        flashNotes(th.sourceSeqs);
      }, 160);
    }
  }

  function submitClarify(tid) {
    var input = $('[data-c-in="' + tid + '"]');
    if (!input || !input.value.trim()) return;
    store.clarifyThread(tid, input.value.trim());
    render({ capBottom: true, askBottom: true });
    if (!isMobile()) flashNotes([store.getState().notes[0].seq]);
  }

  function resetAll() {
    store.resetDemo();
    ui.capDraft = "";
    ui.askDraft = "";
    ui.showContext = false;
    ui.recallSeqs = [];
    ui.mode = "cap";
    render({ capBottom: true, askBottom: true, resetPager: true, focus: isMobile() ? null : "cap-in" });
  }

  /* ───────── 记录 ↔ 询问 的联动 ───────── */

  // 边问边浮现：输入问题时，记录侧实时亮起会被用到的那几条
  function scheduleRecall(q) {
    clearTimeout(scheduleRecall.timer);
    scheduleRecall.timer = setTimeout(function () {
      ui.recallSeqs = store.previewRecall(q);
      applyRecall();
    }, 140);
  }

  function applyRecall() {
    var seqs = ui.recallSeqs;
    var last = null;
    root.querySelectorAll(".panel-left .note").forEach(function (n) {
      var on = seqs.indexOf(Number(n.getAttribute("data-note-seq"))) !== -1;
      n.classList.toggle("recall", on);
      if (on) last = n;
    });
    var meta = document.getElementById("cap-meta");
    if (meta) {
      meta.textContent = capMeta(store.getState());
      meta.classList.toggle("on", seqs.length > 0);
    }
    var badge = $(".panel-left .peek-badge");
    if (badge) badge.textContent = seqs.length || "";
    var panel = $(".panel-left");
    if (panel) panel.classList.toggle("has-recall", seqs.length > 0);
    if (last && !isMobile()) ensureVisible(last);
  }

  function flashNotes(seqs) {
    var hits = [];
    root.querySelectorAll(".panel-left .note").forEach(function (n) {
      n.classList.remove("highlight");
      if (seqs.indexOf(Number(n.getAttribute("data-note-seq"))) !== -1) {
        void n.offsetWidth;
        n.classList.add("highlight");
        hits.push(n);
      }
    });
    if (hits.length) ensureVisible(hits[hits.length - 1]);
    clearTimeout(flashNotes.timer);
    flashNotes.timer = setTimeout(function () {
      root.querySelectorAll(".note.highlight").forEach(function (n) {
        n.classList.remove("highlight");
      });
    }, 2200);
  }

  function ensureVisible(el) {
    var box = el.closest(".stream");
    if (!box) return;
    var r = el.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    if (r.top >= b.top + 8 && r.bottom <= b.bottom - 8) return;
    box.scrollTo({
      top: box.scrollTop + (r.top - b.top) - box.clientHeight / 2 + r.height / 2,
      behavior: calmMq.matches ? "auto" : "smooth"
    });
  }

  // 记下的一句化作光点，沿弧线流入询问侧：记录在为 AI 积累对你的理解
  function percolate(from, to) {
    if (!from || !to || calmMq.matches || !from.animate) {
      absorb();
      return;
    }
    var a = from.getBoundingClientRect();
    var b = to.getBoundingClientRect();
    var x0 = a.left + a.width / 2;
    var y0 = a.top + a.height / 2;
    var x1 = b.left + b.width / 2;
    var y1 = b.top + b.height / 2;
    var cx = x0 + (x1 - x0) * 0.25;
    var cy = Math.min(y0, y1) - 36;
    var frames = [];
    for (var i = 0; i <= 20; i++) {
      var t = i / 20;
      var u = 1 - t;
      var x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      var y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      var rgb = GREEN.map(function (g, k) {
        return Math.round(g + (INDIGO[k] - g) * t);
      });
      frames.push({
        offset: t,
        transform: "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + (1 - 0.35 * t).toFixed(3) + ")",
        backgroundColor: "rgb(" + rgb.join(",") + ")"
      });
    }
    [0, 1, 2].forEach(function (k) {
      var orb = document.createElement("span");
      orb.className = "orb orb-" + k;
      document.body.appendChild(orb);
      var anim = orb.animate(frames, {
        duration: 880,
        delay: k * 46,
        easing: "cubic-bezier(0.55, 0, 0.2, 1)",
        fill: "both"
      });
      anim.onfinish = function () {
        orb.remove();
        if (k === 0) absorb();
      };
    });
  }

  function absorb() {
    var panel = $(".panel-right");
    if (!panel) return;
    panel.classList.remove("absorbing");
    void panel.offsetWidth;
    panel.classList.add("absorbing");
    clearTimeout(absorb.timer);
    absorb.timer = setTimeout(function () {
      var p = $(".panel-right");
      if (p) p.classList.remove("absorbing");
    }, 1900);
  }

  // 移动端：回答用到了几条记录，左侧露出的记录边签上亮出数字
  function pulseCapPeek(n) {
    var panel = $(".panel-left");
    var badge = $(".panel-left .peek-badge");
    if (!panel || !badge) return;
    badge.textContent = n;
    panel.classList.add("has-recall", "absorbing");
    clearTimeout(pulseCapPeek.timer);
    pulseCapPeek.timer = setTimeout(function () {
      var p = $(".panel-left");
      if (!p) return;
      p.classList.remove("absorbing");
      if (!ui.recallSeqs.length) p.classList.remove("has-recall");
    }, 2600);
  }

  /* ───────── 事件 ───────── */

  root.addEventListener("click", function (e) {
    var actEl = e.target.closest("[data-act]");
    if (actEl) {
      var act = actEl.getAttribute("data-act");
      if (act === "send-cap") doCap();
      else if (act === "send-ask") doAsk();
      else if (act === "toggle-ctx") {
        ui.showContext = !ui.showContext;
        render();
      } else if (act === "reset") resetAll();
      return;
    }

    if (ui.showContext && !e.target.closest(".context-popover")) {
      ui.showContext = false;
      render();
      return;
    }

    var go = e.target.closest("[data-go]");
    if (go) {
      switchTo(go.getAttribute("data-go"));
      return;
    }

    var preset = e.target.closest("[data-preset]");
    if (preset) {
      doAsk(preset.getAttribute("data-preset"));
      return;
    }

    var cue = e.target.closest("[data-seqs]");
    if (cue) {
      var seqs = cue.getAttribute("data-seqs").split(",").filter(Boolean).map(Number);
      if (!seqs.length) return;
      if (isMobile() && ui.mode !== "cap") {
        goMode("cap");
        setTimeout(function () {
          flashNotes(seqs);
        }, 380);
      } else {
        flashNotes(seqs);
      }
      return;
    }

    var cbtn = e.target.closest("[data-c-btn]");
    if (cbtn) {
      submitClarify(cbtn.getAttribute("data-c-btn"));
      return;
    }

    // 点在另一侧工作区的空白处：切过去
    var ws = e.target.closest("[data-ws]");
    if (
      ws &&
      ws.getAttribute("data-ws") !== ui.mode &&
      !e.target.closest("button, input, textarea") &&
      window.getSelection().isCollapsed
    ) {
      switchTo(ws.getAttribute("data-ws"));
    }
  });

  // 桌面端：光标落在哪一侧的输入框，哪一侧就成为主工作区
  root.addEventListener("focusin", function (e) {
    if (isMobile() || !e.target.matches("textarea, input")) return;
    var ws = e.target.closest("[data-ws]");
    if (ws) setMode(ws.getAttribute("data-ws"));
  });

  root.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches("[data-c-in]")) {
      e.preventDefault();
      submitClarify(e.target.getAttribute("data-c-in"));
    }
  });

  root.addEventListener("mousedown", function (e) {
    if (e.target.closest("[data-keep-focus]")) e.preventDefault();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ui.showContext) {
      ui.showContext = false;
      render();
    }
  });

  mobileMq.addEventListener("change", function () {
    render({ capBottom: true, askBottom: true, resetPager: true });
  });

  // iOS 键盘弹起时可视区变矮：让应用高度跟随可视区，输入框始终贴在键盘上方
  if (window.visualViewport) {
    var vv = window.visualViewport;
    var syncViewport = function () {
      document.documentElement.style.setProperty("--vvh", vv.height + "px");
      if (isMobile()) window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", syncViewport);
    syncViewport();
  }

  render({ capBottom: true, askBottom: true, focus: isMobile() ? null : "cap-in" });
})();
