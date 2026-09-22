# paper-triage · 文献分诊（Chrome 扩展 + TypeSafe Jev）

## 固定标准

- 技术栈：Manifest V3、原生 ES modules、无构建步骤、无运行时依赖；开发依赖仅 jsdom。未经允许不引新库、不加打包器。
- 目录：`src/shared/` 宿主无关的判断核心（Jev 客户端、问题构造（文献域 + 推文域）、策略、文献键、画像与哈希）；`src/content/` 内容脚本、渲染、工具条与站点适配器（scholar / arxiv / pubmed / x）；`src/background.js` 持有 Key、按画像哈希分命名空间的缓存；`src/options/`、`src/popup/` UI。
- 新增站点：写 `src/content/adapters/<site>.js`（`{id, domain, matches, findEntries}`，entry = `{id, containers, mount, single?, noGray?, paper}`），加夹具与 `tests/adapters.test.js` 用例，manifest 的 `matches` 与 `web_accessible_resources` 同步加域名，e2e `PAGES` 加一行。
- 判断设计遵循 TypeSafe 官方方法（先加载 `typesafe:typesafe-ai` 技能读在线文档）：state 用结构化英文 JSON，Score/Noul 一问一判，阈值与算术全部在代码里。
- 文案固定：关注 / 普通 / 跳过；三态（判读中 / 未判读 / 结果）必做。跳过项三种显示方式（折叠 / 变灰 / 隐藏）由 `html.pt-skip-<mode>` 驱动，折叠的站点细节在 `badge.css` 的 `pt-site-*` 规则里。
- 密钥只存 `chrome.storage.local`，不写进仓库；实测脚本从环境变量或 `~/.claude/settings.json` 读取。

## 验证

```bash
npm test                      # 单元（jsdom）
npm run eval -- --scholar     # Jev 文献实测，打印概率表
npm run eval -- --tweets      # Jev 推文实测
npm run e2e                   # 无头 Chromium 端到端，截图在 tests/e2e-out/
```

真机加载：Chrome → `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选本目录（品牌版 Chrome 137+ 不认 `--load-extension`，只能手动加载）。

## 文档同步

改代码同一次提交更新：功能/行为 → `docs/01-SPEC.md`；测试 → `docs/07-TESTING.md`；用户可见变更 → `docs/09-CHANGELOG.md`。
