# mcp-search-server

[![npm version](https://img.shields.io/npm/v/@raolin2025/mcp-search-server)](https://www.npmjs.com/package/@raolin2025/mcp-search-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**零依赖、可独立部署的 MCP 搜索服务器**，带 API Key 鉴权，走 **Streamable HTTP** 传输。
**无需任何付费搜索引擎 API Key**。搜索后端默认接**自建 SearXNG**（聚合 google-cse / brave 等多源，
失败自动回退 Bing），从而规避"部署在数据中心/云 IP 上被单引擎验证码封禁"的问题（见下"实测依据"）。

适用：内网 AI 客户端（如 [cc-node](https://github.com/bg1avd/claude-code-node)）无法稳定直连 Google。
把 SearXNG + 本服务架在一台能访问外网的机器（或挂 Cloudflare 域名 / Nginx 反代），即可零成本搜索。

> **npm 安装（源码即 CLI）**
> ```bash
> npm i -g @raolin2025/mcp-search-server     # 提供 `mcp-search-server` 命令
> # 或先从仓库本地直接跑（无需全局）：
> #   git clone … && cd mcp-search-server && node src/cli.js …
> ```

---

## 快速部署（三步）

```bash
# 1) 后台起一个 SearXNG 当主后端（官方镜像）
docker run -d --name searxng -p 127.0.0.1:8809:8080 searxng/searxng:latest

# 2) 生成 API key（明文只打印一次，落盘仅 sha256 摘要）
mcp-search-server keygen --file ./apikeys.json

# 3) 启动本服务器（指向 SearXNG + 加载 key）
mcp-search-server serve --port 7397 --host 0.0.0.0 \
     --searxng-url http://127.0.0.1:8809 --api-keys-file ./apikeys.json
```

> 无 docker 时，也可省略 SearXNG——本服务会回退到 Bing 抓取；读 ["架构 / 目录"](#架构--目录)了解后端路由。
> 各参数含义与 Cloudflare/Nginx 反代另见下文 ["安装 / 启动"](#安装--启动) 与 ["对外暴露"](#3-对外暴露可选--cloudflare--nginx-反代)。

---

## 特性

- **免搜索 API Key**：搜索走自建 SearXNG（也可直抓 Bing 兜底），不购买任何付费搜索 API。
- **API Key 鉴权**：`Authorization: Bearer <key>`；未配置 key 默认拒绝流量（防公网裸跑）。
- **Streamable HTTP 传输**：标准 MCP，客户端可远程连接（非本地进程）。
- **零依赖**、纯 Node（ESM）、`engines: node>=18`。
- 工具枚举 / schema 完整，供标准 MCP 客户端自动发现 `search`。
- 搜索后端可插拔：`SEARXNG_URL` 指定自建 SearXNG 时优先；结果带 `engine` 标注。

> ⚠️ **部署 IP 边界（实测）**：把服务架在**已被判为"机器人来源"的数据中心/云 IP** 上，
> 任何"直接抓 Google/DuckDuckGo/Bing 网页"的爬虫都会被验证码封。
> SearXNG 的价值在于：它在服务器侧把请求调度给 google-cse / brave 等上游源，实测**同一被标记 IP**
> 也能稳定返回真实结果（引擎不走会被验证码拦截的路径）。为最稳，建议 SearXNG 放在住宅/家宽 IP 上，
> 或让出网的源足够干净后，再让 mcp-search-server 指过去。

---

## 架构

```
cc-node (MCP 客户端)
   │  http(s)://<host>:7397/mcp   +  Authorization: Bearer <api-key>
   ▼
mcp-search-server  (鉴权 + 暴露 MCP search 工具；零依赖)
   │  SEARXNG_URL=http://<searxng-host>:8809
   ▼
SearXNG  (多引擎聚合；google-cse / brave … 失败则本服务器回退 Bing)
```

---

## 安装 / 启动

前置：需要一个能出活数据的搜索后端——推荐自建一个 SearXNG（Docker 一条命令）：

```bash
# 起 SearXNG（官方镜像，默认 127.0.0.1:8809 即可）
docker run -d --name searxng -p 127.0.0.1:8809:8080 searxng/searxng:latest
```
> SearXNG 默认只暴露 HTML。要让 mcp-search-server 可读它（JSON），需给 SearXNG 开启 json 输出：
> 改 `settings.yml` 里 `search.formats` 加入 `json`（或用下方 --api-keys-file/--keys 配好后由本 server
> 直接访问其 HTML 亦可，但推荐开 JSON 以获得结构化结果）。

### 1. 生成 API Key

```bash
node src/cli.js keygen --file ./apikeys.json
# 输出（仅一次，妥善保存）：
#   新 API Key（仅此一次显示，请妥善保存）
#   ms2_xxxx….（这是一串随机长串）
```

明文 key 只打印一次；`apikeys.json` 里**只存其 sha256 摘要**。

### 2. 启动服务器

```bash
# 推荐：指向自建 SearXNG（主），未配时自动回退 Bing
node src/cli.js serve --port 7397 --host 0.0.0.0 \
     --searxng-url http://127.0.0.1:8809 \
     --api-keys-file ./apikeys.json

# 也用环境变量（优先级：命令行 > env）
export PORT=7394 API_KEYS=ms2_xxx,yyy SEARXNG_URL=http://127.0.0.1:8809
node src/cli.js serve --host 0.0.0.0
```

启动相关参数：

| 参数 / 环境变量 | 说明 | 默认 |
|---|---|---|
| `--host` | 监听地址 | `0.0.0.0` |
| `--port` / `PORT` | 监听端口 | `7394` |
| `--keys=…` / `API_KEYS` | 直接允许的 API key（逗号分隔） | 空 |
| `--api-keys-file` / `API_KEYS_FILE` | 由 `keygen --file` 生成的摘要文件 | 空 |
| `--searxng-url` / `SEARXNG_URL` | 自建 SearXNG 根地址（主后端） | 空→自动回退 Bing |
| `--allow-no-auth` | 仅开发态跳过鉴权（勿公网） | 关闭 |

> **强烈建议公网部署务必 `--keys`/`--api-keys-file`，不要加 `--allow-no-auth`。**

`serve` 子命令无参运行会打印完整用法（含上面所有参数）。


### 3. 对外暴露（可选）—— Cloudflare / Nginx 反代

本服务绑定 0.0.0.0 后即可直接访问；若只有 VPS 且想加 HTTPS，可用 Cloudflare Tunnel：

```bash
cloudflared tunnel --url http://127.0.0.1:7394
# 得到 https://xxx.trycloudflare.com —— 客户端连该地址 /mcp
```

或 Nginx：

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:7394;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 120s;
}
```

---

## 供客户端连接

客户端连到的 MCP 服务地址为 `https://<host>/mcp`（streamable-http 端点，也可 `/`）。
每次请求送 `Authorization: Bearer <api-key>`。

### 在 cc-node 里配置（仅需一项）

`.claude-code/config.json`：

```jsonc
{
  "mcp": {
    "servers": {
      "search": {
        "type": "http",
        "url": "https://search.example.com/mcp",
        "token": "ms2_你复制的key"   // cc-node 会原样作为 Bearer 透传
      }
    }
  }
}
```

cc-node 的 MCP 客户端（`src/mcp/client.js`）已支持远程 HTTP：看到 `type:'http'` 或 `url`
即自动走 HTTP 而非本地 spawn。调用示例：

```javascript
import { MCPRegistry } from 'cc-node/src/mcp/index.js'
const r = new MCPRegistry()
r.register('search', { type: 'http', url: 'https://search.example.com/mcp', token: 'ms2_xxx' })
await r.connectAll()
const tools = r.getAllTools()                                   // [{name:'search', …}]
const res = await r.callTool('search', 'search', { query: 'Node.js 微服务', count: 5 })
console.log(res.content[0].text)
```

> 任何标准 MCP 客户端（Claude Desktop / MCP Inspector 等）也能连：
> `{"mcpServers":{"search":{"type":"http","url":"https://…/mcp","headers":{"Authorization":"Bearer ms2_xxx"}}}}`

---

## 提供的能力：`search`

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `query` | string | — | 搜索词（必填） |
| `count` | int (1-30) | 10 | 返回条数 |
| `region` | string | — | 区域/语言，如 `us-en` / `cn-zh` / `de-de`（转为 searxng `language` 等） |

返回：MCP `content[0].text`，第一行固定标注实际命中后端与引擎，
之后是 Markdown 列表 `1. [标题](真实链接)` + 摘要 + `(engine: …)`。

---

## 架构 / 目录

```
src/
├── searxng.js     SearXNG JSON 客户端（主后端；聚合 google-cse/brave…）
├── bing.js        Bing 网页抓取（let 兜底，无 SearXNG 时）
├── ddg.js         DuckDuckGo 抓取（保留为可选显式后端，不默认）
├── auth.js        API Key 生成 / 鉴权 / 摘要存储（sha256, CSPRNG, 常量时间比较）
├── protocol.js    MCP JSON-RPC 核心分发（initialize/tools.*,…；后端 failover 规划）
├── server.js      Streamable HTTP 服务器（鉴权中间件 + JSON/SSE 应答）
├── cli.js         CLI：keygen / serve
└── index.js       库入口
test/              单测 + 集成（含 fake-fetch 离线鉴权/解析/failover 测试）
```

---

## 测试

```bash
npm test          # 等价 node --test test/*.test.js
```

涵盖：SearXNG JSON 后端、后端 failover（searxng→bing）、DDG/bing 解析、反爬检测、
API key 签发/校验/撤销/持久化、HTTP 鉴权（401/503/202/成功）、MCP 协议分发、在线 search 结构。

---

## 在 cc-node 里接（MCP 客户端）

本配套客户端是 [cc-node](https://github.com/bg1avd/claude-code-node)。它支持把 `config.mcp.servers`
里声明的远程 MCP 服务器自动接入运行时工具表：配好即可直接用 `search`，不配不受影响。

```jsonc
// cc-node 的 .claude-code/config.json
{ "mcp": { "servers": { "search": {
    "type": "http", "url": "http://<本机或反代>:7397/mcp", "token": "ms2_xxx" } } } }
```

## License

MIT
