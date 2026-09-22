# 测试（07-TESTING）

## 测试矩阵

| 层 | 命令 | 覆盖 | 依赖 |
|---|---|---|---|
| 单元 | `npm test` | 策略阈值、Jev 请求/响应/重试、文献键与去重、state/questions 形状（文献 + 推文）、画像哈希与迁移、后台 triage（缓存命名空间 / 完整摘要升级 / 改判保留 / 推文域）、渲染与工具条、五个适配器（真实抓取的 Scholar / arXiv 列表 / arXiv 单篇 + 手写 PubMed / X 夹具）、内容脚本集成（假 chrome 桥） | jsdom |
| 模型实测 | `npm run eval -- --scholar` / `npm run eval -- --tweets` | 文献：12 条人工标注 + Scholar 夹具 10 篇；推文：12 条人工标注（4 关注 / 3 普通 / 5 跳过） | `TYPESAFE_API_KEY`（环境变量或 `~/.claude/settings.json` 的 env） |
| 端到端 | `npm run e2e`（加 `--headed` 可视） | 在 Playwright 自带 Chrome for Testing 里加载扩展，把 Scholar / arXiv（列表 + 单篇）/ PubMed / X 域名映射到本地 HTTPS 夹具，真实调用 Jev，断言徽章数 / 无错误 / 灰化数 / 工具条计数与「隐藏跳过」筛选 / 单篇页不灰化无工具条，验证点击改判与 ⌥ 恢复，截图到 `tests/e2e-out/` | Chromium 1208、openssl、API Key |

## 2026-09-22 结果（0.2.0）

- 单元：37 / 37 通过。
- 推文实测（jev-1.13.0）：12 / 12 命中；推广 Noul 对抽奖 99%、卖课 99%、政治引流 82%、励志鸡汤 75%，对信息型推文 2~11%。10 条一批 0.9 s、5.1k token。
- 端到端：Scholar 10 关注（工具条计数一致）；arXiv 列表 101 条 10 普通 / 91 跳过，「隐藏跳过」隐藏 182 个 dt/dd；arXiv 单篇 1 徽章、无工具条、不灰化；PubMed 关注 / 跳过+综述；X 时间线 4 条 → 2 关注 / 2 跳过+推广，灰化 2。

## 2026-09-22 结果（0.1.0）

- 单元：22 / 22 通过。
- 模型实测（jev-1.13.0）：12 条清晰样本全部命中；综述 Noul 把「systematic review and meta-analysis」判为 96%；10 篇一批 0.86~1.03 s，约 5.4k 输入 token（≈ 0.0002 美元/批）。
- 端到端：Scholar 10/10 关注（检索词就是用户课题）；arXiv cond-mat.mtrl-sci 新投稿 101 条 → 10 普通 / 91 跳过，跳过项 dt+dd 全部灰化；PubMed 2 条 → 生物质介电「关注」、肝癌消融综述「跳过」；改判循环与 ⌥ 恢复通过。

## 已知限制

- PubMed 夹具是按其公开 DOM 结构手写的（curl 抓取被 reCAPTCHA 拦下），真实页面若改版需更新 `src/content/adapters/pubmed.js`。
- 端到端里 Scholar / arXiv / PubMed 的静态资源 404，页面无样式，不影响徽章断言；徽章外观以 Scholar 截图（自带内联样式）为准。
- X 夹具是按公开 DOM（`article[data-testid="tweet"]`、`tweetText`、`User-Name`、`time[datetime]`）手写的，X 改版需同步 `src/content/adapters/x.js`。
- CDP 附着到扩展 service worker 或扩展页面时拿不到 `chrome.*`（headless 下扩展页被导到 chrome-error://），种子设置改走内容脚本的隔离世界（`Runtime.executionContextCreated` 中 `auxData.isDefault === false` 的上下文）。
