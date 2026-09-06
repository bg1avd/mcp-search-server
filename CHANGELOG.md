# CHANGELOG

## [0.1.0] - 2026-09-06

### ✨ 首版
- 零依赖、纯 Node(ESM)、engines node>=18 的 MCP 搜索服务器。
- Streamable HTTP 传输；`search` 工具自动发现。
- API Key 鉴权：`keygen`(CSPRNG+sha256 摘要落盘) + `Authorization: Bearer` 常量时间校验；
  未配置 key 默认 503 拒绝流量(防公网裸跑)，`--allow-no-auth` 仅供开发。
- 搜索后端可插拔：
  - 主：自建 SearXNG(`/search?format=json`，聚合 google-cse/brave 等多源)，
  - 兜底：Bing 网页抓取；ddg.js 保留为可选显式后端。
  - 结果带 `engine` 标注；失败自动降级后端。
- CLI：`serve`(--keys/--api-keys-file/--searxng-url) 与 `keygen`。
- 测试：33 个(解析、反爬检测、授权、后端 failover、HTTP/协议)。

> 0.x 语义：功能具备但尚未经公开大规模验证；API/CLI 可能在 1.0 前有小幅调整。
