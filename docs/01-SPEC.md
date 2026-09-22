# 文献分诊（Paper Triage）· 单功能轻量 spec

> 2026-09-22 · 版本 0.2.0 · 形态：Chrome 扩展（Manifest V3，无构建步骤）· 判断引擎：TypeSafe Jev（System One）

## 0. 一句话

解决 **Hao（冶金博士，每天刷 Google Scholar / arXiv / PubMed 文献列表）** 的 **「一页几十条，不知道先读哪条、哪条可以直接跳过」** 问题：在列表页每条文献标题前打上 **关注 / 普通 / 跳过** 徽章，**跳过的整条变灰**，判断由 Jev 按用户的研究画像逐条给出。

## 1. 问题与用户（JTBD）

- 上次怎么解决：肉眼逐条扫标题和摘要，凭直觉决定点不点开；一页 10~45 条，每页要花 3~5 分钟，且容易漏。
- 被「雇来」做的事：把「值不值得读」这个一秒钟的判断外包给模型，让眼睛只落在绿色徽章上，灰掉的条目直接略过。
- 为什么现在做：2026-09-22 已把 Jev 接进 Claude Code / Codex（见 `jev-typesafe-setup` 记忆），密钥和调用模式现成；Jev 单次请求 ~100 ms、按输入 token 计费，逐条判读成本可忽略。

## 2. 范围

**1.0 做：**
- 站点适配：Google Scholar 搜索结果、arXiv 列表页（`/list/**`）与搜索页（`/search/**`）、PubMed 搜索结果。
- 每条文献 → Jev 一个 Score（读的优先级：跳过 / 普通 / 关注）+ 一个 Noul（是否综述）。同页多条打包成一次请求（每批 10 条），批次并行。
- 徽章三态 + 判读中 / 出错 两个过渡态；跳过项整条 `opacity 0.42 + grayscale`，悬停恢复可读。
- 点击徽章手动改判（关注→普通→跳过→关注 循环，⌥+点击恢复 AI 判定），改判持久化并带 ✎ 标记。
- 本地缓存（DOI / arXiv ID / 规范化标题为键），同一篇文献跨站点不重复判读。
- 选项页：API Key、模型、研究画像（英文，五个字段）、阈值；弹窗：开关、本页重判、清缓存。

**0.2.0 追加：**
- **X / Twitter 时间线**：`article[data-testid="tweet"]` 逐条判「有用」；独立的「推文画像」（读者概括 / 感兴趣主题 / 有用信号 / 噪声），推文专用三级 Score + 「推广 / 引流」Noul（芯片显示「推广」）。虚拟化列表靠 MutationObserver 重扫，缓存键 `tweet:<status id>`。
- **页面工具条**（右下角，可收起）：关注 / 普通 / 跳过 计数，筛选「全部 / 只看关注 / 隐藏跳过」（Alt+F / Alt+H），「↓ 关注」跳到下一条关注（Alt+N），「重判」。筛选状态按标签页记在 sessionStorage。
- **多套文献画像**：选项页可新建 / 重命名 / 删除，弹窗一键切换当前生效画像；判读缓存按「画像内容哈希」分命名空间，改画像即自动失效，打开的页面自动重判。
- **单篇详情页**：arXiv `/abs/` 与 PubMed 文章页用完整摘要判读（依据标为「完整摘要」），并覆盖列表页基于片段的旧判定；详情页只打徽章不灰化、不出工具条。
- **综述 / 推广芯片**：Noul ≥ 0.5 时在徽章后显示「综述」（文献）或「推广」（推文）。
- **导出**：弹窗「复制本页『关注』为 Markdown」（标题、作者、期刊年份、链接、DOI）。

**Non-goals（1.0 不做）：**
- 不进论文详情页、不读全文 PDF、不做摘要生成或推荐理由（Jev 不生成文本）。
- 不做 Web of Science / Scopus / ScienceDirect（SPA，DOM 不稳定，后续再评估）。
- 推文只判文本（含被引用推文的文本），不看图片 / 视频 / 链接落地页；不判无文字的纯图推文。
- 不做「保存 / 文献卡」（已列为下一项，见 §8）。
- 不做 Zotero 插件、不写回 SciFlow；核心判断模块（`src/shared/`）是纯 ES module，后续可直接复用到这两个宿主。
- 不做账号同步、不做多用户；密钥只存本机 `chrome.storage.local`。
- 不做 embedding / RAG / 记忆；画像是用户手写的结构化文本，判断全部交给 Jev + 代码阈值。

## 3. 用户流程

```
安装扩展 → 选项页粘贴 TYPESAFE_API_KEY、确认默认画像 → 保存
   → 打开 Scholar 搜索页 →（每条标题前出现「判读中…」虚线徽章，<1 s 变为 关注/普通/跳过）
   → 跳过项整条变灰；眼睛只扫绿色「关注」
   → 不同意某条：点徽章改判（✎，⌥+点击恢复 AI），下次打开仍生效
   → 想全部重来：弹窗「本页重新判读」（跳过缓存）
```

线框（一条 Scholar 结果）：

```
[关注] Microwave dielectric properties of biomass … ← 绿色胶囊，1.5px 描边 + 淡绿底
       H Yao, M Omran, T Fabritius - Bioresource Technology, 2025
       … snippet …
[跳过] A 28 GHz phased-array antenna for 5G …       ← 整条 opacity .42 + 灰度
```

## 4. 用户故事 + 验收（Given / When / Then）

1. 作为博士生，我想在 Scholar 结果页直接看到每条文献值不值得读，以便只点开该读的。
   - Given 已配置 API Key 与画像，When 打开 `scholar.google.com/scholar?q=…`，Then 每条 `.gs_r` 标题前出现徽章，且徽章文案 ∈ {关注, 普通, 跳过}。
   - Given 某条被判「跳过」，Then 该条容器带 `pt-skipped` 类（灰度 + 半透明），悬停恢复。
2. 作为用户，我想纠正模型的误判，以便下次不再被误导。
   - Given 一条已判读，When 点击徽章，Then 标签按 关注→普通→跳过→关注 循环并带 ✎，⌥+点击恢复 AI 判定，刷新页面后保持。
3. 作为用户，我想知道判读没成功而不是静默失败。
   - Given API Key 错误或断网，When 打开列表页，Then 徽章显示「未判读」并在 tooltip 给出原因，点击可重试。
4. 作为用户，我想控制成本，以便同一篇文献不反复付费。
   - Given 一篇文献已判读过，When 在另一站点再次出现（同 DOI 或同标题），Then 不再发起请求，直接用缓存。

## 5. 判断设计（按 TypeSafe 官方方法）

- **State**（英文，结构化）：`{ researcher: {summary, core_topics[], methods[], materials[], not_interested[]}, papers: [{title, abstract_or_snippet, venue, year}] }`，每批 ≤10 篇。
- **问题**（每篇两问，同一请求并行）：
  - `paper_{i}_priority` · Score · 三级：0 = Skip（与画像无实质重叠或命中 not_interested）· 1 = Normal（部分重叠，主问题不同）· 2 = Follow（主问题 / 方法 / 材料落在画像里，或结果是用户工作的依赖）。指令明确「仅依据 title 与 abstract_or_snippet；snippet 为空时只看标题」。
  - `paper_{i}_review` · Noul · 是否综述 / 展望类文章（只做 tooltip 信息）。
- **策略在代码里**（`policy.js`，阈值可在选项页调）：`P(Follow) ≥ followMin(0.5)` → 关注；否则 `P(Skip) ≥ skipMin(0.6)` → 跳过；否则 普通。不对称阈值：宁可多给「普通」，不轻易灰掉。
- 遵守 jev-1.13 已知短板：不让模型数数或算分，state 只放当前批次相关字段，criteria 逐级写清边界。

## 6. 成功指标

- 北极星：一页文献里被灰掉的比例 ≥ 40% 且用户手动把「跳过」改回的次数 < 10%。
- 上线后看：每页判读耗时（目标 < 1.5 s）、缓存命中率、改判次数。

## 7. 优先级与取舍

- MoSCoW：Must = Scholar 适配 + Jev 判读 + 三色徽章 + 灰化 + 缓存；Should = arXiv / PubMed 适配、手动改判、选项页；Could = 综述标记、弹窗统计；Won't = 全文分析、其他站点。
- 取舍：选 Chrome 扩展而非 Zotero 插件，因为「看文献」的第一现场是搜索结果页，且扩展可在无头 Chromium 里自动化验证；核心模块保持宿主无关，后续可移植。

## 7b. 安装与验证

1. Chrome 打开 `chrome://extensions`，开启「开发者模式」，「加载已解压的扩展程序」选 `~/projects/paper-triage`。
2. 点扩展图标 → 「设置」，粘贴 TypeSafe API Key（与 `~/.claude/settings.json` 里 `env.TYPESAFE_API_KEY` 同一个），点「测试连接」，按需改画像，保存。
3. 打开 Scholar / arXiv / PubMed 任一列表页，徽章 1 秒内出现。
4. 开发验证：`npm test`、`npm run eval -- --scholar`、`npm run e2e`，结果见 `docs/07-TESTING.md`。

## 8. 风险与未决问题

- Google Scholar 反爬：扩展只读 DOM、不发请求，不触发风控。
- Jev 对中文文献准确率低于英文（官方说明），画像与 criteria 全部用英文。
- `--load-extension` 在 Chrome 137+ 品牌版被禁用，本地验证用 Playwright 自带 Chromium。
- 待拍板：是否需要 Zotero 版本。
- **下一项（用户已提出）**：「保存」功能 + EAFD 文献卡（v3 样式：相关性标签 + DOI 链接标题 + 状态按钮 + 中文标题 + 年份·期刊 + 作者 + 可展开中英摘要 + 方法 / 结论 / 文章特点）。中文标题、翻译与三段正文需要生成式模型（Jev 只判定不生成）；本机可用 `ANTHROPIC_AUTH_TOKEN`。`card-template-v2.html` 本机未找到，需用户提供或按截图与规范重建。

## 9. Nielsen 自检

- 状态可见：判读中 / 未判读 / 三色结果都有徽章；tooltip 给概率。
- 可撤销：点击改判可循环回 AI 判定；弹窗可清缓存。
- 一致性：三站点同一套徽章与灰化；文案固定「关注 / 普通 / 跳过」。
- 防错：密钥错误时选项页「测试连接」先报错；阈值输入限定 0~1。
- 减记忆负担：画像有默认值；无需记命令。
- 错误可指导：错误徽章 tooltip 写明原因（401 → 检查密钥；429 → 稍后重试）。
