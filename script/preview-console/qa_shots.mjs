// 无头浏览器走查三套控制台：逐页截图 + 关键交互 + 收集前端报错。
//   node script/preview-console/qa_shots.mjs [playwright-core 目录]
import { createRequire } from "module";
import { mkdirSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const pwDir = process.argv[2] || "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core";
const { chromium } = require(pwDir);
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../images/console-preview");
mkdirSync(OUT, { recursive: true });

const PLANS = {
  3001: [
    ["home", []],
    ["arch", [['[data-go="arch"]'], ['[data-arch="loop"]']]],
    ["flow", [['[data-go="flow"]'], ['[data-flow-step="3"]']]],
    ["specs", [['[data-go="specs"]']]],
    ["spec-config", [['[data-go="specs"]'], ['tr[data-spec="search_answer"]'], ['[data-tab="config"]'], ['[data-stp="search_answer|max_turns|1"]'], ['[data-tgl="search_answer|tools|read_file"]']]],
    ["spec-diff", [['[data-save="search_answer"]']]],
    ["spec-boundary", [['[data-modal-ok]'], ['[data-tab="boundary"]']]],
    ["context", [['button[data-drawer-close]'], ['[data-go="context"]'], ['[data-ctx="search_answer|4"]']]],
    ["prompts", [['[data-go="prompts"]']]],
    ["models", [['[data-go="models"]']]],
    ["play", [['[data-go="play"]'], ['[data-play-run]']]],
  ],
  3002: [
    ["home", []],
    ["arch", [['[data-go="arch"]'], ['[data-arch="retriever"]']]],
    ["agents", [['[data-go="agents"]'], ['[data-pick="dream_archive"]']]],
    ["agents-config", [['[data-tab="config"]'], ['[data-stp="dream_archive|max_turns|-1"]']]],
    ["agents-boundary", [['[data-tab="boundary"]']]],
    ["context", [['[data-go="context"]'], ['[data-pick="dream_archive"]']]],
    ["context-skill", [['[data-ctxview="skill"]']]],
    ["models", [['[data-go="models"]']]],
    ["play", [['[data-go="play"]'], ['[data-play-op="dream"]'], ['[data-play-run]']]],
  ],
  3003: [
    ["home", []],
    ["arch", [['[data-go="arch"]']]],
    ["flow", [['[data-go="flow"]'], ['[data-flow="dream"]'], ['[data-flow-step="2"]']]],
    ["agent", [['a[data-agent="search"]']]],
    ["spec", [['a.sub[data-spec="search_cache_probe"]']]],
    ["spec-dirty", [['[data-stp="search_cache_probe|max_turns|1"]'], ['[data-anchor="s-config"]']]],
    ["skills", [['[data-go="skills"]']]],
    ["play", [['[data-go="play"]'], ['[data-sample="小黑什么时候打疫苗"]'], ['[data-play-run]']]],
  ],
  3004: [
    ["home", []],
    ["agents", [['[data-go="agents"]']]],
    ["specs", [['[data-go="specs"]']]],
    ["drawer-overview", [['tr[data-spec="search_answer"]']]],
    ["drawer-config", [['[data-tab="config"]'], ['[data-stp="search_answer|max_turns|1"]']]],
    ["drawer-prompt", [['[data-tab="prompt"]'], ['[data-ver-view="search_answer|v1"]']]],
    ["drawer-ver-modal", [['[data-ver-activate="search_answer|v1"]']]],
    ["drawer-ver-done", [['[data-modal-ok]']]],
    ["full", [['[data-full="search_answer"]']]],
    ["full-prompt", [['[data-ver-new="search_answer|v1"]'], ['[data-anchor="s-prompt"]']]],
    ["prompts", [['[data-ver-cancel="search_answer"]'], ['[data-go="prompts"]'], ['[data-prompt-spec="search_answer"]'], ['[data-ver-compare="search_answer|v2"]']]],
    ["context", [['[data-go="context"]'], ['[data-ctx="search_answer|0"]']]],
    ["play", [['[data-go="play"]'], ['[data-play-run]']]],
  ],
};

const browser = await chromium.launch();
let failed = 0;
for (const [port, plan] of Object.entries(PLANS)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  for (const [name, steps] of plan) {
    for (const [sel] of steps) {
      const el = page.locator(sel).first();
      if (!(await el.count())) { errors.push(`missing ${sel} @${name}`); continue; }
      try { await el.click({ timeout: 4000 }); } catch (e) { errors.push(`click ${sel} @${name}: ${e.message.split("\n")[0]}`); }
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${OUT}/${port}-${name}.png` });
  }
  console.log(port, errors.length ? `ERR ${JSON.stringify(errors)}` : "ok");
  failed += errors.length;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
