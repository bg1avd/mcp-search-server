/**
 * streamable-http 集成测试
 *  起真实 HTTP 服务器，验证 API-key 鉴权 + MCP 握手 + tools/call。
 *
 * 端口用 0（由内核分配），再读 server.address().port 获取实际监听端口。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startMcpServer } from '../src/server.js'

const KEY = 'test-integr-key-0001'
let server
let port = -1
let baseUrl

before(async () => {
  server = await startMcpServer({ port: 0, host: '127.0.0.1', keys: [KEY], logger: () => {} })
  port = server.address().port
  baseUrl = `http://127.0.0.1:${port}/mcp`
})

after(async () => {
  try { server && await new Promise((r) => server.close(r)) } catch { /* ignore */ }
})

async function post(body, headers = {}) {
  return fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

test('无 API key -> 401', async () => {
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialized', params: {} })
  assert.equal(r.status, 401)
})

test('带合法 key，initialize 成功', async () => {
  const r = await post(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { Authorization: `Bearer ${KEY}` }
  )
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.result.serverInfo.name, 'mcp-search-server')
  assert.ok(j.result.capabilities.tools)
})

test('工具枚举包含 search', async () => {
  const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { Authorization: `Bearer ${KEY}` })
  const j = await r.json()
  assert.ok(j.result.tools.some((t) => t.name === 'search'))
})

test('tools/call search 返回协议合规内容（仅结构断言，容忍后端波动）', async () => {
  const r = await post(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'nodejs', count: 2 } } },
    { Authorization: `Bearer ${KEY}` }
  )
  assert.equal(r.status, 200)
  const j = await r.json()
  const c0 = j.result?.content?.[0]
  assert.ok(c0 && c0.type === 'text', 'content[0] 应为 text')
  assert.equal(typeof c0.text, 'string')
  assert.ok(c0.text.length > 0)
  assert.equal(typeof j.result.isError, 'boolean')
})

test('通知（无 id）返回 202', async () => {
  const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { Authorization: `Bearer ${KEY}` })
  assert.equal(r.status, 202)
})

test('错误 key 被拒 401', async () => {
  const r = await post({ jsonrpc: '2.0', id: 9, method: 'ping', params: {} }, { Authorization: 'Bearer nope' })
  assert.equal(r.status, 401)
})
