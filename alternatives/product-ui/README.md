# 拾记凝境 · 产品界面方案

## 背景与线上方案

拾记凝境是 Percolation 面向用户的产品：随手记下零碎日常，之后用一句话问，AI 结合记过的事作答。界面要让用户一眼明白「记录」和「询问」是同一件事的两面，并且两者能随时切换。

2026-11-15 选定 **方案 2「双境工作区」** 上线，地址 <https://stars-page.com/Percolation/>，代码在 `code/web/`（说明见 `code/web/README.md`）。

选它的原因：

- 只有它把「记录」和「询问」做成两个同时在场的工作区。桌面端光标在哪一侧，哪一侧舒展为主工作区（约 63%），另一侧退成仍可读的侧影；移动端两张卡片左右滑，非当前的一张露出边签。用户能直接感到「边记边问」。
- 两侧之间有可见的联系：记下的一句化作光点流入询问侧；输入问题时，记录侧实时亮起会被用到的记录；回答下的依据标签能定位原话。这正好表达了产品核心「零碎记录 → 懂你境况的回答」。
- 其余四套都是单栏或单框，记录与询问共用一个入口，切换靠模式按钮，两者的关系要靠文字解释。

本目录的 `nordic/` 是方案 2 接后端之前的离线原型（假数据），留作和其余方案并排对比；正式版之后的改动不回写到这里。

## 备选方案

截图在 `images/product-preview/`，五套共用 `shared/store.js` 的假数据与模拟作答。

| 方案 | 端口 / 目录 | 做法 | 优点 | 没选的原因 |
| --- | --- | --- | --- | --- |
| 1 宋韵留白 | `3011` · `ink/` | 宣纸暖白、远山修竹水墨、宋体与朱砂印；单张素笺卡片里用「拾记 / 寻问」页签切换，手札与境况放在书眉 | 品牌辨识度最高，适合做中国风活动页或节日皮肤 | 记录与询问共用一个输入框，「同时在场」的感觉弱；装饰元素多，移动端信息密度低 |
| 3 极夜聚光 | `3013` · `editorial/` | 暗色背景、居中发光单框，同一个框里 Enter 记录、⌘+Enter 询问，下方一张聚焦洞察卡 | 最简洁，夜间使用舒适，适合做深色模式 | 两种动作靠快捷键区分，新用户不容易发现；最近记录和境况收进顶栏，平时看不见 |
| 4 博朗网格 | `3014` · `zen/` | 浅石底、1.5px 黑线几何分格、唯一的信号橙按钮；左上记录、左下最近记录、右侧大留白解答与置底询问栏 | 信息架构最清楚，适合偏工具型的桌面用户 | 固定分格在移动端只能退化成长页面；整体偏冷，与「懂你」的温度不符 |
| 5 晨雾对话流 | `3015` · `stream/` | 薰衣草与樱粉的弥散渐变，单列对话流里随手记气泡与 AI 回复交织，底部悬浮胶囊输入框带「记录 / 询问」两个按钮 | 最像聊天应用，上手成本最低，移动端天然友好 | 记录被淹没在问答里，翻找原话不方便；和通用聊天机器人难以区分 |

截图：

- 方案 1：`images/product-preview/3011-ink-v3.png`
- 方案 2 原型：`images/product-preview/3012-nordic-v4-*.png`、`3012-nordic-m-*.png`；正式版：`images/product-web/`
- 方案 3：`images/product-preview/3013-dark-v3.png`
- 方案 4：`images/product-preview/3014-braun-v3.png`
- 方案 5：`images/product-preview/3015-stream-v3.png`

更早的迭代截图（`*-home.png`、`*-v2.png` 等）也在同一目录，演进过程见 `doc/20261115/shijiningjing-product-ui-five-designs.md`。

## 代码在哪

| 路径 | 内容 |
| --- | --- |
| `ink/` `nordic/` `editorial/` `zen/` `stream/` | 五套界面，各自一份 `index.html` + `styles.css` + `app.js`，原生 JS、无构建 |
| `shared/store.js` | 共用的假数据、模拟作答（关键词匹配）、`localStorage` 持久化 |
| `hub/index.html` | 总览页，第一项链到线上正式版 |
| `serve.py` | 单进程起 5 个端口（3011..3015），`/shared/` 和 `/_hub` 做了路径映射 |
| `qa_shots.mjs` | Playwright 走查五套界面并截图到 `images/product-preview/` |

主线（`code/web/`）不保留备选方案的切换开关。

## 怎么复现

服务器上常驻（`config/systemd/percolation-ui-previews.service`），经 Nginx `config/nginx/ningjing-previews.conf` 挂在 IP 直连下：

- 总览：<http://8.138.118.232/ningjing/>
- 各方案：`http://8.138.118.232/ningjing/{ink,nordic,editorial,zen,stream}/`

本地或重新部署：

```bash
python3 alternatives/product-ui/serve.py              # 3011..3015
python3 alternatives/product-ui/serve.py --ports 3013 # 只起一个
node alternatives/product-ui/qa_shots.mjs             # 走查并重新截图（需要 IP 直连地址可访问）
```

假数据存在浏览器 `localStorage`（键名 `shiji_ningjing_v3_*`），各方案右上角的重置按钮可恢复初始演示数据。

## AB 测试建议

如果要把某个备选方案接上真实后端做对比，`code/web/app.js` 的数据层（`api()`、`loadAll()`、`doCap()`、`runAsk()`、`doClarify()`）可以直接复用，换掉外壳与渲染函数即可；接口说明见 `code/percolation/README.md`。

建议比较的指标（目前前端还没有埋点，需要先补）：

- 首次进入后 1 分钟内的首条记录率、首次询问率。
- 次日留存与 7 日内记录条数。
- 每次询问前的记录条数、追问后补一句的比例。
- 移动端两个工作区的切换次数（双境独有）。

## 状态

- 2026-11-15：方案 2 正式版上线；方案 1、3、4、5 存档于本目录，暂无 AB 计划。方案 3 可作为正式版深色模式的参考，方案 1 可作为节日 / 活动皮肤的参考。
