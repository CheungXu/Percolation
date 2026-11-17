// 网页「编辑 / 删除」走查：桌面悬停改删、修订划线、撤销、检索里批量删除、问答的改了再问；手机长按。
// 不调用检索模型。先准备临时租户，本机调试服务用 AUTH_MODE=header：
//   node script/qa_web_edit.mjs --base http://127.0.0.1:8711/ --slug e2e-webedit-1
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

async function open(browser, viewport, mobile) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    extraHTTPHeaders: { "X-User-Slug": args.slug },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector('.note[data-note-seq="3"]');
  await page.waitForSelector(".qa");
  return { page, errors, context };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function desktop(browser) {
  const { page, errors, context } = await open(browser, { width: 1440, height: 900 }, false);
  const note = page.locator('.note[data-note-seq="3"]');
  await note.hover();
  await note.locator("[data-note-edit]").click();
  await page.waitForSelector(".note-edit");
  const hint = await page.locator(".edit-hint").innerText();
  check("编辑时提示已融入、且被引用", hint.includes("已融入") && hint.includes("1 个回答"), hint);
  check("空心圆点", await page.locator(".note.editing .note-dot").count());
  await shot(page, "edit-desktop-editing");
  await page.locator(".note-edit").fill("周四见陈总，带三份纸质报价单");
  await page.locator(".note-edit").press("Enter");
  await page.waitForSelector('.note[data-note-seq="3"] .note-rev');
  check("保存后正文换成新的", (await note.locator(".note-body").innerText()).includes("三份"));
  check("历史标记显示「已改」", (await note.locator(".note-rev").innerText()) === "已改");
  await note.locator("[data-rev]").click();
  await page.waitForSelector(".rev-row s");
  check("点「改」能看到划掉的上一版", (await page.locator(".rev-row s").innerText()).includes("两份"));
  await shot(page, "edit-desktop-revision");
  check("引用过它的回答标成依据已更新", (await page.locator(".cue.stale").count()) === 1);

  const wrap = page.locator(".q-wrap");
  await wrap.hover();
  await wrap.locator("[data-reask]").click();
  await page.waitForSelector(".reask-edit");
  check("改了再问在原问题处打开", (await page.locator(".reask-edit").inputValue()).includes("报价"));
  await page.locator(".reask-edit").press("Escape");
  check("Esc 取消改了再问", (await page.locator(".reask-edit").count()) === 0);

  await note.hover();
  await note.locator("[data-note-del]").click();
  await page.waitForSelector(".note.tomb [data-undo]");
  await shot(page, "edit-desktop-tomb");
  check("删除后原处是可撤销的虚线", (await page.locator(".note.tomb").innerText()).includes("撤销"));
  await page.locator(".note.tomb [data-undo]").click();
  await page.waitForSelector('.note[data-note-seq="3"] .note-body');
  check("撤销后原话回来且恢复依据已更新", (await note.locator(".note-body").innerText()).includes("三份") && (await page.locator(".cue.stale").count()) === 1);

  await page.keyboard.press("/");
  await page.locator("#find-in").fill("陈总");
  await page.waitForSelector(".find-list .note.hit");
  await page.locator('[data-act="find-pick"]').click();
  await page.locator(".find-list .note.hit").click();
  check("选择后出现删除", (await page.locator('[data-act="find-del"]').innerText()).includes("删除"));
  await shot(page, "edit-desktop-pick");
  await page.locator('[data-act="find-del"]').click();
  await page.waitForSelector(".find-list .note.tomb");
  await page.locator(".find-close").click();
  check("关掉搜索后仍能看到撤销", (await page.locator(".note.tomb [data-undo]").count()) >= 1);
  await page.locator(".note.tomb [data-undo]").click();
  await page.waitForFunction(() => !document.querySelector(".note.tomb"));
  check("关掉搜索后撤销也有效", (await note.locator(".note-body").innerText()).includes("三份"));

  await wrap.hover();
  await wrap.locator("[data-thread-del]").click();
  await page.waitForSelector(".qa.tomb [data-undo]");
  check("问答删除也在原处", (await page.locator(".qa.tomb").innerText()).includes("撤销"));
  await page.locator(".qa.tomb [data-undo]").click();
  await page.waitForSelector(".q-wrap");
  check("问答撤销后还在", (await page.locator(".q").first().innerText()).includes("报价"));

  const other = page.locator('.note[data-note-seq="1"]');
  await other.hover();
  await other.locator("[data-note-edit]").click();
  await page.locator(".note-edit").press("Escape");
  check("Esc 取消编辑，正文不变", (await other.locator(".note-body").innerText()).includes("猫粮") && (await page.locator(".note-edit").count()) === 0);

  check("桌面无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function mobile(browser) {
  const { page, errors, context } = await open(browser, { width: 390, height: 800 }, true);
  const note = page.locator('.note[data-note-seq="1"]');
  await note.scrollIntoViewIfNeeded();
  const body = note.locator(".note-body");
  const box = await body.boundingBox();
  await body.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    pointerType: "touch",
    clientX: box.x + 12,
    clientY: box.y + 8,
  });
  await page.waitForSelector(".hold-bar", { timeout: 2000 });
  await body.dispatchEvent("pointerup", { bubbles: true, button: 0, pointerType: "touch" });
  await body.dispatchEvent("click", { bubbles: true });
  await shot(page, "edit-mobile-hold");
  check("长按浮出编辑、复制、删除", (await page.locator(".hold-bar").innerText()).includes("编辑") && (await page.locator(".hold-bar").innerText()).includes("删除"));
  await page.locator(".hold-bar").getByText("复制").click();
  await page.waitForFunction(() => document.querySelector(".toast") && document.querySelector(".toast").textContent.includes("已复制"));
  check("复制有提示", true);
  await note.scrollIntoViewIfNeeded();
  const box2 = await body.boundingBox();
  await body.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    pointerType: "touch",
    clientX: box2.x + 12,
    clientY: box2.y + 8,
  });
  await page.waitForSelector(".hold-bar");
  await body.dispatchEvent("pointerup", { bubbles: true, button: 0, pointerType: "touch" });
  await body.dispatchEvent("click", { bubbles: true });
  await page.locator(".hold-bar").getByText("编辑").click();
  await page.waitForSelector(".note-edit");
  check("长按后的编辑是原地输入框", (await page.locator(".note-edit").inputValue()).includes("猫粮"));
  await page.locator(".note-edit").press("Escape");
  check("手机无报错", errors.length === 0, errors.join(" | "));
  await context.close();
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await mobile(browser);
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
