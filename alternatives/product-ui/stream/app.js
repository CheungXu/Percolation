(function () {
  "use strict";

  var store = window.ShijiStore.create("3015-aurora");
  var esc = window.ShijiStore.utils.esc;
  var formatRichAnswer = window.ShijiStore.utils.formatRichAnswer;

  var ui = {
    draft: "",
    showRealms: false,
    showAllNotes: false
  };

  var root = document.getElementById("app");

  function render(scrollBottom) {
    var state = store.getState();
    var notesSlice = ui.showAllNotes ? state.notes : state.notes.slice(0, 3);
    var timeline = [];

    for (var i = 0; i < notesSlice.length; i++) {
      var n = notesSlice[i];
      timeline.push({ kind: "note", ts: n.createdAt || 0, data: n });
    }
    for (var j = 0; j < state.threads.length; j++) {
      var th = state.threads[j];
      var ts =
        th.id === "t-init"
          ? Date.now() - 10 * 60 * 1000
          : Number(th.id.split("-")[1] || Date.now());
      timeline.push({ kind: "qa", ts: ts, data: th });
    }
    timeline.sort(function (a, b) {
      return a.ts - b.ts;
    });

    root.innerHTML =
      '<div class="stream-shell">' +
      '<header class="s-top">' +
      '  <div class="s-brand"><span class="s-orb"></span>拾记凝境</div>' +
      '  <div class="s-actions">' +
      '    <button class="glass-btn ' +
      (ui.showRealms ? "active" : "") +
      '" data-act="realms">人生境况' +
      (ui.showRealms ? " ▴" : " ▾") +
      "</button>" +
      '    <button class="glass-btn" data-act="reset" title="重置">↻</button>' +
      "  </div>" +
      "</header>" +
      (ui.showRealms
        ? '<section class="realm-float">' +
          state.realmCards
            .map(function (c) {
              return (
                '<div class="rf-item"><h4>' +
                esc(c.title) +
                "</h4><p>" +
                esc(c.summary) +
                "</p></div>"
              );
            })
            .join("") +
          "</section>"
        : "") +
      '<main id="s-feed" class="s-feed">' +
      '  <div class="feed-spacer"></div>' +
      (state.notes.length > 3
        ? '<button class="more-btn" data-act="more">' +
          (ui.showAllNotes
            ? "收起早期记录"
            : "展开更早的 " + (state.notes.length - 3) + " 条记录") +
          "</button>"
        : "") +
      timeline
        .map(function (entry) {
          if (entry.kind === "note") {
            var n = entry.data;
            return (
              '<div class="note-row">' +
              '  <div class="note-bubble">' +
              esc(n.content) +
              "</div>" +
              '  <span class="note-caption">已记下 · ' +
              esc(n.timeLabel) +
              "</span>" +
              "</div>"
            );
          }
          var th = entry.data;
          var isClarify = th.outcome === "clarify_asked";
          return (
            '<div class="qa-block">' +
            '  <div class="ask-bubble">' +
            esc(th.query) +
            "</div>" +
            '  <div class="reply-cloud">' +
            (isClarify
              ? '<div class="reply-prose">' +
                esc(th.clarifyQuestion) +
                "</div>" +
                '<div class="s-clarify">' +
                '  <input data-c-in="' +
                esc(th.id) +
                '" placeholder="随手补一句说明…" />' +
                '  <button class="pill-btn ask" data-c-btn="' +
                esc(th.id) +
                '">记住</button>' +
                "</div>"
              : '<div class="reply-prose">' + formatRichAnswer(th.answer) + "</div>") +
            (th.cues && th.cues.length
              ? '<div class="reply-cues">' +
                th.cues
                  .map(function (c) {
                    return '<span class="r-cue">' + esc(c) + "</span>";
                  })
                  .join("") +
                "</div>"
              : "") +
            "  </div>" +
            "</div>"
          );
        })
        .join("") +
      "</main>" +
      '<footer class="s-dock">' +
      '  <div class="s-chips">' +
      window.ShijiStore.suggestedAsks
        .map(function (s) {
          return (
            '<button class="s-chip" data-preset="' +
            esc(s.query) +
            '">' +
            esc(s.short) +
            "</button>"
          );
        })
        .join("") +
      "  </div>" +
      '  <div class="capsule-bar">' +
      '    <input id="s-in" value="' +
      esc(ui.draft) +
      '" placeholder="随手记日常，或直接发问…" />' +
      '    <button class="pill-btn" data-act="cap">记录</button>' +
      '    <button class="pill-btn ask" data-act="ask">询问</button>' +
      "  </div>" +
      "</footer>" +
      "</div>";

    wireInput();
    if (scrollBottom) {
      var f = document.getElementById("s-feed");
      if (f) f.scrollTop = f.scrollHeight;
    }
  }

  function doCap() {
    var val = String(ui.draft || "").trim();
    if (!val) return;
    ui.draft = "";
    store.captureNote(val);
    render(true);
    var inp = document.getElementById("s-in");
    if (inp) inp.focus();
  }

  function doAsk() {
    var val = String(ui.draft || "").trim();
    if (!val) return;
    ui.draft = "";
    store.askQuestion(val);
    render(true);
  }

  function wireInput() {
    var inp = document.getElementById("s-in");
    if (!inp) return;
    inp.addEventListener("input", function (e) {
      ui.draft = e.target.value;
    });
    inp.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doAsk();
      } else if (e.key === "Enter") {
        e.preventDefault();
        doCap();
      }
    });
  }

  root.addEventListener("click", function (e) {
    var actEl = e.target.closest("[data-act]");
    if (actEl) {
      var act = actEl.getAttribute("data-act");
      if (act === "cap") doCap();
      else if (act === "ask") doAsk();
      else if (act === "realms") {
        ui.showRealms = !ui.showRealms;
        render(false);
      } else if (act === "more") {
        ui.showAllNotes = !ui.showAllNotes;
        render(false);
      } else if (act === "reset") {
        store.resetDemo();
        ui.draft = "";
        ui.showRealms = false;
        render(true);
      }
      return;
    }

    var preset = e.target.closest("[data-preset]");
    if (preset) {
      store.askQuestion(preset.getAttribute("data-preset"));
      render(true);
      return;
    }

    var cbtn = e.target.closest("[data-c-btn]");
    if (cbtn) {
      var tid = cbtn.getAttribute("data-c-btn");
      var cin = root.querySelector('[data-c-in="' + tid + '"]');
      if (cin && cin.value.trim()) {
        store.clarifyThread(tid, cin.value.trim());
        render(true);
      }
    }
  });

  root.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches("[data-c-in]")) {
      e.preventDefault();
      var tid = e.target.getAttribute("data-c-in");
      if (e.target.value.trim()) {
        store.clarifyThread(tid, e.target.value.trim());
        render(true);
      }
    }
  });

  render(true);
})();
