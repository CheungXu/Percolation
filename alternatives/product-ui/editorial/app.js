(function () {
  "use strict";

  var store = window.ShijiStore.create("3013-cosmos");
  var esc = window.ShijiStore.utils.esc;
  var formatRichAnswer = window.ShijiStore.utils.formatRichAnswer;

  var ui = {
    view: "home", // 'home' | 'notes' | 'realm'
    draft: "",
    whisper: ""
  };

  var root = document.getElementById("app");

  function notify(msg) {
    ui.whisper = msg;
    render();
    setTimeout(function () {
      if (ui.whisper === msg) {
        ui.whisper = "";
        render();
      }
    }, 2200);
  }

  function render() {
    var state = store.getState();
    var latest = state.threads[0];

    root.innerHTML =
      '<div class="night-wrap">' +
      '<header class="night-nav">' +
      '  <div class="night-brand"><span class="glow-dot"></span>拾记凝境</div>' +
      '  <nav class="night-links">' +
      '    <button class="night-pill ' +
      (ui.view === "home" ? "active" : "") +
      '" data-view="home">聚光舱</button>' +
      '    <button class="night-pill ' +
      (ui.view === "notes" ? "active" : "") +
      '" data-view="notes">最近记录 (' +
      state.notes.length +
      ")</button>" +
      '    <button class="night-pill ' +
      (ui.view === "realm" ? "active" : "") +
      '" data-view="realm">人生境况</button>' +
      '    <button class="night-pill" data-act="reset" title="重置">↻</button>' +
      "  </nav>" +
      "</header>" +
      (ui.view === "home"
        ? '<h1 class="hero-title">越随手记，越懂你的处境</h1>' +
          '<section class="spotlight">' +
          '  <textarea id="spot-in" class="spot-textarea" placeholder="写下一句日常近况，或直接向 AI 提问…">' +
          esc(ui.draft) +
          "</textarea>" +
          '  <div class="spot-bar">' +
          '    <span class="spot-whisper ' +
          (ui.whisper ? "done" : "") +
          '">' +
          esc(ui.whisper || "Enter 记录 · ⌘+Enter 询问") +
          "</span>" +
          '    <div class="spot-actions">' +
          '      <button class="dark-btn" data-act="cap">记录</button>' +
          '      <button class="dark-btn primary" data-act="ask">询问</button>' +
          "    </div>" +
          "  </div>" +
          "</section>" +
          '<div class="quick-row">' +
          window.ShijiStore.suggestedAsks
            .map(function (s) {
              return (
                '<button class="quick-chip" data-preset="' +
                esc(s.query) +
                '">' +
                esc(s.short) +
                "</button>"
              );
            })
            .join("") +
          "</div>" +
          (latest
            ? '<article class="insight-card">' +
              '  <div class="insight-q"><span>' +
              esc(latest.query) +
              "</span><span>" +
              esc(latest.timeLabel) +
              "</span></div>" +
              (latest.outcome === "clarify_asked"
                ? '<div class="insight-body">' +
                  esc(latest.clarifyQuestion) +
                  "</div>" +
                  '<div class="clarify-row">' +
                  '  <input data-c-in="' +
                  esc(latest.id) +
                  '" placeholder="补一句简短说明…" />' +
                  '  <button class="dark-btn primary" data-c-btn="' +
                  esc(latest.id) +
                  '">记住</button>' +
                  "</div>"
                : '<div class="insight-body">' + formatRichAnswer(latest.answer) + "</div>") +
              (latest.cues && latest.cues.length
                ? '<div class="insight-cues">' +
                  latest.cues
                    .map(function (c) {
                      return '<span class="cue-tag">' + esc(c) + "</span>";
                    })
                    .join("") +
                  "</div>"
                : "") +
              "</article>"
            : "")
        : ui.view === "notes"
        ? '<section class="clean-list">' +
          state.notes
            .map(function (n) {
              return (
                '<div class="clean-item"><span>' +
                esc(n.content) +
                "</span><time>" +
                esc(n.timeLabel) +
                "</time></div>"
              );
            })
            .join("") +
          "</section>"
        : '<section class="realm-2col">' +
          state.realmCards
            .map(function (c) {
              return (
                '<div class="dark-realm"><h3>' +
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

  function doCap() {
    var val = String(ui.draft || "").trim();
    if (!val) return;
    ui.draft = "";
    store.captureNote(val);
    notify("已记入境况");
    var inp = document.getElementById("spot-in");
    if (inp) inp.focus();
  }

  function doAsk() {
    var val = String(ui.draft || "").trim();
    if (!val) return;
    ui.draft = "";
    store.askQuestion(val);
    render();
  }

  function wireInput() {
    var inp = document.getElementById("spot-in");
    if (!inp) return;
    inp.addEventListener("input", function (e) {
      ui.draft = e.target.value;
    });
    inp.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doAsk();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doCap();
      }
    });
  }

  root.addEventListener("click", function (e) {
    var viewEl = e.target.closest("[data-view]");
    if (viewEl) {
      ui.view = viewEl.getAttribute("data-view");
      render();
      return;
    }

    var actEl = e.target.closest("[data-act]");
    if (actEl) {
      var act = actEl.getAttribute("data-act");
      if (act === "cap") doCap();
      else if (act === "ask") doAsk();
      else if (act === "reset") {
        store.resetDemo();
        ui.draft = "";
        ui.view = "home";
        notify("已重置");
      }
      return;
    }

    var preset = e.target.closest("[data-preset]");
    if (preset) {
      store.askQuestion(preset.getAttribute("data-preset"));
      render();
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
