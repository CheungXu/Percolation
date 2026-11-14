# console · Percolation 控制台

线上地址：<https://stars-page.com/Percolation/console/>，由 `percolation.api` 托管在 `/console/` 路径下（经 Nginx 去掉 `/Percolation` 前缀）。

## 权限控制

- `AUTH_MODE=star_page`（线上）：通过星页 `/api/auth/me` 获取登录账号的 `phone`，仅 `config/web.env` 中 `CONSOLE_PHONE_WHITELIST`（逗号分隔）包含的手机号可访问 `/console`、`/console/` 及 `/console/*` 全部静态资源；未登录返回 401，非白名单返回 403。`CONSOLE_PHONE_WHITELIST` 留空时默认禁止所有人访问。
- `AUTH_MODE=header`（本机调试）：自动放行，方便本地开发。
- 白名单用户在「拾记凝境」主页面右上角账号弹窗中会看到「打开控制台」入口；非白名单用户看不到该入口。

## 数据刷新

控制台前端来自 `script/preview-console/` 选定的融合版（`merged/` + `shared/`），使用相对路径加载资源。代码里的 AgentSpec / Prompt / Skill / 模型槽变动后，重新生成并同步 `generated.js`：

```bash
code/.venv/bin/python script/preview-console/build_data.py
cp script/preview-console/shared/generated.js code/console/shared/generated.js
```
