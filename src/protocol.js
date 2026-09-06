/**
 * MCP JSON-RPC 协议核心：与传输无关的消息分发。
 *
 * 实现 MCP 协议子集。搜索后端是【可插拔】：
 *   默认优先 SearXNG（方案 A，推荐，服务器侧聚合 google-cse/brave/bing 等，规避数据中心 IP 被单引擎验证码封）。
 *   若未配 SEARXNG_URL，则回退到直接在 bing 网页版抓取（尽力而为，住宅 IP 可用）。
 *
 * handleRpc(msg, { searxngBase, ... }) 在调用 search 时把后端配置传入，
 * server.js / stdio 各自持有该 ctx。
 */

import { searxngSearch } from './searxng.js'
import { duckduckgoSearch } from './ddg.js' // 仅供可选 duckduckgo 显式触发使用
import { readFileSync } from 'node:fs'

// 版本以 package.json 为准，避免 CLI/initialize 显示旧版本
const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const SERVER_NAME = 'mcp-search-server'
export const SERVER_VERSION = pkgJson.version || '0.0.0'
export const PROTOCOL_VERSION = '2024-11-05' // 服务器声明，兼容 streamable-http

/** MCP 工具清单 */
export const toolDefinitions = [
  {
    name: 'search',
    description:
      '网页搜索（多后端：优先 SearXNG 聚合，其次必应网页版）。' +
      '返回按相关度排序的结果；每项含 title / url / snippet。结果含实际生效的后端 engine。',
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
 * 归一化 count 与 query 参数
 */
function normalize(args) {
  const query = (args && args.query) ? String(args.query).trim() : ''
  let count = Number.parseInt(args && args.count, 10)
  if (!Number.isInteger(count)) count = 10
  if (count < 1) count = 1
  if (count > 30) count = 30
  const region = ((args && args.region) ? String(args.region).trim() : '')
  return { query, count, region }
}

/**
 * 计算查询后端列表。默认"searxng 优先，bing 兜底"（联合）。
 * 显式 ctx.engine 则按其指定的逗号顺序。
 * @param {object} ctx {searxngBase, engine}
 * @returns {string[]}
 */
function backendPlan(ctx = {}) {
  if (ctx.engine) {
    return String(ctx.engine).split(',').map((s) => s.trim()).filter(Boolean)
  }
  const plan = []
  if (ctx.searxngBase) plan.push('searxng')
  plan.push('bing') // bing 总是兜底骨架（无 searxng 时即唯一主力）
  return plan
}

// ---------- 单个后端的实现（返回规范化结果数组；失败抛错供上层切换） ----------

async function _searxBehind({ searxngBase, query, count, region, fetchImpl }) {
  const rows = await searxngSearch({ base: searxngBase, query, count, region, fetchImpl })
  return rows
}

async function _bingBehind({ query, count, fetchImpl }) {
  // 仅作为无 SearXNG 时的轻量兜底，不建议生产主力（多云 IP 被降级）。
  const { bingSearch } = await import('./bing.js')
  const rows = await bingSearch({ query, count, fetchImpl })
  return rows
}

async function _ddgBehind({ query, count, region, fetchImpl }) {
  const rows = await duckduckgoSearch({ query, count, region, fetchImpl })
  return rows
}

/**
 * 执行 search（带后端 failover）。
 * 遍历 backendPlan 直到某后端返回 ≥1 条；全失败则返回带 engine 信息的错误文本。
 * @param {object} args
 * @param {object} [ctx] {searxngBase, engine, fetchImpl}
 */
export async function runSearch(args = {}, ctx = {}) {
  const { query, count, region } = normalize(args)
  if (!query) return { text: '[search] 缺少必填参数 query', isError: true }

  const plan = backendPlan(ctx)
  const notes = []
  for (const eng of plan) {
    try {
      let rows
      if (eng === 'searxng') rows = await _searxBehind({ searxngBase: ctx.searxngBase, query, count, region, fetchImpl: ctx.fetchImpl })
      else if (eng === 'bing') rows = await _bingBehind({ query, count, fetchImpl: ctx.fetchImpl })
      else if (eng === 'duckduckgo') rows = await _ddgBehind({ query, count, region, fetchImpl: ctx.fetchImpl })
      else return { text: `[unknown backend: ${eng}]`, isError: true }

      if (rows && rows.length) {
        const header = backendHeader(eng, rows)
        const body = rows.slice(0, count)
          .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet || ''}${r.engine ? `\n   (engine: ${r.engine})` : ''}`)
          .join('\n\n')
        return { text: header + body, engine: eng, isError: false }
      }
      // 空结果：记一笔并试下一后端
      notes.push(`[${eng}] no result`)
    } catch (err) {
      notes.push(`[${eng}] ${(err && err.message) || err}`)
    }
  }
  const detail = notes.join('; ')
  return { text: `[search unavailable] 尝试 ${plan.join(' + ')} 均未成功\n${detail}`, engine: plan.join('/'), isError: true }
}

/** 结果第一行带后端说明，便于使用者判断来源 */
function backendHeader(eng, rows) {
  return `# 来源后端: ${eng}（${rows.length} 条）\n\n`
}

/**
 * handleRpc —— 兼容旧导出签名，允许第二个参数传后端 ctx。
 * server.js 用 (msg, { searxngBase }) 调用；纯单测仍可 (msg)。
 */
export async function handleRpc(msg, ctx = {}) {
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
      const out = await runSearch(params.arguments || {}, ctx)
      return ok({
        content: [{ type: 'text', text: out.text }],
        isError: !!out.isError,
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

/**
 * runSearchTool —— 返回纯文本（单测/旧调用兼容）。
 * 保底处理：若 runSearch 抛错，也转成可读文本而非 throw。
 */
export async function runSearchTool(args = {}, ctx = {}) {
  try {
    const out = await runSearch(args, ctx)
    return out.text
  } catch (e) {
    return `[search error: ${(e && e.message) || e}]`
  }
}

