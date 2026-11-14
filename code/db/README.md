# 数据库

独立库名是 `percolation`，和相邻业务不共用表。建表账号是 `percolation_owner`，服务运行用 `percolation_app`。不要用相邻项目的高权限账号连接这个库，那个账号会绕过行级安全。

连接信息在 `config/db.env`，不进入版本库。默认 `PGUSER` 是运行角色。不设置 `app.current_user_id` 时，查询结果为空，这是预期行为。

```sql
SELECT set_config('app.current_user_id', '<用户 uuid>', true);
SELECT capture_message('随手记的一句话');
```

租户号只在当前事务内有效。单用户阶段的默认用户标识是 `default`，对应的 uuid 写在 `config/storage.env` 的 `DEFAULT_USER_ID`。

## 已经落地的行为

- 十张表：核心事实与运行表 `users`（含 `workspace_head`）、`raw_messages`、`search_logs`、`dream_runs`；以及由工作区 `wiki/*.md` 确定性派生的多维索引与图谱表 `wiki_pages`、`page_facets`、`message_facets`、`message_events`、`wiki_chunks`、`wiki_links`（带 `rel_type` 有向关系类型）。全部表均开启 `ENABLE + FORCE ROW LEVEL SECURITY`。
- 原始记录只通过 `capture_message` 写入。180 秒内的连续录入共用一个批次号。应用不能直接插入，也不能改原文，只能推进 `dream_status` 和 `dreamed_at`。建表账号如果改原文，会被触发器拒绝。原话级维度标签与事件日期分别存放在独立派生表 `message_facets` 与 `message_events`，不改动 `raw_messages` 结构。
- 原始记录不算向量。向量只放在 `wiki_chunks.embedding`，类型是 `halfvec(1024)`。
- 中文全文不用 `pg_jieba` 或 `zhparser`。这两个插件都要求修改 `shared_preload_libraries` 并重启整台数据库，而这台实例还承载相邻业务。入库时把汉字切成重叠二字，英文和型号保留整词。因此搜「显示器」可以命中「便携显示器支架」，只搜一个字则不会命中。主题页的标题和别名权重为 A，小节标题与多维标签词元（`facet_text`）为 B，正文为 C。
- 型号拼写残缺走 `pg_trgm`。语义近邻只在主题页切片上建 HNSW 索引，距离用余弦。拓扑子图与一跳/多跳邻居直接基于 `wiki_links` + `page_facets` + `WITH RECURSIVE` 查询，无需外部图数据库。

## 受控函数（002）

运行账号在不设租户时看不到任何 `users` 行，夜间调度和按 slug 找用户需要绕过这一点。`002_dream_queue.sql` 提供两个 `SECURITY DEFINER` 函数，只返回调度元数据，不返回任何用户文本：

- `list_dirty_users(p_limit)`：有脏标记、待整理原话或候选区命中的租户，按 `dirty_since` 排序。
- `resolve_user_by_slug(p_slug)`：外部 slug 换成 `user_id` 和工作区路径。

拿到 `user_id` 后，读写业务数据仍然要进租户事务。`002` 用 `CREATE OR REPLACE`，可以重复执行。

## 工作区发布版本（004）

`users.workspace_head`（40 位 git sha，可空）记录“派生表对应的是工作区哪个提交”。整理在暂存 worktree 写完后，在同一个事务里刷新六张派生表、推进原话状态并写入它，事务提交后主工作区才快进到这个提交。主工作区 HEAD 落后于它，说明上次快进中断，下次整理开头（或拿得到整理锁的检索）补快进；HEAD 领先于它说明有人工提交，下次整理重新同步后登记新值；两者分叉需要人工处理。执行环境锚点把它当作“这次运行看到的工作区版本”。运行账号对这一列有 UPDATE 权限。

存量用户回填：`code/.venv/bin/python script/backfill_workspace_head.py [--dry-run]`（建表账号，只填 NULL，可重复）。整理和 reindex 开头也会懒回填。

## 网页端（005）

`005_product_web.sql` 为拾记凝境网页补两件事：

- `search_logs` 加 `answer_text`、`clarify_question`、`parent_search_id`。前两列存给用户看的回答和追问，网页刷新后能还原问答历史；澄清后的重查用 `parent_search_id` 指向线程第一问（第一问自身为 NULL），用户补的那句话仍是 `raw_messages.reply_to_search_id` 指向被回复的那一步。旧行默认空串 / NULL。
- `provision_user(p_slug)`（`SECURITY DEFINER`）：星页登录用户首次访问时建租户，slug 固定为 `sp-<星页 user uuid>`，已存在就直接返回，`created` 列标明是否新建。运行角色没有 `users` 的 INSERT 权限，只能经由这个函数；它拒绝 `sp-<uuid>` 以外的 slug，不能用来建 `default`、`e2e-`、`replay-` 等内部租户。

`sp-` 租户不在 `tenants.drop_tenant` 的允许范围内。确需删除（如测试账号）时，用建表账号按「临时租户」一节的同样步骤手工删，删完要 `systemctl restart percolation-api`：接口进程里缓存了 slug 到租户 id 的映射。

## 执行记录

`000_extensions.sql`、`001_init.sql`、`002_dream_queue.sql` 已在 2026-11-12 执行；`003_wiki_facets_and_graph.sql`（多维节点/维度倒排/事件日期/类型链接边与强制 RLS）、`004_workspace_head.sql` 已在 2026-11-13 执行（幂等脚本），`004` 之后已回填全部 2 个用户。`005_product_web.sql` 已在 2026-11-15 执行（幂等）。`001` 不要重复执行。

## 临时租户

`raw_messages` 的触发器禁止删除，所以临时租户不能直接 `DELETE FROM users`。`percolation.tenants.drop_tenant` 用建表账号在一个事务里临时停用触发器、删原话、恢复触发器、再删用户（其余表 `ON DELETE CASCADE`），再删工作区与暂存区。只允许 `e2e-`（测试）和 `replay-`（复现）开头的租户；命令行入口 `script/e2e_percolation.py --drop <slug>`。

复现建 replay 租户时，建表账号凭 `owner_maintenance` 策略跨租户读原租户的三张事实表，直接 `INSERT` 原话（保留 `msg_seq`、`batch_id`、`captured_at`，不走 `capture_message`），并改写 `next_msg_seq`、计数和 `created_at`。这些写法只用于 `replay-` 租户。

临时校验过两件事，测试数据都已回滚或删除：不设置租户时运行角色看不见行；两个租户互相看不见对方的检索记录。

2026-11-15 网页端上线后，真实用户以 `sp-<uuid>` 租户出现；`default` 仍保留给命令行和本机调试。
