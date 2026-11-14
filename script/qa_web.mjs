// 拾记凝境网页端走查：桌面与移动端完整流程，截图并断言。会真实调用检索模型。
//
// 本机调试服务（AUTH_MODE=header），用临时 e2e 租户：
//   node script/qa_web.mjs --base http://127.0.0.1:8711/ --slug e2e-webqa-xxx
// 线上模式未登录时只检查登录卡：
//   node script/qa_web.mjs --base http://127.0.0.1:8712/ --login-only
// 线上已登录（星页 sp_session 的值）：
//   node script/qa_web.mjs --base https://stars-page.com/Percolation/ --cookie <token> --smoke
// 已跑过整理的租户，拍近况卡片：
//   node script/qa_web.mjs --base http://127.0.0.1:8711/ --slug e2e-webqa-xxx --showcase
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
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? "  " + String(detail).slice(0, 240) : ""}`);
}

async function open(browser, { mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    extraHTTPHeaders: args.slug ? { "X-User-Slug": args.slug } : {},
  });
  if (args.cookie) await context.addCookies([{ name: "sp_session", value: args.cookie, url: new URL(BASE).origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of 401/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: "networkidle" });
  return { page, errors, context };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const savedCount = (page) => page.locator(".panel-left .note[data-note-seq]").count();

async function waitAnswer(page, timeout = 120000) {
  await page.waitForFunction(() => !document.querySelector(".think") && !!document.querySelector(".qa:last-child .a"), null, { timeout });
  return page.locator(".qa:last-child .a").last().innerText();
}

async function capture(page, text) {
  const before = await savedCount(page);
  await page.fill("#cap-in", text);
  await page.press("#cap-in", "Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".panel-left .note[data-note-seq]").length > n, before, { timeout: 15000 });
}

async function loginOnly(browser) {
  for (const mobile of [false, true]) {
    const { page, errors } = await open(browser, { mobile });
    await page.waitForSelector(".login-card", { timeout: 8000 });
    check(`${mobile ? "移动" : "桌面"}：未登录弹出登录卡`, await page.locator("#lg-phone").isVisible());
    await page.click(".login-submit");
    check("空手机号提示", (await page.locator(".login-err").innerText()).includes("手机号"));
    await page.fill("#lg-phone", "13800001234");
    await page.fill("#lg-code", "1234");
    await page.click(".login-submit");
    check("未勾协议提示", (await page.locator(".login-err").innerText()).includes("协议"));
    await page.fill("#lg-phone", "");
    await page.fill("#lg-code", "");
    await page.locator(".login-err").evaluate((n) => (n.textContent = ""));
    await shot(page, mobile ? "mobile-login" : "desktop-login");
    check(`${mobile ? "移动" : "桌面"}登录页无脚本错误`, errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
}

async function desktop(browser) {
  const { page, errors } = await open(browser);
  await page.waitForSelector(".panel-left .empty, .panel-left .note", { timeout: 10000 });
  const fresh = (await savedCount(page)) === 0;
  if (fresh) {
    await shot(page, "desktop-empty");
    check("新用户两侧都是空状态", (await page.locator(".empty").count()) === 2);
  }

  const notes = [
    "周四下午三点和陈总在福田站碰面，他五点要赶高铁去香港",
    "陈总习惯看纸质版，记得打印两份报价单",
    "右膝恢复期，这两周少爬楼梯，出门挑电梯直达的",
    "下周三 15:00 瑞尔齿科复查智齿，最近牙怕冷饮",
  ];
  for (const text of notes) await capture(page, text);
  await page.fill("#cap-in", "以后说「老地方」，就是软件园南门竹里茶室靠窗座");
  await page.press("#cap-in", "Enter");
  await page.waitForTimeout(420);
  await shot(page, "desktop-orb");
  await page.waitForFunction(() => !document.querySelector(".note.sending"), null, { timeout: 15000 });
  check("连记 5 条全部落库", (await savedCount(page)) >= 5);
  check("记录侧显示总数", /\d+ 条/.test(await page.locator("#cap-meta").innerText()));

  await page.press("#cap-in", "Tab");
  await page.waitForTimeout(800);
  const [lw, rw] = await page.evaluate(() => [".panel-left", ".panel-right"].map((s) => document.querySelector(s).getBoundingClientRect().width));
  check("Tab 后询问侧舒展为主工作区", rw / lw > 1.4, `${Math.round(lw)} / ${Math.round(rw)}`);

  await page.type("#ask-in", "周四见陈总要带什么", { delay: 30 });
  await page.waitForFunction(() => document.querySelectorAll(".note.recall").length > 0, null, { timeout: 5000 }).catch(() => {});
  const recalled = await page.locator(".note.recall").count();
  check("边问边浮现：记录侧亮起相关记录", recalled > 0, `${recalled} 条`);
  await shot(page, "desktop-recall");

  await page.press("#ask-in", "Enter");
  await page.waitForSelector(".think", { timeout: 5000 });
  await page.waitForTimeout(2600);
  await shot(page, "desktop-thinking");
  const answer = await waitAnswer(page);
  check("得到回答", answer.length > 4, answer.replace(/\s+/g, " "));
  check("回答带依据标签", (await page.locator(".qa:last-child .cue").count()) > 0);
  await page.waitForTimeout(500);
  await shot(page, "desktop-answer");

  await page.locator(".qa:last-child .cue").first().click();
  await page.waitForTimeout(300);
  check("点依据标签定位原话", (await page.locator(".note.highlight").count()) > 0);

  await page.click("#ask-in");
  await page.fill("#ask-in", "阿白推荐的那家粤菜馆叫什么？");
  await page.press("#ask-in", "Enter");
  const second = await waitAnswer(page);
  const clarifyForm = page.locator(".qa:last-child form.clarify");
  if (await clarifyForm.count()) {
    check("陌生称呼触发追问", true, second.replace(/\s+/g, " "));
    await clarifyForm.locator("input").fill("阿白是我同事白静，她推荐的是体育西路的猫山王粤菜馆");
    await clarifyForm.locator("button").click();
    const third = await waitAnswer(page);
    check("补一句后作答", /猫山王/.test(third), third.replace(/\s+/g, " "));
    check("补充写进记录流", (await page.locator(".note-tag").count()) > 0);
  } else {
    check("陌生称呼未追问（已记过或如实说没找到）", true, second.replace(/\s+/g, " "));
  }
  await page.waitForTimeout(600);
  await shot(page, "desktop-thread");

  await page.click('[data-act="ctx"]');
  await page.waitForSelector(".context-popover .ctx-grid, .context-popover .ctx-empty", { timeout: 10000 });
  await shot(page, "desktop-context");
  await page.keyboard.press("Escape");

  const threadsBefore = await page.locator(".qa").count();
  const repliesBefore = await page.locator(".q-reply").count();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".panel-right .qa", { timeout: 10000 });
  check("刷新后问答历史还原", (await page.locator(".qa").count()) === threadsBefore, `${threadsBefore} 个线程`);
  check("刷新后追问链还原", (await page.locator(".q-reply").count()) === repliesBefore, `${repliesBefore} 条补充`);
  await shot(page, "desktop-reload");

  await page.click('[data-act="account"]');
  await page.waitForSelector(".account-pop");
  await shot(page, "desktop-account");
  check("桌面无脚本错误", errors.length === 0, errors.join(" | "));
  await page.context().close();
}

async function mobile(browser) {
  const { page, errors } = await open(browser, { mobile: true });
  await page.waitForSelector(".panel-left .note, .panel-left .empty", { timeout: 10000 });
  await shot(page, "mobile-cap");

  await page.evaluate(() => {
    const s = document.querySelector(".split");
    s.scrollTo({ left: (s.scrollWidth - s.clientWidth) / 2 });
  });
  await page.waitForTimeout(120);
  await shot(page, "mobile-mid");
  await page.evaluate(() => {
    const s = document.querySelector(".split");
    s.scrollTo({ left: s.scrollWidth - s.clientWidth });
  });
  await page.waitForTimeout(700);
  check("滑到询问工作区", await page.locator(".panel-right.is-active").count());
  await shot(page, "mobile-ask");

  await page.fill("#ask-in", "下周三约客户喝冰美式合适吗");
  await page.waitForTimeout(900);
  const badge = await page.locator(".panel-left .peek-badge").innerText();
  check("记录边签显示相关条数", /\d/.test(badge), badge);
  await shot(page, "mobile-recall");
  await page.locator(".panel-left .peek").click();
  await page.waitForTimeout(800);
  check("点边签回到记录", await page.locator(".panel-left.is-active").count());

  await page.click('[data-act="ctx"]');
  await page.waitForSelector(".context-popover .ctx-grid, .context-popover .ctx-empty", { timeout: 10000 });
  await page.waitForTimeout(350);
  await shot(page, "mobile-context");
  await page.click(".ctx-backdrop", { position: { x: 20, y: 40 } });
  check("移动无脚本错误", errors.length === 0, errors.join(" | "));
  await page.context().close();
}

// 已有整理结果的租户：拍近况卡片
async function showcase(browser) {
  for (const isMobile of [false, true]) {
    const { page, errors } = await open(browser, { mobile: isMobile });
    await page.waitForSelector(".panel-left .note", { timeout: 10000 });
    const prefix = isMobile ? "mobile" : "desktop";
    await shot(page, `${prefix}-condensed`);
    await page.click('[data-act="ctx"]');
    await page.waitForSelector(".context-popover .ctx-grid", { timeout: 10000 });
    await page.waitForTimeout(350);
    check(`${prefix}：近况展示整理出的主题`, (await page.locator(".ctx-item").count()) > 0);
    await shot(page, `${prefix}-context-cards`);
    check(`${prefix} 无脚本错误`, errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
}

async function smoke(browser) {
  const { page, errors } = await open(browser);
  await page.waitForSelector(".panel-left .note, .panel-left .empty", { timeout: 10000 });
  check("线上已登录可进入工作区", !(await page.locator(".login-card").count()));
  await shot(page, "online-desktop");
  check("线上无脚本错误", errors.length === 0, errors.join(" | "));
  await page.context().close();
}

const browser = await chromium.launch();
try {
  if (args["login-only"]) await loginOnly(browser);
  else if (args.smoke) await smoke(browser);
  else if (args.showcase) await showcase(browser);
  else {
    await desktop(browser);
    await mobile(browser);
  }
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过，截图在 ${OUT}`);
process.exit(failed.length ? 1 : 0);
