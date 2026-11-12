# Percolation 控制台 · 三套前端预览

纯静态，无后端。Agent / Spec / 工具 / Prompt / Skill / 模型数据由 `build_data.py` 从真实代码导出。

| 端口 | 方案 | 导航方式 | 详情与配置 |
|------|------|----------|------------|
| 3001 | 经典侧栏 | 左侧分组菜单（参照知微后台） | 列表点行 → 右侧抽屉，Tab 切换 |
| 3002 | 顶栏主从 | 顶部 Tab + 左侧 Agent/节点树 | 右侧详情常驻，保存按钮在详情头部 |
| 3003 | 设置中心 | 侧栏树直达每个节点 | 单页分区卡片 + 右侧目录，改动后底部浮出保存栏 |

| **3004** | **融合版（选定）** | 3003 外壳 + 3001 的 Agent Hub / AgentSpec / 上下文 / 调试台 | 表格点行 → 运维抽屉（概览 · 配置 · 工具与边界 · Prompt · 上下文），抽屉内「完整页面」进入分区设置页 |

四套共用同一套组件与内容，只在外壳和交互组织上不同。融合版的 System Prompt 改为版本管理：版本列表、使用中标识、查看、行级对比、启用（确认后生效）、基于任一版本新建（草稿或直接启用）。

```bash
code/.venv/bin/python script/preview-console/build_data.py   # 刷新 shared/generated.js
python3 script/preview-console/serve.py                       # 启动 3001/3002/3003
node script/preview-console/qa_shots.mjs                      # 无头走查，截图到 images/console-preview/
```

## 结构

| 文件 | 作用 |
|------|------|
| `shared/generated.js` | 自动导出的 AgentSpec、工具 Schema、完整 system prompt、Skill、models.json（无密钥） |
| `shared/catalog.js` | 人工整理的叙述数据：架构分层、工作流步骤、节点职责/输入/边界、读写范围 |
| `shared/base.css` | 组件样式（卡片、表格、标签、表单、抽屉、弹窗），主色用 `--primary` 覆盖 |
| `shared/ui.js` | 内容渲染 + 配置草稿状态（修改高亮、差异确认）+ 调试台模拟脚本 |
| `a/ b/ c/ merged/` | 各方案的外壳、路由和少量样式；`merged/` 为选定版本 |
| `qa_shots.mjs` | 无头走查脚本，覆盖抽屉、配置修改、版本启用、完整页面、调试台 |

配置修改只保存在页面内存中；接后端时把 `UI.onClick` 里的 `modalOk` 分支换成 API 调用即可。
