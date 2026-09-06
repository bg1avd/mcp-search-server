/**
 * mcp-search-server 统一入口（库形态）
 *
 * 便于二次开发/嵌入式。搜索后端可插拔：
 *   - searxng（方案 A，推荐）：连自建 SearXNG 的 /search?format=json
 *   - bing / duckduckgo：直接网页抓取（仅兜底，数据中心 IP 上可能被降级）
 */
export { startMcpServer, readBody, sendJson } from './server.js'
export { searxngSearch, buildSearxUrl, probeSearx } from './searxng.js'
export { handleRpc, runSearchTool, runSearch, toolDefinitions } from './protocol.js'
export { bingSearch, parseBing } from './bing.js'
export { duckduckgoSearch, parseResults, isDdgChallenge } from './ddg.js'
export { ApiKeyAuth, ApiKeyStore, generateApiKey, hashApiKey, safeEqual } from './auth.js'
