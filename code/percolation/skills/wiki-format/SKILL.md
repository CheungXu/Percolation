---
name: wiki-format
description: 主题页、多维标签、有类型双向链接、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。
---

# 记忆文件写法规范

索引程序按下面的格式确定性解析文件，所有数据库检索索引与拓扑图谱都从 Markdown 派生。不按格式写会导致多维召回或图谱缺失。

## 主题页 wiki/*.md

- 文件名保持扁平，只用英文小写、数字和横线，例如 `wiki/learning-sites.md`、`wiki/home-study-desk.md`。文件名只是稳定标识，不要用多层子目录表达分类。
- 文件开头必须有 frontmatter，包含 `title`、`type`、`aliases` 和页面级公共维度 `facets`：

```yaml
---
title: 常用学习网站与课程收藏
type: resource
aliases: [网课, 自学网站, 教程收藏]
facets:
  domain: [学习]
  form: [网站]
---
```

- `type` 从受控节点类型里选一个：`topic`（主题汇编，默认）、`entity`（物品/设备）、`person`（人物/宠物）、`project`（项目）、`resource`（网站/工具/资料）、`event`（日程/事件）。
- `aliases` 写用户以后可能用来模糊提问的叫法：上位概念、同义词、口头叫法、英文名。3~8 个即可。
- `facets` 写**整页恒定共有**的正交维度标签，维度键固定使用英文小写：
  - `domain`（主题域）：工作、学习、生活、健康、财务、数码、家庭、出行、娱乐（每页 1~2 个）
  - `form`（载体形态）：网站、工具软件、硬件外设、文档书籍、图片视频、账号凭据、线下地点、约定日程（仅当整页载体统一时写在 frontmatter，否则写在具体条目行内）
  - `status`（状态）：想法、待办、进行中、待购、在用、已完成、已放弃（**瞬时状态尽量标在具体条目行内**，不要给人物/宠物等长期档案页的 frontmatter 挂整页 `status`）
  - `topic`（细分话题）：限中观领域（每页最多 1~2 个，如 `命令行`、`宠物医疗`），优先复用词表已有词；**禁止把已在 `aliases` 里的具体商品名、型号、房间部件重复塞进 `topic`**
- 正文用 `## 小节` 分段，每个小节是一个独立的切片检索单元（小节级维度不会跨小节串扰）。小节内用列表，一条一个事实。
- 每条事实开头标确定性，结尾带原话锚点，中间可加**行内维度**与**事件日期**：
  - `- [confirmed] MIT Missing Semester 课程主页，周末刷前两讲 [form:网站] [topic:命令行] [status:进行中] [@2026-11-15] [#msg_42]`
  - `- [confirmed] CFORCE 15.6 寸 OLED 便携屏，目标价 999 元 [form:硬件外设] [status:待购] [#msg_12]`
  - `- [inferred] 可能配合 [[belongs_to::home-study-desk|书房改造]] 使用 [#msg_13] [#msg_15]`
- 行内标签规则：
  - 页面 frontmatter 里的 `facets` 会自动继承给页内所有带 `[#msg_N]` 的条目，行内只需补充该条目特有的维度（例如同一页既有网站又有书籍时，在行内标 `[form:网站]`、`[form:文档书籍]`）。
  - **行内 `[dim:val]` 只描述本条核心事实本身**：顺带提及的关联对象用 `[[uses::...]]` / `[[about::...]]` 链接表达即可，不要在 `[inferred]` 顺带推测行上贴其他领域的 `domain`/`form` 标签。
  - 原话里提到具体日期或相对时间（如“下周六”“下个月初”），按原话录入日期换算成公历，标为 `[@YYYY-MM-DD]` 或区间 `[@YYYY-MM-DD..YYYY-MM-DD]`。没有事件时间就不标。
  - 用户原话直接说明的写 `[confirmed]`；靠上下文推断的写 `[inferred]`。
- 关联页面用有类型双向链接：`[[rel::target|显示文本]]` 或 `[[rel::target]]`，例如：
  - `[[belongs_to::cs-self-study|计算机自学]]`（属于/上下位）
  - `[[part_of::home-study-desk|书房桌面的一部分]]`（组成部分）
  - `[[uses::anki-workflow]]`（使用/依赖）
  - `[[replaces::old-monitor]]`（替代）
  - `[[about::person-laozhang|老张]]`（涉及人物/项目）
  - 一般关联可直接写 `[[home-study-desk]]`（等同于 `related`）。链接目标写文件名（不带 `wiki/` 和 `.md`）。
- 状态变化时改写原条目并保留新旧锚点（如 `[status:待购]` 改为 `[status:在用]`），不要只追加一条矛盾的新条目。
- 新信息优先并入已有页面，同时用 `facets` 和行内 `[dim:val]` 标出不同维度视角，方便从主题、形态、状态、时间任意维度检索。不要写得比原话还长。

## 候选缓存区 MEMORY_CACHE/*.md

- 存固定但不常用的背景：人物称呼映射、个人暗语和缩写、历史项目代号、账号与环境参数、低频偏好。
- 按类别分文件，文件名英文，例如 `MEMORY_CACHE/people.md`、`MEMORY_CACHE/slang.md`。
- 用户特有的高频自定义维度词（如特定专业或业务线）可记在 `MEMORY_CACHE/facets.md`，格式：`- topic: 强化学习, 编译器`。
- 普通缓存文件一行一个条目，键在前：`- 老张：供应商张伟，负责显示器报价 [confirmed] [#msg_8]`。

## 热区 MEMORY.md

- 每次检索都会注入，硬上限 200 行。只放已确认、经常用到的核心背景和高频暗语。
- 禁止出现 `[inferred]` 条目。
- 格式与缓存区相同：`- 键：解释 [#msg_N]`，按类别用 `## 小节` 分组。
