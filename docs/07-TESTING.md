# 测试（07-TESTING）

## 测试矩阵

| 层 | 命令 | 覆盖 | 依赖 |
|---|---|---|---|
| 单元 | `npm test` | 策略阈值、Jev 请求/响应/重试、文献键与去重、state/questions 形状（文献 + 推文）、画像哈希与迁移、后台 triage（缓存命名空间 / 完整摘要升级 / 改判保留 / 推文域）、渲染与工具条、五个适配器（真实抓取的 Scholar / arXiv 列表 / arXiv 单篇 + 手写 PubMed / X 夹具）、内容脚本集成（假 chrome 桥） | jsdom |
| 模型实测 | `npm run eval -- --scholar` / `--tweets` / `--xhs` | 文献：12 条人工标注 + Scholar 夹具 10 篇；推文：12 条人工标注（4 关注 / 3 普通 / 5 跳过） | `TYPESAFE_API_KEY`（环境变量或 `~/.claude/settings.json` 的 env） |
| 端到端 | `npm run e2e`（加 `--headed` 可视） | 在 Playwright 自带 Chrome for Testing 里加载扩展，把 Scholar / arXiv（列表 + 单篇）/ PubMed / X 域名映射到本地 HTTPS 夹具，真实调用 Jev，断言徽章数 / 无错误 / 灰化数 / 工具条计数与「隐藏跳过」筛选 / 单篇页不灰化无工具条，验证点击改判与 ⌥ 恢复，截图到 `tests/e2e-out/` | Chromium 1208、openssl、API Key |

## 2026-09-22 结果（0.4.3）

- 用户第二张截图：折叠、单行、缩头像已生效，引用推文里的 X 文章卡片仍显示。X 夹具给跳过推文加了 `div[role="link"]` 引用块 + 文章封面 + 操作栏，端到端断言全部隐藏且折叠高度 49px。

## 2026-09-22 结果（0.4.2）

- 用户在真实 X 上截图：跳过推文带徽章但未折叠 / 变灰，广告推文显示「普通」。定位为 React 重写 className 抹掉状态类 + 旧缓存未套推广规则。
- 单元：49 / 49（状态改为 data-* 属性后所有断言同步改为 dataset / 属性选择器）。端到端 6 页通过。

## 2026-09-22 结果（0.4.1）

- 单元：49 / 49（新增：X 适配器返回 [article, cell] 两层容器；集成测试模拟虚拟列表重新挂载，验证本地判定即时套用且不发新的 Jev 请求）。
- 端到端：X 夹具改为绝对定位的 `cellInnerDiv` 格子，隐藏模式下格子整体 display:none。
- 未能在真实登录态的 X 上复现用户报告的「隐藏不了」，以上为按 X 真实 DOM 结构推断的两处修复，待用户确认。

## 2026-09-22 结果（0.4.0）

- 单元：48 / 48 通过（新增：小红书适配器（信息流 + 笔记弹层）、小红书域的 state / questions / 缓存命名空间、瀑布流重排（transform 与 left/top 两种、还原、非 JS 网格不动）、每站点跳过模式优先级、推广判跳过策略）。
- 小红书实测（jev-1.13.0，中文标题）：14 / 14 命中（5 学习 / 2 一般 / 7 屏蔽）；卖课广告的「广告」Noul 98%，其余 2~31%；三维判定合理（考研时间表：教学 63% / 干货 80% / 主题 44% → 一般）。10 条一批 0.95 s、6.8k token。
- 端到端：新增 `www.xiaohongshu.com/explore` 夹具（卡片带 transform 定位）：6 条 → 2 学习 / 4 屏蔽，默认「隐藏」，4 张隐藏后剩余卡片重排且位置互不重叠；X 折叠模式下跳过推文的图片隐藏、正文单行截断。其余页面同 0.3.0。
- 真实小红书 DOM 用专用 Chrome（端口 9333）抓取核对：`section.note-item[data-note-id]`、`.footer .title`、`.author .name`、`#noteContainer #detail-title / #detail-desc / .author-container .username`；未登录时瀑布流未布局（所有卡片 top/left 为 0），登录后的定位方式待真机确认。

## 2026-09-22 结果（0.3.0）

- 单元：40 / 40 通过（新增：命中维度与把握不大、折叠分组与展开、arXiv 真实列表的关注置顶重排与还原、工具条新控件、集成测试覆盖折叠分组 / 只看关注 / 置顶 / Alt 快捷键）。
- 实测（jev-1.13.0，含 3 个维度 Noul）：文献 12 / 12、推文 12 / 12 仍全部命中；维度判定合理（小麦粉介电：方法 97% / 材料 30%；氢还原球团：课题 77% / 方法 97% / 材料 96%；推文「Claude Code 输出裁剪」：主题 98% / 具体 98% / 来源 74%）。每批 token 约 +25%。
- 端到端：arXiv 101 条默认折叠（91 条跳过合并成 7 段，dt 行隐藏、dd 只剩一行），切「隐藏」后 182 个 dt/dd 全部消失，「关注置顶」后普通排到最前；Scholar 10 条全部显示命中维度；X 时间线 2 条跳过折叠；单篇页无工具条不折叠。

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
