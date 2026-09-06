/**
 * MCP JSON-RPC 协议核心：与传输无关的消息分发。
 *
 * 实现 MCP 协议子集（initialize / tools.* / resources.* / ping / shutdown），
 * 供 streamable-http（server.js）与 stdio 两种传输复用同一套业务逻辑。
 *
 * 对外暴露一个工具：search —— 内部走 DuckDuckGo 抓取，免搜索 API。
 */

import { duckduckgoSearch } from './ddg.js'

export const SERVER_NAME = 'mcp-search-server'
export const SERVER_VERSION = '1.0.0'
export const PROTOCOL_VERSION = '2024-11-05' // 服务器声明，兼容 streamable-http

/** MCP 工具清单 */
export const toolDefinitions = [
  {
    name: 'search',
    description:
      '网页搜索（免 API key，走 DuckDuckGo 抓取解析）。' +
      '返回按相关度排序的结果；每个结果含 title / url / snippet。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（必填）' },
        count: {
          type: 'number',
          description: '最多返回条数，默认 10，范围 1-30',
          minimum: 1,
          maximum: 30,
        },
        region: {
          type: 'string',
          description: '区域/语言，如 us-en / cn-zh / de-de（可选）',
        },
      },
      required: ['query'],
    },
  },
]

/**
 * 执行 search 工具。任何异常都被捕获并转成 MCP isError 文本，
 * 保证 tools/call 永不 throw（协议层更友好）。
 * @param {object} args
 */
export async function runSearchTool(args = {}) {
  const query = (args && args.query) ? String(args.query).trim() : ''
  if (!query) return '[search] 缺少必填参数 query'
  let count = Number.parseInt(args.count, 10)
  if (!Number.isInteger(count)) count = 10
  if (count < 1) count = 1
  if (count > 30) count = 30
  const region = (args.region ? String(args.region).trim() : '')
  try {
    const rows = await duckduckgoSearch({ query, count, region })
    if (!rows.length) return `[无结果: ${query}]`
    return rows.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet || ''}`).join('\n\n')
  } catch (err) {
    return `[search error: ${err && err.message ? err.message : err}]`
  }
}

/**
 * 分发一条 MCP JSON-RPC 消息。
 * @param {object} msg 已解析的 {jsonrpc,id,method,params}
 * @returns {Promise<object|null>} 需要回包的 RPC 响应；通知返回 null
 */
export async function handleRpc(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return null
  const { id, method, params = {} } = msg

  const ok = (result) => ({ jsonrpc: '2.0', id, result })
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
  const isNotify = (id === undefined || id === null)

  switch (method) {
    case 'initialize':
      return isNotify ? null : ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      })

    // streamable-http 客户端初始化完成后发此通知
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/message':
      return null

    case 'ping':
      return isNotify ? null : ok({})

    case 'tools/list':
      return isNotify ? null : ok({ tools: toolDefinitions })

    case 'tools/call': {
      if (isNotify) return null
      if (params.name !== 'search') return err(-32602, `未知工具: ${params.name}`)
      const text = await runSearchTool(params.arguments || {})
      return ok({
        content: [{ type: 'text', text }],
        isError: text.startsWith('[search error') || text.startsWith('[search]'),
      })
    }

    case 'resources/list':
      return isNotify ? null : ok({ resources: [] })

    case 'resources/read':
      return isNotify ? null : err(-32602, '本服务器不提供资源读取')

    case 'shutdown':
      return isNotify ? null : ok(null)

    default:
      return isNotify ? null : err(-32601, `方法不支持: ${method}`)
  }
}
