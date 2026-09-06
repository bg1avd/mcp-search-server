# mcp-search-server

**零依赖、可独立部署的 MCP 搜索服务器**，带 API Key 鉴权，走 **Streamable HTTP** 传输。
搜索实现为 **DuckDuckGo 网页解析**，**无需任何付费搜索引擎 API Key**。

适用：内网 AI 客户端（如 [cc-node](https://github.com/bg1avd/claude-code-node)）无法稳定直连 Google，
把本服务架在一台能访问外网的 VPS（并挂 Cloudflare 域名 / Nginx 反代），即可零成本搜索。

---

## 特性

- **免搜索 API Key**：抓取 DuckDuckGo 结果页并解析，只花带宽不花钱。
- **API Key 鉴权**：`Authorization: Bearer <key>`；未配置 key 默认拒绝流量（防公网裸跑）。
- **Streamable HTTP 传输**：标准 MCP，客户端可远程连接（非本地进程）。
- **零依赖**、纯 Node（ESM）、`engines: node>=18`。
- 工具枚举 / schema 完整，供标准 MCP 客户端自动发现 `search`。

> 反爬提示：DuckDuckGo 对高频/异常来源会返回验证页（HTTP 202）。
> 个人/内网低频使用稳定；高频商业使用请叠加多引擎或换官方 API —— 零成本前提即"低频、来源干净"。

---

## 安装 / 启动

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
# 方式 A：直接给 key（适合部署脚本/环境变量注入）
node src/cli.js serve --port 7394 --host 0.0.0.0 --keys=ms2_你复制的key

# 方式 B：使用 keygen 生成的文件（服务端每次从文件读摘要集）
node src/cli.js serve --port 7394 --host 0.0.0.0 --api-keys-file ./apikeys.json

# 也可用环境变量（优先级低于显式参数）
export PORT=7394 API_KEYS=ms2_xxx,yyy
node src/cli.js serve --host 0.0.0.0
```

> **强烈建议不要加 `--allow-no-auth`**。仅在纯开发本机临时用；公网暴露否则等于敞开。

systemd 守护示例（参考通用 service 写法）即可，略。

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
| `region` | string | — | DDG 区域，如 `us-en` / `cn-zh` / `de-de` |

返回：MCP `content[0].text`（Markdown 列表 `1. [标题](真实链接)` + 摘要）。

---

## 架构 / 目录

```
src/
├── ddg.js         DuckDuckGo 抓取与 HTML 解析（无状态纯函数）
├── auth.js        API Key 生成 / 鉴权 / 摘要存储（sha256, CSPRNG, 常量时间比较）
├── protocol.js    MCP JSON-RPC 核心分发（initialize/tools.*,…）
├── server.js      Streamable HTTP 服务器（鉴权中间件 + JSON/SSE 应答）
├── cli.js         CLI：keygen / serve
└── index.js       库入口
test/              单测 + 集成（含 fake-fetch 离线鉴权/解析测试）
```

---

## 测试

```bash
npm test          # 等价 node --test test/*.test.js
```

涵盖：解析器（离线）、反爬检测、授权利举/撤销/持久化、HTTP 鉴权（401/202/成功）、
协议分发、在线 search 结构。

## License

MIT
