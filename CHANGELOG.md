# CHANGELOG

## [0.1.3] - 2026-10-14

### 🐛 修复：兜底结果"看着像结果、其实是垃圾"却毫无提示

**实测现象**：查询 `OpenAI API reasoning_effort parameter chat completions`，返回：

```
# 来源后端: bing（5 条）

1. [OpenAI | Research & Deployment](https://www.bing.com/ck/a?!&&p=e6dbc7ab…)
2. [ChatGPT: Chat, Work, Create & Code with AI](https://www.bing.com/ck/a?!&&p=cedf2eb5…)
```

三条问题：
1. **不声明降级** —— 使用者以为 SearXNG 搜到了，实则是兜底后端的结果；
2. **URL 不可用** —— `bing.com/ck/a?...` 是跳转链接，既不能引用也不能二次抓取；
3. **内容无关联** —— 被风控的数据中心 IP 上，Bing 会返回"品牌首页集合"
   （openai.com / chatgpt.com / GPT-4 页），看似有结果，实则零信息量。

**根因**：SearXNG 主后端偶发全引擎失败（brave 限频 / duckduckgo+startpage 验证码 /
整体超时）→ 静默回退 Bing → Bing 在被标记 IP 上返回降级集 → 原样端出。

**修复**：

- **解码 Bing 跳转链接**：`…/ck/a?…&u=a1<base64url>` → 真实 URL
  （`https://openai.com/`）。解不出来就保持原样，绝不伪造。
- **降级声明**：发生回退时，结果开头显式写明「主后端未返回结果，已降级到 **bing**。原因：…」，
  **并带上主后端失败的具体原因**（含"哪些上游引擎不可用"）。
- **质量检测**：全部结果为域名首页 / 存在无法还原的跳转链接 → 打出
  「⚠️ **结果质量可疑**：…」，不让垃圾伪装成正常结果。
- **`--no-fallback`**（或 `NO_FALLBACK=1`）：只在 SearXNG 上搜，失败**如实报错**，
  宁可不返回也不给降级结果。
- SearXNG 空结果时，把 `unresponsive_engines` 带进降级原因，便于定位是哪家引擎被挡。

### 测试
- 新增 15 例（跳转解码 / 降级检测 / 降级声明 / noFallback），共 **48 通过 / 0 失败**；
  其中 Bing 跳转链接用**真实观测到的 URL** 做回归样例。

## [0.1.2] - 2026-09-06

### 🐛 修复
- CLI / initialize 的版本号不再硬编码，改为读取 package.json（`SERVER_VERSION`），避免与发布版本不一致。

### 🚀 发布
- `@raolin2025/mcp-search-server` 已上线 npm（latest）。经实测 `npm i @raolin2025/mcp-search-server` 可正常安装并运行。

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
