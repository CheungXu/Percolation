// 网页「在记录里找」走查：桌面与移动端，截图到 images/product-web/find-*.png 并断言。
// 先用 script/seed_web_find.py 准备临时租户，本机调试服务用 AUTH_MODE=header：
//   node script/qa_web_find.mjs --base http://127.0.0.1:8711/ --slug e2e-webfind-1
import { createRequire } from "module";
import { mkdirSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, [])
);
const BASE = args.base || "http://127.0.0.1:8711/";
const PW = args.playwright || "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../images/product-web");
const { chromium } = require(PW);
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push([name, !!ok]);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? "  " + String(detail).slice(0, 200) : ""}`);
}

async function open(browser, viewport, mobile) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    extraHTTPHeaders: { "X-User-Slug": args.slug },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".panel-left .note[data-note-seq]");
  return { page, errors, context };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const hits = (page) => page.locator(".find-list .note.hit").count();

async function desktop(browser) {
  const { page, errors, context } = await open(browser, { width: 1440, height: 900 }, false);
  await page.locator("#cap-meta").hover();
  await page.waitForTimeout(250);
  await shot(page, "find-desktop-entry");

  await page.keyboard.press("/");
  check("「/」在空的记录框里打开搜索", await page.locator(".panel-left.finding").count(), "");
  await page.evaluate(() => {
    const i = document.getElementById("find-in");
    i.value = "chenzong";
    i.dispatchEvent(new InputEvent("input", { isComposing: true }));
  });
  await page.waitForTimeout(300);
  check("组字中不发起搜索", !(await page.locator(".panel-left.find-busy").count()) && !(await page.locator(".find-empty").count()));
  await page.evaluate(() => (document.getElementById("find-in").value = ""));
  await page.keyboard.type("陈总");
  await page.waitForSelector(".find-list .note.hit");
  await page.waitForTimeout(450);
  const n = await hits(page);
  check("命中 7 条", n === 7, n);
  check("折痕出现", (await page.locator(".fold").count()) >= 5);
  check("计数显示 7 条", (await page.locator(".find-count").innerText()) === "7 条");
  check("关键词高亮", (await page.locator(".find-list mark").count()) >= 7);
  await shot(page, "find-desktop-results");

  const fold = page.locator(".fold").nth(2);
  const label = await fold.innerText();
  await fold.click();
  await page.waitForFunction(() => document.querySelectorAll(".find-list .note.ctx").length > 0);
  await page.waitForTimeout(400);
  check("展开折痕出现上下文", (await page.locator(".find-list .note.ctx").count()) > 0, label);
  await page.locator(".find-list .note.hit").nth(4).hover();
  await page.waitForTimeout(200);
  await shot(page, "find-desktop-expanded");

  await page.locator("#find-in").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  check("方向键移动当前命中", (await page.locator(".find-count").innerText()) === "6 / 7");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("Enter 收起搜索并定位", !(await page.locator(".panel-left.finding").count()) && (await page.locator(".note.highlight").count()) === 1);
  await page.waitForTimeout(500);
  await shot(page, "find-desktop-located");

  await page.locator("#cap-meta").click();
  check("再次打开带回上次的词", (await page.locator("#find-in").inputValue()) === "陈总");
  await page.locator("#find-in").fill("去年的滑雪票");
  await page.waitForSelector(".find-empty");
  await page.waitForTimeout(300);
  await shot(page, "find-desktop-empty");
  await page.locator(".find-empty [data-find-ask]").click();
  await page.waitForTimeout(700);
  check("搜不到时转去询问", (await page.locator("#ask-in").inputValue()) === "去年的滑雪票" && (await page.locator(".app.mode-ask").count()) === 1);
  await page.locator("#ask-in").fill("");
  check("桌面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function mobile(browser, width, tag) {
  const { page, errors, context } = await open(browser, { width, height: 800 }, true);
  const send = page.locator(".panel-left .send");
  check(`${tag} 记录框空着时发送键是找记录`, (await send.getAttribute("aria-label")) === "在记录里找");
  await page.locator("#cap-in").fill("写");
  check(`${tag} 写了字变回记下`, (await send.getAttribute("aria-label")) === "记下");
  await page.locator('.ws-title[data-go="cap"]').tap();
  check(`${tag} 有字时再点「记录」也能打开搜索`, (await page.locator(".panel-left.finding").count()) === 1);
  await page.locator(".find-close").tap();
  await page.locator("#cap-in").fill("");
  await page.locator("#cap-in").dispatchEvent("input");
  await page.locator("#cap-in").blur();
  await page.waitForTimeout(350);
  await shot(page, `find-${tag}-entry`);
  await send.tap();
  await page.locator("#find-in").fill("报价");
  await page.waitForSelector(".find-list .note.hit");
  await page.waitForTimeout(450);
  await shot(page, `find-${tag}-results`);
  await page.locator(".find-list .note.hit").last().tap();
  await page.waitForTimeout(400);
  check(`${tag} 点命中定位`, !(await page.locator(".panel-left.finding").count()) && (await page.locator(".note.highlight").count()) === 1);
  check(`${tag} 无报错`, errors.length === 0, errors.join(" | "));
  await context.close();
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await mobile(browser, 390, "mobile");
  await mobile(browser, 360, "mobile360");
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
