(function () {
  "use strict";

  var store = window.ShijiStore.create("3014-braun");
  var esc = window.ShijiStore.utils.esc;
  var formatRichAnswer = window.ShijiStore.utils.formatRichAnswer;

  var ui = {
    rightMode: "ask", // 'ask' | 'realm'
    capDraft: "",
    askDraft: "",
    msg: ""
  };

  var root = document.getElementById("app");

  function flash(m) {
    ui.msg = m;
    render();
    setTimeout(function () {
      if (ui.msg === m) {
        ui.msg = "";
        render();
      }
    }, 2000);
  }

  function render() {
    var state = store.getState();
    var latest = state.threads[0];

    root.innerHTML =
      '<div class="braun-frame">' +
      '<header class="braun-top">' +
      '  <div class="braun-logo"><span class="orange-dot"></span><strong>拾记凝境</strong></div>' +
      '  <nav class="braun-nav">' +
      '    <button class="b-link ' +
      (ui.rightMode === "ask" ? "active" : "") +
      '" data-rmode="ask">询问</button>' +
      '    <button class="b-link ' +
      (ui.rightMode === "realm" ? "active" : "") +
      '" data-rmode="realm">已凝境况</button>' +
      '    <button class="b-link" data-act="reset" title="重置">↻</button>' +
      "  </nav>" +
      "</header>" +
      '<main class="swiss-grid">' +
      // Left Column: Capture + Recent
      '  <aside class="col-left">' +
      '    <section class="cell-capture">' +
      '      <div class="cell-head">记录</div>' +
      '      <textarea id="b-cap" class="b-textarea" placeholder="随手记下一句日常…">' +
      esc(ui.capDraft) +
      "</textarea>" +
      '      <div class="cap-foot">' +
      '        <span class="cap-msg">' +
      esc(ui.msg) +
      "</span>" +
      '        <button class="btn-orange" data-act="cap">记录</button>' +
      "      </div>" +
      "    </section>" +
      '    <section class="cell-recent">' +
      '      <div class="cell-head">最近记录</div>' +
      state.notes
        .map(function (n) {
          return (
            '<div class="r-item"><span>' +
            esc(n.content) +
            "</span><time>" +
            esc(n.timeLabel) +
            "</time></div>"
          );
        })
        .join("") +
      "    </section>" +
      "  </aside>" +
      // Right Column: Focused Inquiry OR 4-Cell Realm
      '  <section class="col-right">' +
      (ui.rightMode === "ask"
        ? '<div class="qa-display">' +
          '  <div class="cell-head">最新解答</div>' +
          (latest
            ? '<h2 class="q-heading">' +
              esc(latest.query) +
              "</h2>" +
              (latest.outcome === "clarify_asked"
                ? '<div class="a-text">' +
                  esc(latest.clarifyQuestion) +
                  "</div>" +
                  '<div class="b-clarify">' +
                  '  <input data-c-in="' +
                  esc(latest.id) +
                  '" placeholder="补一句简短说明…" />' +
                  '  <button class="btn-orange" data-c-btn="' +
                  esc(latest.id) +
                  '">确定</button>' +
                  "</div>"
                : '<div class="a-text">' + formatRichAnswer(latest.answer) + "</div>") +
              (latest.cues && latest.cues.length
                ? '<div class="cue-boxes">' +
                  latest.cues
                    .map(function (c) {
                      return '<span class="cue-box">' + esc(c) + "</span>";
                    })
                    .join("") +
                  "</div>"
                : "")
            : "") +
          "</div>" +
          '<footer class="ask-footer">' +
          '  <div class="preset-links">' +
          window.ShijiStore.suggestedAsks
            .map(function (s) {
              return (
                '<button class="p-link" data-preset="' +
                esc(s.query) +
                '">→ ' +
                esc(s.short) +
                "</button>"
              );
            })
            .join("") +
          "  </div>" +
          '  <div class="ask-row">' +
          '    <input id="b-ask" value="' +
          esc(ui.askDraft) +
          '" placeholder="结合你的近况提问…" />' +
          '    <button class="btn-black" data-act="ask">询问</button>' +
          "  </div>" +
          "</footer>"
        : '<div class="realm-matrix">' +
          state.realmCards
            .map(function (c) {
              return (
                '<div class="rm-cell"><h3>' +
                esc(c.title) +
                "</h3><p>" +
                esc(c.summary) +
                "</p></div>"
              );
            })
            .join("") +
          "</div>") +
      "  </section>" +
      "</main>" +
      "</div>";

    wireInputs();
  }

  function doCap() {
    var val = String(ui.capDraft || "").trim();
    if (!val) return;
    ui.capDraft = "";
    store.captureNote(val);
    flash("已记录");
    var c = document.getElementById("b-cap");
    if (c) c.focus();
  }

  function doAsk() {
    var val = String(ui.askDraft || "").trim();
    if (!val) return;
    ui.askDraft = "";
    ui.rightMode = "ask";
    store.askQuestion(val);
    render();
  }

  function wireInputs() {
    var c = document.getElementById("b-cap");
    if (c) {
      c.addEventListener("input", function (e) {
        ui.capDraft = e.target.value;
      });
      c.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doCap();
        }
      });
    }
    var a = document.getElementById("b-ask");
    if (a) {
      a.addEventListener("input", function (e) {
        ui.askDraft = e.target.value;
      });
      a.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          doAsk();
        }
      });
    }
  }

  root.addEventListener("click", function (e) {
    var rmode = e.target.closest("[data-rmode]");
    if (rmode) {
      ui.rightMode = rmode.getAttribute("data-rmode");
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
        ui.capDraft = "";
        ui.askDraft = "";
        ui.rightMode = "ask";
        render();
      }
      return;
    }

    var preset = e.target.closest("[data-preset]");
    if (preset) {
      ui.rightMode = "ask";
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
