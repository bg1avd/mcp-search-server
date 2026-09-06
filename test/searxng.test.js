/**
 * SearXNG JSON 搜索后端单测（离线，mock fetch）
 *  验证 buildSearxUrl 的查询串、searxngSearch 的规整、错误分支，
 *  以及 protocol.runSearch 在配置 searxngBase 时优先走 SearXNG。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearxUrl, searxngSearch } from '../src/searxng.js'
import { runSearch } from '../src/protocol.js'

const SX_OK_BODY = JSON.stringify({
  results: [
    { title: 'A Result', url: 'https://a.example', content: 'snippet A', engine: 'google cse' },
    { title: 'B Result', url: 'https://b.example', content: '', engine: 'brave' },
  ],
})

function fakeFetchReturning(status, body, ctype = 'application/json') {
  return async () => new Response(body, { status, headers: { 'content-type': ctype } })
}

test('buildSearxUrl 拼接查询参数', () => {
  const u = buildSearxUrl('http://127.0.0.1:8809', { query: 'hi there', region: 'us-en', format: 'json' })
  assert.equal(u.origin + u.pathname, 'http://127.0.0.1:8809/search')
  assert.equal(u.searchParams.get('q'), 'hi there')
  assert.equal(u.searchParams.get('format'), 'json')
  assert.equal(u.searchParams.get('language'), 'us-en')
})

test('searxngSearch 规整字段并裁条数', async () => {
  const rows = await searxngSearch({
    base: 'http://sx', query: 'test', count: 1,
    fetchImpl: fakeFetchReturning(200, SX_OK_BODY),
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'A Result')
  assert.equal(rows[0].url, 'https://a.example')
  assert.equal(rows[0].snippet, 'snippet A')
  assert.equal(rows[0].engine, 'google cse')
})

test('searxngSearch 未配置 base 抛可读错误', async () => {
  await assert.rejects(() => searxngSearch({ base: '', query: 'x', fetchImpl: fakeFetchReturning(200, '[]') }), /SEARXNG_URL/)
})

test('searxngSearch 非 JSON 响应抛错', async () => {
  await assert.rejects(
    () => searxngSearch({ base: 'http://sx', query: 'x', fetchImpl: fakeFetchReturning(200, '<html>bot</html>', 'text/html') }),
    /未返回 JSON/
  )
})

test('searxngSearch 429 抛"可能限流"', async () => {
  await assert.rejects(
    () => searxngSearch({ base: 'http://sx', query: 'x', fetchImpl: fakeFetchReturning(429, '{}') }),
    /429|限频|反爬/
  )
})

test('runSearch → 配 searxngBase：SearXNG 返回结果即用（engine 标注）', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    // 模拟 SearXNG 正常返回
    return new Response(SX_OK_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const out = await runSearch({ query: 'tesla', count: 5 }, { searxngBase: 'http://127.0.0.1:8809', fetchImpl })
  assert.equal(out.isError, false)
  assert.equal(out.engine, 'searxng')
  assert.match(out.text, /A Result/)
  assert.ok(calls.every((u) => u.includes('/search?') && u.includes('format=json')))
})

test('runSearch → SearXNG 失败(429)自动回退 bing', async () => {
  let sawSearxng = false
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('127.0.0.1:8809')) {
      sawSearxng = true
      return new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } })
    }
    // bing 兜底：给一条真实可解析的 b_algo
    const html = '<html><body><li class="b_algo"><h2><a href="https://x.dev/a">Sample Title</a></h2><p>a snippet here</p></li></body></html>'
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
  }
  const out = await runSearch({ query: 't', count: 5 }, { searxngBase: 'http://127.0.0.1:8809', fetchImpl })
  assert.equal(sawSearxng, true, '应先尝试 SearXNG')
  assert.equal(out.engine, 'bing')
  assert.match(out.text, /Sample Title/)
})

test('runSearch 缺 query 返回错误文本 isError', async () => {
  const out = await runSearch({ count: 5 }, { searxngBase: 'http://sx' })
  assert.match(out.text, /query/)
  assert.equal(out.isError, true)
})
