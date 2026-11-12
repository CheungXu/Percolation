# 工具权限矩阵、System Prompt 与 Skill 规范手册

本文完整记录 Percolation 两个业务 Agent 下属 **6 个 `AgentSpec` 节点**、**9 个原子工具**、**5 份 System Prompt** 以及 **1 个渐进式披露 Skill（`wiki-format`）** 的设计与约束。

---

## 一、 原子工具清单（共 9 个）

系统不向模型暴露大而全的复杂工具，而是通过 **2 个业务数据库工具 + 6 个工作区受限文件/沙箱工具 + 1 个技能读取工具** 正交组合出所有能力：

| 工具名 | 定义位置 | 输入参数（Pydantic） | 作用与底层安全边界 |
| --- | --- | --- | --- |
| `hybrid_search` | `code/percolation/tools.py` | `queries: list[str] = []`, `facets: dict[str, list[str]] = {}`, `date_from: str \| None`, `date_to: str \| None`, `top_k: int = 6` | 在强制 RLS 租户事务内执行双轨四路多维混合召回（全文+trgm+向量+正交维度/事件日期 RRF），经 `gte-rerank-v2` 精排并附带关系类型的一跳邻居页 |
| `fetch_raw_messages` | `code/percolation/tools.py` | `msg_seqs: list[int]` (1~30个), `with_batch: bool = True` | 按锚点序号读取 `raw_messages` 逐字原话、时间戳、来源类型及澄清关联的原问题；默认附带同 `batch_id` 连发批次的前后消息 |
| `list_dir` | `code/agentkit/workspace.py` | `path: str = "."`, `recursive: bool = False` | 列出当前节点 `scope` 限定目录内的文件及行数，自动隐藏 `.git` 与临时文件 |
| `read_file` | `code/agentkit/workspace.py` | `path: str`, `start_line: int = 1`, `end_line: int \| None` | 按行号范围读取 `scope` 限定目录内的文件（带行号前缀，防止模型编辑时定位错行） |
| `bash` | `code/agentkit/workspace.py` + `sandbox.py` | `command: str` | 在 `BwrapSandbox` 内执行只读命令（`ls` / `rg` / `head` / `wc`）：`--unshare-all --clearenv` 禁网且剥离宿主机密钥，`--ro-bind` 仅挂载当前节点允许的 `scope` 目录，5 秒超时强杀，输出截断 8000 字 |
| `write_file` | `code/agentkit/workspace.py` | `path: str`, `content: str` | 临时文件 + `os.replace` 原子覆写文件；写入前强制检查 `write_prefixes` 白名单与 `memory_validators`（`MEMORY.md ≤ 200` 行、禁止 `[inferred]`、英文文件名正则） |
| `edit_file` | `code/agentkit/workspace.py` | `path: str`, `old_text: str`, `new_text: str`, `replace_all: bool = False` | 要求 `old_text` 在原文件中唯一匹配（除非设 `replace_all`），替换后同样经过 `write_prefixes` 与 `memory_validators` 校验并原子落盘 |
| `delete_file` | `code/agentkit/workspace.py` | `path: str` | 物理删除指定文件，检查 `write_prefixes` 白名单；**全系统仅向 `dream_tiering_defrag` 节点开放** |
| `read_skill` | `code/agentkit/skills.py` | `name: str` | 当 `AgentSpec.skills_dir` 非空时自动注入，按技能名读取 `SKILL.md` 去除 frontmatter 后的完整正文 |

---

## 二、 六个 `AgentSpec` 节点的最小权限矩阵

Search Agent 拆为 3 个节点，Dreaming Agent 拆为 3 个节点。每个节点仅拿到完成本步职责所需的最小工具与目录视野：

| 所属 Agent | 节点名 (`AgentSpec.name`) | 模型槽位（默认模型） | `max_turns` | 输出 Schema | 绑定 Skill | 开放工具与路径约束 |
| --- | --- | --- | --- | --- | --- | --- |
| **Search Agent** | `search_router` | `router_model` (`qwen3.8-flash` 关思考, `temp=0.1`) | `1` | `RoutePlan` | 无 | **无工具**（纯单轮意图解析与检索词扩展） |
| **Search Agent** | `search_answer` | `search_model` (`qwen3.8-flash` 关思考) | `3` | `AnswerDraft` | 无 | `hybrid_search`、`fetch_raw_messages`、`read_file`（仅 `scope="wiki"`，**不给 `list_dir` 与 `bash` 防止空转绕路**） |
| **Search Agent** | `search_cache_probe` | `search_model` (`qwen3.8-flash` 关思考) | `4` | `CacheProbe` | 无 | `list_dir`、`read_file`、`bash`（全部锁定 `scope="MEMORY_CACHE"`，沙箱内看不见 `MEMORY.md` 与 `wiki/`） |
| **Dreaming Agent** | `dream_archive` | `dream_model` (`qwen3.8-max` 开思考) | `30` | `ArchiveReport` | `wiki-format` | `read_skill`、`hybrid_search`、`fetch_raw_messages`、全工作区只读（`list_dir` / `read_file` / `bash`）、受限写（`write_file` / `edit_file`，**仅限 `wiki/` 与 `MEMORY_CACHE/`，禁止写 `MEMORY.md`**） |
| **Dreaming Agent** | `dream_tiering` | `dream_model` (`qwen3.8-max` 开思考) | `30` | `TieringReport` | `wiki-format` | `read_skill`、全工作区只读、受限写（`write_file` / `edit_file`，**仅限 `MEMORY.md` 与 `MEMORY_CACHE/`**） |
| **Dreaming Agent** | `dream_tiering_defrag` | `dream_model` (`qwen3.8-max` 开思考) | `30` | `TieringReport` | `wiki-format` | 在 `dream_tiering` 基础上，写白名单扩展为 `('MEMORY.md', 'MEMORY_CACHE/', 'wiki/')`，并额外开放 **`delete_file`** 用于合并删除冗余主题页 |

---

## 三、 五份 System Prompt 设计要点与原文对照

所有提示词文件统一独立存放在 `code/percolation/prompts/*.md`，不在 Python 代码里硬编码长字符串。运行期 `agentkit.loop` 会在每份提示词末尾自动追加对应 `output_model` 的 JSON Schema。

### 1. 检索路由提示词：`prompts/search_router.md`

- **绑定输出模型 `RoutePlan`**：`queries: list[str]`、`facet_filters: dict[str, list[str]]`、`date_from: str | None`、`date_to: str | None`、`time_field: "any" | "event" | "captured"`、`unknown_terms: list[str]`、`memory_clues_used: list[str]`、`clarify_now: bool`、`clarify_question: str`。
- **核心约束**：结合当前日期（含星期）与受控维度词表抽取正交维度与公历日期区间；防止模型因为 `MEMORY.md` 里没见过某个词就在第一步直接追问用户（否则候选缓存区 `MEMORY_CACHE/` 就失去了兜底机会）。

```markdown
你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。

你会收到：当前日期（含星期）、可用维度词表、用户的热区记忆（MEMORY.md，已确认的个人背景和暗语）以及本次提问。

要做的事：
1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。
2. 生成 1~4 个检索词（queries）：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。
3. 抽取正交维度条件（facet_filters）：当提问明确指向某个主题域（如“学习资料”“工作记录” -> `{"domain": ["学习"]}`）、载体形态（如“存过的网站”“收藏的书”“买的外设” -> `{"form": ["网站"]}`）或状态（如“待办”“在用的” -> `{"status": ["待办"]}`）时，从可用维度词表里选出匹配的键值填入 facet_filters。没有明显维度倾向就留空 `{}`，不要硬猜。
4. 抽取时间范围（date_from / date_to，格式 YYYY-MM-DD）：当提问包含明确日期或相对时间（如“上周”“这周六”“11月存的”），按输入里的“当前日期”换算成公历区间：
   - 问事件发生/预约时间（如“这周六有什么安排”）时，`time_field` 填 `"event"`；
   - 问记录/收藏时间（如“昨天记的那个”）时，`time_field` 填 `"captured"`；
   - 分不清时填 `"any"`。没提时间则 date_from / date_to 都填 null。
5. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。
6. 只有提问完全没有任何可检索的关键词、维度或时间（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。按类别/维度/时间提问（如“存过哪些网站”）一律设为 false。
```

### 2. 主路径核验作答提示词：`prompts/search_answer.md`

- **绑定输出模型 `AnswerDraft`**：`status: "answered" | "ambiguous" | "insufficient"`、`answer: str`、`verified_msg_seqs: list[int]`、`hit_doc_paths: list[str]`、`unresolved_terms: list[str]`、`clarify_question: str`。
- **核心约束**：确立“原话高于主题页摘要、新原话高于旧原话”的核验纪律；预取材料足够时直接作答；严禁凭常识或品牌谐音硬猜路由标出的未知暗语。

```markdown
你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。

你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。

规则：
1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。
2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。
3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。
4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。
5. status：
   - answered：找到了能回答问题的记录。
   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。
   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。
6. 不要编造记录里没有的信息。
7. 输入里“待确认的暗语”是路由看不懂的词。只有热区记忆、补充线索或原话里明确写出了这个词指什么，才能当作已知；不能凭常识、品牌联想或谐音去猜（例如把某个外号猜成某个品牌）。确认不了时 status 填 insufficient，把这个词写进 unresolved_terms。
```

### 3. 候选缓存区探查提示词：`prompts/search_probe.md`

- **绑定输出模型 `CacheProbe`**：`found: bool`、`rewritten_queries: list[str]`、`clues: list[str]`、`cache_hits: list[CacheHit(file, entry_key, clue)]`、`files_probed: list[str]`。
- **核心约束**：先用 `ls` / `rg` 定位，只精读 1～2 个相关文件；输出的 `entry_key` 必须是用户说出口的那个原词，供夜间整理按词条聚合命中次数。

```markdown
你在用户的候选缓存区 MEMORY_CACHE/ 里找线索。这里放着不常用但固定的背景：人物称呼、个人暗语和缩写、历史项目代号、低频偏好等，按类别分成多个 Markdown 文件，一行一个条目，键在前。

主检索没能回答用户的问题，可能是因为提问里有看不懂的暗语或指代。你的任务是在缓存区里找到能解释它们的条目，并据此改写检索词。

做法：
1. 先用 bash 执行 `ls MEMORY_CACHE` 或 `rg -n 关键词 MEMORY_CACHE` 看有哪些文件、哪里提到了这些词。关键词可以试原词、去掉一个字的变体、拼音首字母等。
2. 只读最相关的一两个文件，不要把所有文件都读一遍。
3. 找到了：found=true，cache_hits 写命中的文件和条目键（键就是用户说出口的那个词），clues 写一句话解释，rewritten_queries 写改写后的 1~3 个检索词。
4. 没找到：found=false，其他字段留空。不要猜。
5. files_probed 写你实际读过或搜过的文件路径。
```

### 4. 夜间原话归档提示词：`prompts/dream_archive.md`

- **绑定输出模型 `ArchiveReport`**：`archived_msg_seqs: list[int]`、`skipped_msg_seqs: list[int]`、`files_changed: list[str]`、`notes: str`。
- **核心约束**：动笔前必读 `wiki-format` 技能；按受控词表克制打好正交维度、换算相对日期并建立跨页类型链接（不在 `[inferred]` 行上乱贴异类维度）；高优 `clarification` 澄清同步沉淀进 `MEMORY_CACHE/`。

```markdown
你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户可能从主题、载体形态、状态或时间任意维度凭模糊印象来问。你的工作是让那时的多维检索与拓扑图谱都能命中正确的原话。

记忆分三处，都在工作区里：
- wiki/：扁平命名的主题/实体/资源页，是带多维标签与有类型双向链接的导航图谱。
- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好，以及 `facets.md` 用户扩展维度词）。
- MEMORY.md：热区，本阶段你只读不写。

本次任务：把待整理的原话归档进主题页。

做法：
1. 写之前先调用 read_skill 读 wiki-format，严格按里面的语法写。
2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。
3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新对象或新主题才新建页面。在 frontmatter 里填好 `type`、`aliases` 和页面公共维度 `facets`。
4. **打好正交维度与事件日期（克制收敛，不造冗余词）**：
   - 从受控维度词表里为页面（frontmatter `facets`）或单条事实（行内 `[dim:val]`）补齐正交视角。例如一条学习网站备忘，同时具备 `domain: 学习` 与 `form: 网站`，这样用户无论问“学习资料”还是“存过的网站”都能召回。
   - frontmatter `facets` 只放整页恒定共有的 `domain`（1~2 个）和统一 `form`；瞬时状态 `status` 标在具体条目行内。`topic` 优先复用词表已有词，每页最多 1~2 个中观领域词，不要把已在 `aliases` 里的具体物品名/型号重复塞进 `topic`。
   - 行内标签只描述该条事实本身，顺带提及的跨页关联对象用有类型链接（如 `[[belongs_to::xxx|显示名]]`、`[[uses::xxx]]`、`[[about::xxx]]`、`[[replaces::xxx]]`）表达，不要在 `[inferred]` 推测行上乱贴其他页面的 `domain`/`form`。
   - 原话中出现具体日期或相对时间（如“下周六”“这周末”），根据原话方括号里的录入日期和星期换算成公历日期，标为 `[@YYYY-MM-DD]` 或 `[@YYYY-MM-DD..YYYY-MM-DD]`。
5. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。
6. 状态变化（改时间、改价格、取消）要更新原条目与 `[status:...]` 标签，保留新旧锚点。
7. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。
8. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。
9. 不要一条消息一个文件，不要写得比原话还长。

最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。
```

### 5. 夜间冷热升降级与全局重整提示词：`prompts/dream_tiering.md`

- **绑定输出模型 `TieringReport`**：`promotions: list[TierMove]`、`demotions: list[TierMove]`、`merged_pages: list[str]`、`fixed_links: int`、`notes: str`。
- **核心约束**：运行期动态渲染 `{memory_limit}`（默认 200）与 `{soft_limit}`（默认 180）；只有仍在候选区且尚未进入 `MEMORY.md` 的 `[confirmed]` 事实才作为晋升候选；`defrag` 模式同步归并孤立近义标签并补齐关系前缀。

```markdown
你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。

- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 {memory_limit} 行，只放已确认、经常用到的条目，禁止 [inferred]。
- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。

你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。

规则：
1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。
2. 下沉：热区超过 {soft_limit} 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。
3. defrag 模式还要做：
   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；
   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；
   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。
4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。
5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。

汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。
```

---

## 四、 内置 Skill：`wiki-format`（渐进式披露语法契约）

文件位置：`code/percolation/skills/wiki-format/SKILL.md`。

该技能定义了大模型写文件与确定性解析器 `code/percolation/wiki.py` 之间的精确接口契约：

1. **初始上下文零膨胀**：`SkillLibrary` 启动时只向系统提示词追加一行 `- wiki-format：主题页、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。`，不占用在线检索节点的任何 Token。
2. **与确定性解析器严格对齐**：
   - `title` 与 `aliases` 映射为数据库 `percolation_weighted_tsv` 的 **A 级最高权重**；`type` 与 frontmatter `facets` 写入 `wiki_pages` 与 `page_facets`；
   - `## 小节` 映射为切片边界，小节标题与切片维度词元 `facet_text` 映射为 **B 级权重**，列表正文映射为 **C 级权重**；
   - 行内 `[dim:val]` 与页面 `facets` 合并写入原话级派生表 `message_facets`；行内 `[@YYYY-MM-DD]` / `[@YYYY-MM-DD..YYYY-MM-DD]` 写入 `message_events`；
   - `[confirmed]` / `[inferred]` 正则提取写入 `wiki_chunks.certainty`（若同一小节内全为 `inferred` 则整块标为 `inferred`），同时在写 `MEMORY.md` 时由 Python 钩子硬性拦截 `[inferred]`；
   - `[#msg_N]` 正则提取为整型数组写入 `wiki_chunks.source_msg_seqs` 与 `wiki_pages.source_msg_seqs`（GIN 索引），并用于整理收尾时的文件锚点对账；
   - `[[rel::target|label]]` / `[[target|label]]` 正则提取写入 `wiki_links`（含 `rel_type`），支持按文件名、标题、别名双向解析关联页与检测悬空链接。
