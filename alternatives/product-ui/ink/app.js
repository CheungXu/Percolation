(function () {
  "use strict";

  var store = window.ShijiStore.create("3011-ink");
  var esc = window.ShijiStore.utils.esc;
  var formatRichAnswer = window.ShijiStore.utils.formatRichAnswer;

  var ui = {
    tab: "desk", // 'desk' | 'notes' | 'realm'
    mode: "capture", // 'capture' | 'ask'
    draft: "",
    whisper: ""
  };

  var root = document.getElementById("app");

  function flash(msg) {
    ui.whisper = msg;
    render();
    setTimeout(function () {
      if (ui.whisper === msg) {
        ui.whisper = "";
        render();
      }
    }, 2400);
  }

  function renderMountainSVG() {
    return (
      '<svg class="song-ink-bg" viewBox="0 0 720 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '  <circle cx="535" cy="56" r="15" fill="#A63429" fill-opacity="0.24"/>' +
      '  <path d="M160 195 Q305 64 445 128 T720 58 L720 0 L160 0 Z" fill="#335751" fill-opacity="0.13"/>' +
      '  <path d="M310 205 Q455 92 575 142 T720 92 L720 0 L310 0 Z" fill="#1D201E" fill-opacity="0.11"/>' +
      '  <path d="M460 156 Q480 163 502 155 L494 161 L468 161 Z" fill="#1D201E" fill-opacity="0.45"/>' +
      '  <path d="M481 156 L478 147 L485 152 Z" fill="#1D201E" fill-opacity="0.35"/>' +
      '  <g stroke="#2B332F" stroke-opacity="0.22" stroke-width="1.3" stroke-linecap="round">' +
      '    <path d="M676 190 Q668 112 655 26"/>' +
      '    <path d="M663 82 L638 68 M661 86 L643 96"/>' +
      '    <path d="M659 50 L636 40"/>' +
      "  </g>" +
      "</svg>"
    );
  }

  function render() {
    var state = store.getState();
    var latestThread = state.threads[0];

    root.innerHTML =
      renderMountainSVG() +
      '<div class="ink-stage">' +
      // Minimalist Header
      '<header class="ink-nav">' +
      '  <div class="ink-brand">' +
      "    <h1>拾记凝境</h1>" +
      '    <span class="seal-stamp">凝境</span>' +
      "  </div>" +
      '  <nav class="ink-links">' +
      '    <button class="nav-item ' +
      (ui.tab === "desk" ? "active" : "") +
      '" data-tab="desk">案几</button>' +
      '    <button class="nav-item ' +
      (ui.tab === "notes" ? "active" : "") +
      '" data-tab="notes">手札</button>' +
      '    <button class="nav-item ' +
      (ui.tab === "realm" ? "active" : "") +
      '" data-tab="realm">境况</button>' +
      '    <button class="nav-reset" data-act="reset" title="恢复演示">↻</button>' +
      "  </nav>" +
      "</header>" +
      (ui.tab === "desk"
        ? // 主页：素笺 + 单条聚焦回响 + 三行手札微览
          '<section class="paper-sheet">' +
          '  <div class="sheet-top">' +
          '    <div class="mode-pair">' +
          '      <button class="mode-word ' +
          (ui.mode === "capture" ? "active-cap" : "") +
          '" data-mode="capture"><span class="mode-dot"></span>拾记</button>' +
          '      <button class="mode-word ' +
          (ui.mode === "ask" ? "active-ask" : "") +
          '" data-mode="ask"><span class="mode-dot"></span>寻问</button>' +
          "    </div>" +
          (ui.whisper ? '<span class="whisper-msg">' + esc(ui.whisper) + "</span>" : "") +
          "  </div>" +
          '  <textarea id="ink-input" class="sheet-input" placeholder="' +
          esc(
            ui.mode === "capture"
              ? "随手落笔一句日常、期约或念头…"
              : "结合你的人生境况寻问…"
          ) +
          '">' +
          esc(ui.draft) +
          "</textarea>" +
          '  <div class="sheet-foot">' +
          '    <span class="subtle-tagline">拾零散片语，凝人生近况</span>' +
          '    <button class="seal-action ' +
          (ui.mode === "ask" ? "ask" : "") +
          '" data-act="submit">' +
          (ui.mode === "capture" ? "落笔" : "寻问") +
          "</button>" +
          "  </div>" +
          "</section>" +
          '<div class="bamboo-whisper-row">' +
          window.ShijiStore.suggestedAsks
            .map(function (s) {
              return (
                '<button class="bamboo-chip" data-suggest="' +
                esc(s.query) +
                '">' +
                esc(s.short) +
                "</button>"
              );
            })
            .join("") +
          "</div>" +
          (latestThread
            ? '<article class="echo-card ' +
              (latestThread.outcome === "clarify_asked" ? "clarify" : "") +
              '">' +
              '  <div class="echo-q"><span>「' +
              esc(latestThread.query) +
              "」</span><span>" +
              esc(latestThread.timeLabel) +
              "</span></div>" +
              (latestThread.outcome === "clarify_asked"
                ? "<div>" +
                  esc(latestThread.clarifyQuestion) +
                  '<div class="clarify-bar">' +
                  '<input class="clarify-in" data-c-in="' +
                  esc(latestThread.id) +
                  '" placeholder="补一句简短说明…" />' +
                  '<button class="seal-action" data-c-btn="' +
                  esc(latestThread.id) +
                  '">补记</button></div></div>'
                : '<div class="echo-prose">' + formatRichAnswer(latestThread.answer) + "</div>") +
              (latestThread.cues && latestThread.cues.length
                ? '<div class="echo-cues"><span>依凭记忆：</span>' +
                  latestThread.cues
                    .map(function (c) {
                      return '<span class="cue-slip">' + esc(c) + "</span>";
                    })
                    .join("") +
                  "</div>"
                : "") +
              "</article>"
            : "") +
          '<section class="mini-jottings">' +
          '  <div class="mini-head"><span>近期手札</span><button class="nav-item" style="font-size:13px;" data-tab="notes">全部 ' +
          state.notes.length +
          " 则 →</button></div>" +
          state.notes
            .slice(0, 3)
            .map(function (n) {
              return (
                '<div class="mini-row"><span>' +
                esc(n.content) +
                "</span><time>" +
                esc(n.timeLabel) +
                "</time></div>"
              );
            })
            .join("") +
          "</section>"
        : ui.tab === "notes"
        ? // 手札列表页
          '<section class="subpage-list">' +
          state.notes
            .map(function (n) {
              return (
                '<div class="note-slip"><span>' +
                esc(n.content) +
                '</span><time style="color:var(--ink-400);font-size:13px;white-space:nowrap;">' +
                esc(n.timeLabel) +
                "</time></div>"
              );
            })
            .join("") +
          "</section>"
        : // 境况四笺页
          '<section class="realm-grid">' +
          state.realmCards
            .map(function (c) {
              return (
                '<div class="realm-card"><h3>' +
                esc(c.title) +
                "</h3><p>" +
                esc(c.summary) +
                "</p></div>"
              );
            })
            .join("") +
          "</section>") +
      "</div>";

    wireInput();
  }

  function submit() {
    var val = String(ui.draft || "").trim();
    if (!val) return;
    ui.draft = "";
    if (ui.mode === "capture") {
      store.captureNote(val);
      flash("已落笔收卷");
    } else {
      store.askQuestion(val);
      render();
    }
    var inp = document.getElementById("ink-input");
    if (inp) inp.focus();
  }

  function wireInput() {
    var inp = document.getElementById("ink-input");
    if (!inp) return;
    inp.addEventListener("input", function (e) {
      ui.draft = e.target.value;
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  }

  root.addEventListener("click", function (e) {
    var tabEl = e.target.closest("[data-tab]");
    if (tabEl) {
      ui.tab = tabEl.getAttribute("data-tab");
      render();
      return;
    }

    var modeEl = e.target.closest("[data-mode]");
    if (modeEl) {
      ui.mode = modeEl.getAttribute("data-mode");
      render();
      var inp = document.getElementById("ink-input");
      if (inp) inp.focus();
      return;
    }

    var sugEl = e.target.closest("[data-suggest]");
    if (sugEl) {
      ui.mode = "ask";
      store.askQuestion(sugEl.getAttribute("data-suggest"));
      render();
      return;
    }

    var actEl = e.target.closest("[data-act]");
    if (actEl) {
      var act = actEl.getAttribute("data-act");
      if (act === "submit") submit();
      else if (act === "reset") {
        store.resetDemo();
        ui.draft = "";
        ui.tab = "desk";
        flash("已重展初卷");
      }
      return;
    }

    var cbtn = e.target.closest("[data-c-btn]");
    if (cbtn) {
      var tid = cbtn.getAttribute("data-c-btn");
      var cin = root.querySelector('[data-c-in="' + tid + '"]');
      if (cin && cin.value.trim()) {
        store.clarifyThread(tid, cin.value.trim());
        render();
      }
    }
  });

  root.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches("[data-c-in]")) {
      e.preventDefault();
      var tid = e.target.getAttribute("data-c-in");
      if (e.target.value.trim()) {
        store.clarifyThread(tid, e.target.value.trim());
        render();
      }
    }
  });

  render();
})();
