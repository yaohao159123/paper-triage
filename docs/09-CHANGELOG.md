# CHANGELOG

## 0.1.0 · 2026-09-22

- 首版：Chrome MV3 扩展，在 Google Scholar / arXiv（列表页 + 搜索页）/ PubMed 列表页为每条文献注入 关注 / 普通 / 跳过 徽章，跳过项整条灰化、悬停恢复。
- 判断：TypeSafe Jev，每篇一个三级 Score（读的优先级）+ 一个 Noul（是否综述），每批 10 篇一次请求、批次并行；阈值策略在代码里（followMin 0.5 / skipMin 0.6）。
- 本地缓存（DOI / arXiv ID / 规范化标题为键）；点击徽章手动改判并持久化，⌥+点击恢复 AI；弹窗可开关、本页重判；选项页配置 Key / 模型 / 研究画像 / 阈值 / 批大小，可测试连接、清缓存。
- 测试：22 个单元测试、Jev 实测脚本、无头 Chromium 端到端脚本。
