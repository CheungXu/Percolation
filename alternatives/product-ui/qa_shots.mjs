// 无头浏览器走查「拾记凝境」第三轮极简主义重塑版（v3）
import { createRequire } from "module";
import { mkdirSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const pwDir = process.argv[2] || "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core";
const { chromium } = require(pwDir);

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../images/product-preview");
mkdirSync(OUT, { recursive: true });

async function verifyAll() {
  const browser = await chromium.launch();
  let totalErrors = 0;

  // 1. ink
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/ink/", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/3011-ink-v3.png` });

    await page.fill("#ink-input", "明早九点寄两盒正山小种");
    await page.click('[data-act="submit"]');
    await page.click('[data-mode="ask"]');
    await page.fill("#ink-input", "明早要寄什么？");
    await page.click('[data-act="submit"]');
    await page.click('[data-tab="realm"]');
    await page.click('[data-act="reset"]');
    console.log("3011 ink:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await page.close();
  }

  // 2. nordic 桌面（光标所在侧伸展为主工作区）
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/nordic/", { waitUntil: "networkidle" });
    await page.click('[data-act="reset"]');
    await page.waitForTimeout(700);
    const widths = () =>
      page.$$eval(".panel", (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    let [l, r] = await widths();
    if (!(l > r * 1.4)) errs.push(`记录聚焦时左侧未伸展 ${l}/${r}`);
    await page.screenshot({ path: `${OUT}/3012-nordic-v4-cap.png` });

    await page.click("#ask-in");
    await page.waitForTimeout(800);
    [l, r] = await widths();
    if (!(r > l * 1.4)) errs.push(`询问聚焦时右侧未伸展 ${l}/${r}`);
    await page.screenshot({ path: `${OUT}/3012-nordic-v4-ask.png` });

    await page.type("#ask-in", "周四见陈总", { delay: 30 });
    await page.waitForTimeout(400);
    const recall = await page.$$eval(".note.recall", (els) => els.length);
    if (!recall) errs.push("边问边浮现未亮起相关记录");
    await page.screenshot({ path: `${OUT}/3012-nordic-v4-recall.png` });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    await page.keyboard.press("Tab");
    await page.waitForTimeout(800);
    [l, r] = await widths();
    if (!(l > r * 1.4)) errs.push(`Tab 未切回记录 ${l}/${r}`);
    await page.type("#cap-in", "周五晚上七点北站接爸妈");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(430);
    await page.screenshot({ path: `${OUT}/3012-nordic-v4-orb.png` });
    await page.waitForTimeout(700);
    await page.click('[data-act="reset"]');
    console.log("3012 nordic:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await page.close();
  }

  // 2b. nordic 移动端（工作区卡片 + 边缘露出 + 滑动切换）
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/nordic/", { waitUntil: "networkidle" });
    await page.click('[data-act="reset"]');
    await page.waitForTimeout(300);
    const pager = () =>
      page.$eval(".split", (el) => ({ left: Math.round(el.scrollLeft), max: el.scrollWidth - el.clientWidth }));
    await page.screenshot({ path: `${OUT}/3012-nordic-m-cap.png` });

    await page.fill("#cap-in", "周五晚上七点北站接爸妈");
    await page.click('[data-act="send-cap"]');
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/3012-nordic-m-orb.png` });
    await page.waitForTimeout(700);

    // 滑到一半的过渡态
    await page.$eval(".split", (el) => {
      el.style.scrollSnapType = "none";
      el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.45;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/3012-nordic-m-mid.png` });
    await page.$eval(".split", (el) => {
      el.scrollLeft = 0;
      el.style.scrollSnapType = "";
    });
    await page.waitForTimeout(200);

    await page.click(".panel-right .peek");
    await page.waitForTimeout(700);
    let pg = await pager();
    if (Math.abs(pg.left - pg.max) > 2) errs.push(`点边签未切到询问 ${pg.left}/${pg.max}`);
    if (!(await page.$eval(".app", (el) => el.className.includes("mode-ask")))) errs.push("模式未切到询问");
    await page.screenshot({ path: `${OUT}/3012-nordic-m-ask.png` });

    await page.type("#ask-in", "周四见陈总", { delay: 30 });
    await page.waitForTimeout(400);
    const badge = await page.$eval(".panel-left .peek-badge", (el) => el.textContent);
    if (!badge) errs.push("记录边签未显示相关条数");
    await page.screenshot({ path: `${OUT}/3012-nordic-m-recall.png` });
    await page.click('[data-act="send-ask"]');
    await page.waitForTimeout(500);

    await page.click('[data-act="toggle-ctx"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/3012-nordic-m-ctx.png` });
    await page.click(".ctx-backdrop", { position: { x: 20, y: 120 } });

    const cues = await page.$$(".cue");
    if (cues.length) {
      await cues[cues.length - 1].click();
      await page.waitForTimeout(700);
      pg = await pager();
      if (pg.left !== 0) errs.push(`点引用后未回到记录 scrollLeft=${pg.left}`);
      await page.screenshot({ path: `${OUT}/3012-nordic-m-cue.png` });
    }
    await page.click('[data-act="reset"]');
    console.log("3012 nordic mobile:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await ctx.close();
  }

  // 3. editorial (minimalist dark spotlight)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/editorial/", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/3013-dark-v3.png` });

    await page.fill("#spot-in", "周报改成周五下午四点发");
    await page.click('[data-act="cap"]');
    await page.click('[data-preset*="老地方"]');
    await page.click('[data-act="reset"]');
    console.log("3013 dark:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await page.close();
  }

  // 4. zen (Dieter Rams Braun Swiss grid)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/zen/", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/3014-braun-v3.png` });

    await page.fill("#b-cap", "备用钥匙在书房笔筒里");
    await page.click('[data-act="cap"]');
    await page.click('[data-preset*="冰美式"]');
    await page.click('[data-act="reset"]');
    console.log("3014 braun:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await page.close();
  }

  // 5. stream (Minimalist aurora stream)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1/ningjing/stream/", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/3015-stream-v3.png` });

    await page.fill("#s-in", "月底去换新护照");
    await page.click('[data-act="cap"]');
    await page.click('[data-preset*="阿白"]');
    await page.fill("[data-c-in]", "大学室友白宇，推荐了潮汕菜");
    await page.click("[data-c-btn]");
    await page.click('[data-act="reset"]');
    console.log("3015 stream:", errs.length ? `ERR ${JSON.stringify(errs)}` : "OK");
    totalErrors += errs.length;
    await page.close();
  }

  await browser.close();
  process.exit(totalErrors ? 1 : 0);
}

verifyAll();
