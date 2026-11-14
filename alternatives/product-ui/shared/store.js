/**
 * 拾记凝境 · 极简交互与语料内核 (v3)
 * 原则：克制表达，不解释底层机制，让“随手记 -> 懂你的回答”一眼可感。
 */
(function (global) {
  "use strict";

  var BURST_WINDOW_MS = 180 * 1000;

  var SUGGESTED_ASKS = [
    {
      id: "wed-coffee",
      short: "下周三下午能约冰美式吗？",
      query: "下周三下午能约客户喝冰美式吗？"
    },
    {
      id: "old-place",
      short: "周末去老地方改方案合适吗？",
      query: "周末带电脑去老地方改方案合适吗？"
    },
    {
      id: "unknown-abai",
      short: "阿白推荐的粤菜馆叫什么？",
      query: "阿白推荐的那家粤菜馆叫什么？"
    }
  ];

  function createInitialState() {
    var now = Date.now();
    return {
      nextSeq: 7,
      nextBatchNum: 6,
      realmCards: [
        {
          id: "work",
          title: "工作",
          summary: "推进跨境合规方案；周四福田站见陈总，他偏爱纸质报价单。",
          items: [
            "周四深圳福田站见陈总，对方 17:00 赴港",
            "备两份纸质版阶梯报价单"
          ]
        },
        {
          id: "rhythm",
          title: "身心",
          summary: "右膝两周恢复期需少爬楼；下周三下午看牙，近期忌冰饮。",
          items: [
            "右膝恢复中，出行选电梯直达",
            "下周三 15:00 瑞尔齿科复查，忌冷饮"
          ]
        },
        {
          id: "people",
          title: "默契",
          summary: "「老地方」指竹里茶室靠窗座；「小满」是家里的柯基。",
          items: [
            "老地方 = 软件园南门竹里茶室（安静有插座）",
            "小满 = 三岁柯基犬"
          ]
        },
        {
          id: "wishes",
          title: "挂心",
          summary: "小满疫苗下月 10 号到期；留意千元内 15.6 寸护眼便携屏。",
          items: [
            "玄关第二抽屉收着小满疫苗本",
            "cforce OLED 便携屏好价 999 元"
          ]
        }
      ],
      notes: [
        {
          seq: 6,
          batchId: "b-5",
          content: "陈总习惯看纸质版勾画，记得打印两份报价单",
          timeLabel: "09:42",
          createdAt: now - 45 * 60 * 1000,
          status: "pending"
        },
        {
          seq: 5,
          batchId: "b-5",
          content: "周四见陈总改到福田站旁，他五点要坐高铁去香港",
          timeLabel: "09:41",
          createdAt: now - 46 * 60 * 1000,
          status: "pending"
        },
        {
          seq: 4,
          batchId: "b-4",
          content: "右膝恢复期，这两周少爬楼梯，出门挑电梯直达的",
          timeLabel: "昨天",
          createdAt: now - 20 * 3600 * 1000,
          status: "condensed"
        },
        {
          seq: 3,
          batchId: "b-3",
          content: "下周三 15:00 瑞尔齿科复查智齿，最近牙怕冷饮",
          timeLabel: "周三",
          createdAt: now - 68 * 3600 * 1000,
          status: "condensed"
        },
        {
          seq: 2,
          batchId: "b-2",
          content: "小满狂犬疫苗下月 10 号到期，疫苗本在玄关抽屉",
          timeLabel: "周二",
          createdAt: now - 92 * 3600 * 1000,
          status: "condensed"
        },
        {
          seq: 1,
          batchId: "b-1",
          content: "以后说「老地方」，就是软件园南门竹里茶室靠窗座",
          timeLabel: "周一",
          createdAt: now - 116 * 3600 * 1000,
          status: "condensed"
        }
      ],
      learnedAliases: {},
      threads: [
        {
          id: "t-init",
          query: "周四见陈总怎么安排最稳妥？",
          timeLabel: "刚刚",
          outcome: "answered",
          cues: ["福田站见陈总", "纸质报价单", "右膝少爬楼"],
          answer:
            "建议约在**福田高铁站直通层的茶室**——电梯直达照顾你**右膝恢复**，也方便他 **17:00 赶高铁去香港**。\n\n出门前带好**两份纸质报价单**；席间点温茶即可，避开冰饮。",
          clarifyQuestion: "",
          sourceSeqs: [6, 5, 4, 3]
        }
      ]
    };
  }

  function formatNow() {
    var d = new Date();
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function extractTokens(text) {
    var clean = String(text || "")
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]/g, " ")
      .trim();
    var tokens = [];
    var parts = clean.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (/^[a-z0-9]+$/.test(p)) {
        if (p.length >= 2) tokens.push(p);
      } else {
        for (var j = 0; j < p.length - 1; j++) tokens.push(p.slice(j, j + 2));
        if (p.length === 1) tokens.push(p);
      }
    }
    return tokens;
  }

  function scoreOverlap(query, target) {
    var qTokens = extractTokens(query);
    var tLower = String(target || "").toLowerCase();
    var hits = 0;
    var seen = {};
    for (var i = 0; i < qTokens.length; i++) {
      var tk = qTokens[i];
      if (seen[tk]) continue;
      seen[tk] = true;
      if (/^(什么|怎么|哪里|哪个|多少|可以|能不能|上次|之前|那个|请问|一下|合适)$/.test(tk)) continue;
      if (tLower.indexOf(tk) !== -1) hits += /^[a-z0-9]+$/.test(tk) ? 2.4 : 1.2;
    }
    return hits;
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRichAnswer(rawText) {
    var safe = esc(rawText || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return safe
      .split(/\n{2,}/)
      .map(function (block) {
        return "<p>" + block.split("\n").join("<br/>") + "</p>";
      })
      .join("");
  }

  function createStore(variantKey) {
    var port = (global.location && global.location.port) || "web";
    var storageKey = "shiji_ningjing_v3_" + (variantKey || port);
    var state = loadState();

    function loadState() {
      try {
        var raw = global.localStorage && global.localStorage.getItem(storageKey);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.notes) && Array.isArray(parsed.threads)) {
            return parsed;
          }
        }
      } catch (e) {}
      return createInitialState();
    }

    function persist() {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(storageKey, JSON.stringify(state));
        }
      } catch (e) {}
    }

    function getNoteBySeq(seq) {
      for (var i = 0; i < state.notes.length; i++) {
        if (state.notes[i].seq === Number(seq)) return state.notes[i];
      }
      return null;
    }

    function captureNote(content) {
      var trimmed = String(content || "").trim();
      if (!trimmed) return null;
      var now = Date.now();
      var latest = state.notes[0];
      var sameBurst = latest && now - (latest.createdAt || 0) <= BURST_WINDOW_MS;
      var note = {
        seq: state.nextSeq++,
        batchId: sameBurst ? latest.batchId : "b-" + state.nextBatchNum++,
        content: trimmed,
        timeLabel: formatNow(),
        createdAt: now,
        status: "pending"
      };
      state.notes.unshift(note);
      persist();
      return { note: note, sameBurst: Boolean(sameBurst) };
    }

    function synthesizeAnswer(query) {
      var q = String(query || "").trim();

      // 1. 优先命中刚记下的新记录
      var customHits = [];
      for (var i = 0; i < state.notes.length; i++) {
        var n = state.notes[i];
        if (n.seq >= 7) {
          var sc = scoreOverlap(q, n.content);
          if (sc >= 1.2) customHits.push({ note: n, score: sc });
        }
      }
      if (customHits.length > 0) {
        customHits.sort(function (a, b) {
          return b.score - a.score;
        });
        var top = customHits[0].note;
        var seqs = [top.seq];
        var extra = "";
        if (/膝|走|站|出门/.test(q + top.content)) {
          extra = "；结合你**右膝恢复期**，建议选电梯直达路线";
          seqs.push(4);
        }
        return {
          outcome: "answered",
          cues: ["刚记下的日常"],
          answer: "按你刚记下的：**" + top.content + "**" + extra + "。",
          clarifyQuestion: "",
          sourceSeqs: seqs
        };
      }

      // 2. 陌生代号追问闭环
      if (/阿白/.test(q)) {
        if (state.learnedAliases && state.learnedAliases["阿白"]) {
          var info = state.learnedAliases["阿白"];
          return {
            outcome: "answered",
            cues: ["已记住「阿白」"],
            answer: "按你补充的：**" + info.text + "**。以后再提「阿白」我都会直接关联。",
            clarifyQuestion: "",
            sourceSeqs: [info.seq]
          };
        }
        return {
          outcome: "clarify_asked",
          cues: [],
          answer: "",
          clarifyQuestion: "记录里还没提过「阿白」或这家店，方便补一句吗？记住后下次无需再解释。",
          unknownTerm: "阿白",
          sourceSeqs: []
        };
      }

      // 3. 预设场景精炼回答
      if (/周三|冰美式|看牙|齿|咖啡/.test(q)) {
        return {
          outcome: "answered",
          cues: ["周三 15:00 看牙", "近期忌冷饮"],
          answer:
            "**不建议约下周三下午，也不建议喝冰美式。**\n\n你约了 **15:00 瑞尔齿科复查**，时间冲突；且近期**牙齿怕冷饮**，改约周二或周五点温饮更稳妥。",
          clarifyQuestion: "",
          sourceSeqs: [3]
        };
      }

      if (/老地方|改方案|竹里|周末/.test(q)) {
        return {
          outcome: "answered",
          cues: ["老地方 = 竹里茶室", "右膝恢复期"],
          answer:
            "很合适。**软件园南门竹里茶室**靠窗座安静、有插座，且在一楼平层，对你**右膝恢复**也很友好。",
          clarifyQuestion: "",
          sourceSeqs: [1, 4]
        };
      }

      if (/陈总|深圳|福田|报价/.test(q)) {
        return {
          outcome: "answered",
          cues: ["福田站见陈总", "纸质报价单", "右膝少爬楼"],
          answer:
            "建议约在**福田高铁站直通层的茶室**——电梯直达照顾你**右膝恢复**，也方便他 **17:00 赶高铁去香港**。\n\n出门前带好**两份纸质报价单**。",
          clarifyQuestion: "",
          sourceSeqs: [6, 5, 4]
        };
      }

      if (/小满|疫苗|柯基/.test(q)) {
        return {
          outcome: "answered",
          cues: ["小满疫苗到期"],
          answer: "**小满**的狂犬疫苗**下月 10 号到期**，疫苗本放在**玄关抽屉**里，这周末可以提前约医院。",
          clarifyQuestion: "",
          sourceSeqs: [2]
        };
      }

      // 4. 通用词重叠匹配
      var scored = [];
      for (var k = 0; k < state.notes.length; k++) {
        var s = scoreOverlap(q, state.notes[k].content);
        if (s >= 1.2) scored.push({ note: state.notes[k], score: s });
      }
      if (scored.length > 0) {
        scored.sort(function (a, b) {
          return b.score - a.score;
        });
        var m = scored.slice(0, 2).map(function (x) {
          return x.note;
        });
        return {
          outcome: "answered",
          cues: ["关联过往记录"],
          answer: m
            .map(function (item) {
              return "• " + item.content + "（" + item.timeLabel + "）";
            })
            .join("\n\n"),
          clarifyQuestion: "",
          sourceSeqs: m.map(function (item) {
            return item.seq;
          })
        };
      }

      return {
        outcome: "clarify_asked",
        cues: [],
        answer: "",
        clarifyQuestion: "目前还没有相关记录，随手补一句背景？我会记住并为你解答。",
        unknownTerm: q.slice(0, 8),
        sourceSeqs: []
      };
    }

    // 只读预演：边输入问题边看会用到哪些记录，不写入状态
    function previewRecall(query) {
      var q = String(query || "").trim();
      if (q.length < 2) return [];
      var res = synthesizeAnswer(q);
      return res.outcome === "answered" ? res.sourceSeqs || [] : [];
    }

    function askQuestion(query) {
      var q = String(query || "").trim();
      if (!q) return null;
      var res = synthesizeAnswer(q);
      var thread = {
        id: "t-" + Date.now(),
        query: q,
        timeLabel: formatNow(),
        outcome: res.outcome,
        cues: res.cues || [],
        answer: res.answer || "",
        clarifyQuestion: res.clarifyQuestion || "",
        unknownTerm: res.unknownTerm || "",
        sourceSeqs: res.sourceSeqs || []
      };
      state.threads.unshift(thread);
      persist();
      return thread;
    }

    function clarifyThread(threadId, replyText) {
      var reply = String(replyText || "").trim();
      if (!reply) return null;
      var target = state.threads.find(function (t) {
        return t.id === threadId;
      });
      if (!target) return null;

      var cap = captureNote(reply);
      cap.note.status = "condensed";

      if (target.unknownTerm === "阿白" || /阿白/.test(target.query + reply)) {
        state.learnedAliases["阿白"] = { text: reply, seq: cap.note.seq };
        var pCard = state.realmCards.find(function (c) {
          return c.id === "people";
        });
        if (pCard) pCard.summary = "「阿白」：" + reply + "；「老地方」指竹里茶室。";
      }

      target.outcome = "answered";
      target.cues = ["已记住新语境"];
      target.answer = "已记住：**" + reply + "**。以后再提起无需重复解释。";
      target.clarifyQuestion = "";
      target.sourceSeqs = [cap.note.seq];
      persist();
      return target;
    }

    function resetDemo() {
      state = createInitialState();
      persist();
      return state;
    }

    return {
      suggestedAsks: SUGGESTED_ASKS,
      getState: function () {
        return state;
      },
      getNoteBySeq: getNoteBySeq,
      captureNote: captureNote,
      previewRecall: previewRecall,
      askQuestion: askQuestion,
      clarifyThread: clarifyThread,
      resetDemo: resetDemo
    };
  }

  global.ShijiStore = {
    create: createStore,
    suggestedAsks: SUGGESTED_ASKS,
    utils: { esc: esc, formatRichAnswer: formatRichAnswer }
  };
})(window);
