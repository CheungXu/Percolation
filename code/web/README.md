# web · 拾记凝境网页端

线上地址 <https://stars-page.com/Percolation/>。原生 HTML/CSS/JS，无构建步骤，由 `percolation.api` 同一个进程托管（`GET /` 渲染 `index.html`，其余文件走静态挂载）。界面是「双境工作区」：记录与询问两个工作区，桌面端焦点所在一侧舒展，移动端左右滑切换。设计取舍见 `alternatives/product-ui/README.md`，通用做法见 `wiki/dual-workspace-ui-patterns.md`。

## 文件

| 文件 | 内容 |
| --- | --- |
| `index.html` | 外壳。资源地址带 `?v={{v}}`，后端按 `styles.css`、`app.js` 的修改时间替换，改完静态文件刷新即生效，不用重启 |
| `app.js` | 全部逻辑，一个 IIFE，分区：工具 → 接口 → 外壳 → 记录流 → 问答流 → 浮层 → 登录 → 工作区切换 → 输入 → 记录/询问动作 → 边问边浮现 → 事件 → 启动 |
| `styles.css` | 设计变量在 `:root`；`@media (min-width: 721px)` 是桌面伸缩，`@media (max-width: 720px)` 是移动卡片栈 |
| `favicon.svg` | 品牌标 |

## 路径约定

线上经 Nginx 去掉 `/Percolation` 前缀转到 `127.0.0.1:8710`，所以网页里一律用**相对路径**：

- 本产品接口：`v1/session`、`v1/notes` …（解析为 `/Percolation/v1/...`）。
- 星页登录接口：`/api/auth/sms/send`、`/api/auth/sms/login`、`/api/auth/logout`（绝对路径，同域直达星页）。

本机调试直接开 `http://127.0.0.1:8710/` 也能用同一份代码。

## 数据流

启动：`GET v1/session` → 未登录弹登录卡；已登录并行拉 `v1/notes?limit=80` 和 `v1/threads?limit=20`。

| 动作 | 前端 | 接口 |
| --- | --- | --- |
| 记一句 | 先插一条「发送中」记录并放光点动画，成功后换成服务端序号；失败标红可重试 | `POST v1/capture` |
| 输入问题 | 停顿 260ms 后查一次，记录侧亮起相关条目（手机端在记录边签显示条数）；新请求会中止旧请求 | `GET v1/recall?q=` |
| 发问 | 先插入问题和「思考中」（文案按耗时切换：翻看你的记录 → 核对原话 → 组织回答）；回答到后闪烁依据原话 | `POST v1/search` |
| 补一句（追问） | 回答为 `clarify_asked` 时在线程里出现输入框；提交后补充写进记录流，线程追加重查结果 | `POST v1/clarify` |
| 依据标签 | 定位并高亮原话；原话不在已加载范围时自动向前翻页 | `GET v1/notes?before_seq=` |
| 找记录 | 入口：桌面点记录标题栏的条数或按 `/`（焦点不在输入框，或记录框为空）；手机上记录框空着时发送键是放大镜，已在记录页时再点顶栏「记录」也能打开。输入法组字期间不发请求。结果是「折叠的时间线」：命中按时间排开，中间没命中的收成「N 条」折痕，点开取两侧各 3 条上下文；`↑↓` 选、`Enter` 或点击定位到原处（收起搜索后高亮）；搜不到时一键转去询问。重新打开带回上次的词 | `GET v1/notes/search?q=`、`GET v1/notes/between` |
| 向上滚动 | 记录流 / 问答流滚到顶部附近时加载更早的 | `v1/notes?before_seq=`、`v1/threads?before_id=` |
| 我的近况 | 浮层（手机为底部抽屉），30 秒内复用缓存；空时提示「每晚凝练」 | `GET v1/context` |
| 退出登录 | 先清后端身份缓存，再退出星页登录 | `POST v1/session/forget`、`POST /api/auth/logout` |

线程数据结构与接口一致：`{id, query, at, steps: [{search_id, outcome, answer, clarify_question, seqs, cues, reply}]}`，`steps` 依次是第一问和每次澄清后的重查，`reply` 是用户对这一步追问的补充。前端另加 `key`（本地生成、提交前后不变）、`pending`、`error`。

## 渲染约定

- **外壳只挂载一次**（`mount()`），之后按区域局部重绘：`paintNotes()`、`paintThreads()`、`paintMenu()`。异步结果回来时不会重建两个主输入框，避免打断正在组字的输入法。
- 重绘问答流时会保存并恢复追问输入框的内容（`ui.clarifyDrafts`）和光标位置。
- 「贴底」判断：重绘前离底部不到 40px 就重绘后滚到底；加载更早内容时保持与底部的距离（`keepOffset`）。
- 工作区切换不重绘，只切类名；移动端由横向滚动进度 `--p` 驱动全部过渡。
- 找记录打开且有词时，`paintNotes()` 画搜索结果（`ui.find.items`）而不是记录流；记一句、点依据标签会先收起搜索。新结果回来前保留旧结果，不闪。展开折痕时用 `anchor` 让相邻命中停在原位。
- 两个主输入框的草稿存 `localStorage`（`pc_draft_cap` / `pc_draft_ask`），退出登录时清掉。

## 本机调试与走查

```bash
cd code
AUTH_MODE=header .venv/bin/uvicorn percolation.api:app --host 127.0.0.1 --port 8711   # 用 X-User-Slug 选租户
node ../script/qa_web.mjs --base http://127.0.0.1:8711/ --slug <e2e- 开头的临时租户>
```

找记录单独走查：`script/seed_web_find.py --slug e2e-webfind-1` 建一个带近两周 38 条原话的临时租户，`node script/qa_web_find.mjs --slug e2e-webfind-1` 跑桌面 + 手机（390 / 360 宽）共 19 项断言，截图 `images/product-web/find-*.png`，完了 `seed_web_find.py --slug ... --drop` 清理。

`qa_web.mjs` 的几种模式（完整流程、`--login-only`、`--showcase`、`--smoke`）见脚本开头注释，截图输出到 `images/product-web/`。完整流程会真实调用检索模型。临时租户的建立与清理见 `code/percolation/README.md`。

## 已知限制

- 前端没有埋点；AB 对比需要先补（建议指标见 `alternatives/product-ui/README.md`）。
- 询问是一次性返回，没有流式输出；慢的时候靠思考文案过渡（Nginx 读超时 180 秒）。
- 找记录：字面命中最多列最近 200 条，更早的折进「更早 N 条」，展开后不再标为命中；每次查询全表扫原话，记录上万条后需要加索引。定位比已加载早 20 页以上的记录会提示失败。
- 还没有删除 / 编辑记录的入口：原话表只追加，要配合修订表和夜间整理一起做，方案见 `doc/20261117/history-search-edit-delete-design.md`。
