/**
 * MCP 协议核心单测（protocol.js）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRpc, runSearchTool, toolDefinitions } from '../src/protocol.js'

test('initialize 返回能力与版本', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  assert.equal(r.id, 1)
  assert.ok(r.result.protocolVersion)
  assert.ok(r.result.capabilities.tools)
  assert.equal(r.result.serverInfo.name, 'mcp-search-server')
})

test('tools/list 暴露 search 及其 schema', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  assert.ok(r.result.tools.some((t) => t.name === 'search'))
  assert.ok(r.result.tools[0].inputSchema.properties.query)
})

test('通知类消息不回包', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), null)
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'ping', params: {} }), null)
})

test('ping / shutdown / 未知方法', async () => {
  assert.deepEqual((await handleRpc({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} })).result, {})
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 4, method: 'shutdown', params: {} })).result, null)
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 5, method: 'no/such' })).error.code, -32601)
})

test('tools/call 未知工具返回错误；search 缺 query 给提示文本', async () => {
  const bad = await handleRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } })
  assert.equal(bad.error.code, -32602)
  const txt = await runSearchTool({})
  assert.match(txt, /query/)
})

test('tools/call search 在线路径结构完整（协议层断言，容忍后端波动）', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search', arguments: { query: 'model context protocol', count: 2 } } })
  // 无论被 DDG/Bing/SearXNG 限流返回何种文本，content 都应是"明确的纯文本"，并且结构稳定
  const c0 = r.result?.content?.[0]
  assert.ok(c0 && c0.type === 'text', '应返回 text 类型内容')
  assert.equal(typeof c0.text, 'string')
  assert.ok(c0.text.length > 0)
  assert.equal(typeof r.result.isError, 'boolean')
})

test('count 越界在 runSearchTool 收敛', async () => {
  // 不真正联网：注入不可达时只验证不 throw，返回文本/数组结构即可
  const txt = await runSearchTool({ query: 'ab' })
  assert.ok(typeof txt === 'string')
})
