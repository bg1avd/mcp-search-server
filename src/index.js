/**
 * mcp-search-server 统一入口（库形态）
 *
 * 便于二次开发/嵌入式：可直接 import 后 startMcpServer，也可复用各模块。
 */
export { startMcpServer, readBody, sendJson } from './server.js'
export { duckduckgoSearch, parseResults, isDdgChallenge } from './ddg.js'
export { handleRpc, runSearchTool, toolDefinitions } from './protocol.js'
export { ApiKeyAuth, ApiKeyStore, generateApiKey, hashApiKey, safeEqual } from './auth.js'
